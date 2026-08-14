// TASK 016: automated outreach sequences & follow-up engine.
//
// Deterministic and configuration-driven. Every compliance gate from TASK 015
// (safety checks, limits, cooldown, opt-outs) is re-used at execution time —
// nothing here bypasses provider limits, unsubscribe, do-not-contact or
// organization policy (§103-§105). Step execution runs in the queue worker,
// never inside HTTP request handling (§34). Execution is idempotent: one
// SequenceStepExecution row per (enrollment, position) acts as the claim
// lock, so concurrent workers can never double-send (§36, §84-§85).

import { prisma } from "@/lib/db"
import {
  CommunicationDirection,
  CommunicationStatus,
  EmailStatus,
  OutreachStatus,
  SequenceAuditAction,
  SequenceEnrollmentStatus,
  SequenceExitReason,
  SequencePauseReason,
  SequenceStatus,
  SequenceStepExecutionStatus,
  SequenceStepType,
  WaitUnit,
} from "@/generated/prisma/enums"
import { Prisma, type EmailSettings, type Sequence, type SequenceEnrollment, type SequenceStep, type SequenceStepExecution } from "@/generated/prisma/client"
import { getSettings } from "@/lib/lead-engine/email/service"
import { checkSendSafety, sendEmail, type Actor } from "@/lib/lead-engine/outreach/service"
import { plainTextBody, renderTemplate } from "@/lib/lead-engine/outreach/templates"
import { createActivity } from "@/lib/crm/activities"

// ── limits & timing ───────────────────────────────────────────────────────

const MAX_EXECUTION_ATTEMPTS = 3
const STALE_RUNNING_MS = 30 * 60 * 1000
const TASK_RECHECK_MS = 15 * 60 * 1000 // crash recovery: a RUNNING execution older than this is retried safely
const COOLDOWN_RESCHEDULE_MS = 24 * 60 * 60 * 1000
const LIMIT_RESCHEDULE_MS = 60 * 60 * 1000
const BLOCKED_EMAIL_STATUSES = [EmailStatus.INVALID, EmailStatus.REJECTED, EmailStatus.DO_NOT_CONTACT, EmailStatus.UNSUBSCRIBED]

// ── step input types (builder) ────────────────────────────────────────────

export interface StepInput {
  type: SequenceStepType
  name: string
  config: Record<string, unknown>
}

export interface SequenceInput {
  name: string
  description?: string | null
  maxDailyEmails?: number | null
}

export interface SnapshotStep {
  id: string
  position: number
  type: SequenceStepType
  name: string
  config: Record<string, unknown>
}

// ── permissions (§79, adapted to existing RBAC: ADMIN | MEMBER) ──────────

function requireAdmin(actor: Actor): void {
  if (actor.role !== "ADMIN") throw new Error("Admin access required")
}

// ── CRUD (§81, §90-§93) ───────────────────────────────────────────────────

export async function createSequence(orgId: string, actor: Actor, input: SequenceInput): Promise<Sequence> {
  requireAdmin(actor)
  const name = input.name.trim()
  if (!name) throw new Error("Sequence name is required")
  const sequence = await prisma.sequence.create({
    data: { organizationId: orgId, name, description: input.description?.trim() || null, maxDailyEmails: input.maxDailyEmails ?? null, createdById: actor.id, ownerId: actor.id },
  })
  await audit(orgId, SequenceAuditAction.SEQUENCE_CREATED, actor, sequence.id, { name: sequence.name })
  return sequence
}

export async function getSequence(orgId: string, id: string): Promise<{ sequence: Sequence; steps: SequenceStep[] } | null> {
  const sequence = await prisma.sequence.findFirst({ where: { id, organizationId: orgId } })
  if (!sequence) return null
  const steps = await prisma.sequenceStep.findMany({ where: { sequenceId: id }, orderBy: { position: "asc" } })
  return { sequence, steps }
}

export async function updateSequence(orgId: string, actor: Actor, id: string, input: { name?: string; description?: string | null; maxDailyEmails?: number | null; steps?: StepInput[] }): Promise<void> {
  requireAdmin(actor)
  const existing = await prisma.sequence.findFirst({ where: { id, organizationId: orgId } })
  if (!existing) throw new Error("Sequence not found")
  if (input.name !== undefined && !input.name.trim()) throw new Error("Sequence name is required")

  let steps: SequenceStep[] | undefined
  if (input.steps !== undefined) {
    if (input.steps.length === 0) throw new Error("Sequence must have at least one step")
    steps = await replaceSteps(orgId, id, input.steps)
  }
  // Version bump when a live sequence changes — new enrollments snapshot the
  // new steps; existing enrollments keep their immutable snapshot (§88-§89).
  const hasEnrollments = await prisma.sequenceEnrollment.count({ where: { sequenceId: id } })
  await prisma.sequence.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.maxDailyEmails !== undefined ? { maxDailyEmails: input.maxDailyEmails ?? null } : {}),
      ...(steps !== undefined && hasEnrollments > 0 ? { version: existing.version + 1 } : {}),
    },
  })
  await audit(orgId, SequenceAuditAction.SEQUENCE_UPDATED, actor, id, { steps: input.steps?.length ?? undefined })
}

async function replaceSteps(orgId: string, sequenceId: string, inputs: StepInput[]): Promise<SequenceStep[]> {
  await prisma.sequenceStep.deleteMany({ where: { sequenceId } })
  await prisma.sequenceStep.createMany({
    data: inputs.map((s, i) => ({ sequenceId, position: i, type: s.type, name: s.name.trim() || s.type, config: s.config as object })),
  })
  return prisma.sequenceStep.findMany({ where: { sequenceId }, orderBy: { position: "asc" } })
}

export async function duplicateSequence(orgId: string, actor: Actor, id: string): Promise<Sequence> {
  requireAdmin(actor)
  const existing = await getSequence(orgId, id)
  if (!existing) throw new Error("Sequence not found")
  const copy = await prisma.sequence.create({
    data: { organizationId: orgId, name: `${existing.sequence.name} (copy)`, description: existing.sequence.description, maxDailyEmails: existing.sequence.maxDailyEmails, createdById: actor.id, ownerId: actor.id, status: SequenceStatus.DRAFT },
  })
  await prisma.sequenceStep.createMany({
    data: existing.steps.map((s) => ({ organizationId: orgId, sequenceId: copy.id, position: s.position, type: s.type, name: s.name, config: s.config as unknown as Prisma.SequenceStepCreateManyInput["config"] })),
  })
  await audit(orgId, SequenceAuditAction.SEQUENCE_CLONED, actor, copy.id, { from: id })
  return copy
}

// ── validation & cycle detection (§20-§21) ────────────────────────────────

const CONDITION_OPERATORS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in", "not_in", "exists", "not_exists"])
const CONDITION_FIELDS = new Set(["email_verified", "has_replied", "lead_score", "contact_readiness", "outreach_status", "industry", "country"])

export function validateSteps(steps: StepInput[]): string[] {
  const errors: string[] = []
  if (steps.length === 0) return ["Sequence must have at least one step"]
  const byPosition = new Map(steps.map((s, i) => [i, s]))
  const byId = new Map(steps.map((s, i) => [s.name ?? String(i), i]))

  const edgeTo = (i: number): number | null => (i + 1 < steps.length ? i + 1 : null)
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    const cfg = s.config
    switch (s.type) {
      case SequenceStepType.EMAIL: {
        const subject = cfg.templateSubject ?? cfg.subject
        const body = cfg.templateBody ?? cfg.body
        if (!subject || !String(subject).trim()) errors.push(`Step ${i + 1}: email step needs a subject or a template`)
        if (!body || !String(body).trim()) errors.push(`Step ${i + 1}: email step needs a body or a template`)
        break
      }
      case SequenceStepType.WAIT: {
        const duration = Number(cfg.duration)
        if (!Number.isInteger(duration) || duration <= 0) errors.push(`Step ${i + 1}: wait duration must be a positive integer`)
        if (cfg.unit && !["MINUTES", "HOURS", "DAYS"].includes(String(cfg.unit))) errors.push(`Step ${i + 1}: invalid wait unit`)
        break
      }
      case SequenceStepType.TASK:
        if (!cfg.title || !String(cfg.title).trim()) errors.push(`Step ${i + 1}: task step needs a title`)
        break
      case SequenceStepType.CONDITION: {
        if (!CONDITION_FIELDS.has(String(cfg.field))) errors.push(`Step ${i + 1}: unsupported condition field "${String(cfg.field)}"`)
        if (!CONDITION_OPERATORS.has(String(cfg.operator))) errors.push(`Step ${i + 1}: unsupported condition operator "${String(cfg.operator)}"`)
        if (String(cfg.operator) !== "exists" && String(cfg.operator) !== "not_exists" && cfg.value === undefined) errors.push(`Step ${i + 1}: condition needs a value`)
        for (const [key, stepId] of [["trueStepId", cfg.trueStepId], ["falseStepId", cfg.falseStepId]] as const) {
          if (stepId && !byId.has(String(stepId))) errors.push(`Step ${i + 1}: ${key} "${String(stepId)}" does not exist`)
        }
        break
      }
      case SequenceStepType.END:
        break
      default:
        errors.push(`Step ${i + 1}: unknown step type`)
    }
  }

  // Cycle detection: DFS over next-position edges plus condition branches.
  const visited = new Array(steps.length).fill(0) // 0=unvisited 1=in-stack 2=done
  const dfs = (i: number): boolean => {
    visited[i] = 1
    const s = byPosition.get(i)!
    let next: number | null = null
    if (s.type === SequenceStepType.CONDITION) {
      const t = s.config.trueStepId ? byId.get(String(s.config.trueStepId)) : null
      const f = s.config.falseStepId ? byId.get(String(s.config.falseStepId)) : null
      next = (t !== null && t !== undefined ? (f !== null && f !== undefined ? f : t) : f) ?? null
    } else if (s.type !== SequenceStepType.END) {
      next = edgeTo(i)
    }
    let cyclic = false
    if (next !== null && next !== undefined && next < steps.length) {
      if (visited[next] === 1) cyclic = true
      else if (visited[next] === 0) cyclic = dfs(next)
    }
    visited[i] = 2
    return cyclic
  }
  for (let i = 0; i < steps.length; i++) {
    if (visited[i] === 0 && dfs(i)) {
      errors.push("Sequence contains a loop (a step would be reached again)")
      break
    }
  }
  return errors
}

// ── activation / pause / archive (§22-§24, §91) ───────────────────────────

export async function setSequenceStatus(orgId: string, actor: Actor, id: string, to: "ACTIVE" | "PAUSED" | "ARCHIVED"): Promise<void> {
  requireAdmin(actor)
  const sequence = await prisma.sequence.findFirst({ where: { id, organizationId: orgId } })
  if (!sequence) throw new Error("Sequence not found")
  if (to === SequenceStatus.ACTIVE) {
    const steps = await prisma.sequenceStep.findMany({ where: { sequenceId: id }, orderBy: { position: "asc" } })
    const errors = validateSteps(
      steps.map((s) => ({ type: s.type, name: s.name, config: s.config as Record<string, unknown> })),
    )
    // Templates referenced by email steps must exist (§20).
    for (const s of steps) {
      const templateId = (s.config as Record<string, unknown>).templateId
      if (typeof templateId === "string" && templateId) {
        const template = await prisma.emailTemplate.findFirst({ where: { id: templateId, organizationId: orgId } })
        if (!template) errors.push(`Step ${s.position + 1}: template "${templateId}" does not exist`)
      }
    }
    if (errors.length > 0) throw new Error(errors[0])
  }
  await prisma.sequence.update({ where: { id }, data: { status: to } })
  if (to === SequenceStatus.ARCHIVED) {
    // §91: archive stops future automated execution explicitly.
    const enrollments = await prisma.sequenceEnrollment.findMany({ where: { sequenceId: id, status: SequenceEnrollmentStatus.ACTIVE }, select: { id: true } })
    for (const e of enrollments) {
      await terminateEnrollment(e.id, SequenceExitReason.SEQUENCE_ARCHIVED, null, actor)
    }
  }
  const action = to === SequenceStatus.ACTIVE ? SequenceAuditAction.SEQUENCE_ACTIVATED : to === SequenceStatus.PAUSED ? SequenceAuditAction.SEQUENCE_PAUSED : SequenceAuditAction.SEQUENCE_ARCHIVED
  await audit(orgId, action, actor, id)
}

// ── enrollment (§13-§16, §111) ────────────────────────────────────────────

export type EnrollResult = { ok: true; id: string } | { ok: false; code: string; error: string }

export async function eligibleEmailForLead(leadId: string): Promise<{ email: string; emailId: string } | null> {
  const emails = await prisma.emailAddress.findMany({ where: { leadId, status: { notIn: BLOCKED_EMAIL_STATUSES } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] })
  if (emails.length === 0) return null
  const ranked = [...emails].sort((a, b) => Number(b.status === EmailStatus.VERIFIED || b.status === EmailStatus.LIKELY_VALID) - Number(a.status === EmailStatus.VERIFIED || a.status === EmailStatus.LIKELY_VALID))
  return { email: ranked[0].email, emailId: ranked[0].id }
}

export async function enrollLead(orgId: string, actor: Actor, input: { sequenceId: string; leadId: string; emailId?: string | null }): Promise<EnrollResult> {
  const sequence = await prisma.sequence.findFirst({ where: { id: input.sequenceId, organizationId: orgId } })
  if (!sequence) return { ok: false, code: "SEQUENCE_INVALID", error: "Sequence not found" }
  if (sequence.status !== SequenceStatus.ACTIVE) return { ok: false, code: "SEQUENCE_INVALID", error: "Sequence is not active" }
  const lead = await prisma.lead.findFirst({ where: { id: input.leadId, organizationId: orgId }, include: { contact: true } })
  if (!lead) return { ok: false, code: "NOT_FOUND", error: "Lead not found" }
  if (!lead.contactId) return { ok: false, code: "MISSING_EMAIL", error: "Lead has no contact" }
  const dup = await prisma.sequenceEnrollment.findUnique({
    where: { organizationId_sequenceId_leadId_activeGuard: { organizationId: orgId, sequenceId: sequence.id, leadId: lead.id, activeGuard: "ACTIVE" } },
  })
  if (dup) return { ok: false, code: "ALREADY_ENROLLED", error: "This lead is already enrolled in this sequence" }
  if (lead.doNotContact || lead.contact?.doNotContact || lead.outreachStatus === OutreachStatus.DO_NOT_CONTACT) {
    return { ok: false, code: "DO_NOT_CONTACT", error: "This lead is do-not-contact" }
  }

  let emailId = input.emailId ?? null
  if (emailId) {
    const email = await prisma.emailAddress.findFirst({ where: { id: emailId, organizationId: orgId, leadId: lead.id } })
    if (!email) return { ok: false, code: "MISSING_EMAIL", error: "Email does not belong to this lead" }
    if ((BLOCKED_EMAIL_STATUSES as EmailStatus[]).includes(email.status)) return { ok: false, code: "EMAIL_BLOCKED", error: `Email is ${email.status}` }
  } else {
    const best = await eligibleEmailForLead(lead.id)
    if (!best) return { ok: false, code: "MISSING_EMAIL", error: "Lead has no usable email address" }
    emailId = best.emailId
  }

  const steps = await prisma.sequenceStep.findMany({ where: { sequenceId: sequence.id }, orderBy: { position: "asc" } })
  if (steps.length === 0) return { ok: false, code: "SEQUENCE_INVALID", error: "Sequence has no steps" }
  const snapshot = snapshotSteps(steps)
  const enrollment = await prisma.sequenceEnrollment.create({
    data: {
      organizationId: orgId,
      sequenceId: sequence.id,
      leadId: lead.id,
      contactId: lead.contactId,
      emailId,
      version: sequence.version,
      stepsJson: snapshot as unknown as object,
      currentPosition: 0,
      nextRunAt: new Date(),
      enrolledById: actor.id,
      activeGuard: "ACTIVE",
    },
  })
  await audit(orgId, SequenceAuditAction.ENROLLMENT_CREATED, actor, sequence.id, { enrollmentId: enrollment.id, leadId: lead.id })
  await createActivity(orgId, { type: "SEQUENCE", title: `Enrolled in sequence "${sequence.name}"`, leadId: lead.id, contactId: lead.contactId ?? undefined }, actor.id)
  return { ok: true, id: enrollment.id }
}

// Resolve condition branches to positions once, at snapshot time — execution
// never re-reads the mutable builder steps (§48-§49).
function snapshotSteps(steps: SequenceStep[]): SnapshotStep[] {
  const byId = new Map<string, number>([
    ...steps.map((s) => [s.id, s.position] as const),
    ...steps.map((s) => [s.name, s.position] as const),
  ])
  return steps.map((s) => {
    const cfg = s.config as Record<string, unknown>
    if (s.type === SequenceStepType.CONDITION) {
      const truePosition = typeof cfg.trueStepId === "string" ? (byId.get(cfg.trueStepId) ?? null) : null
      const falsePosition = typeof cfg.falseStepId === "string" ? (byId.get(cfg.falseStepId) ?? null) : null
      return { id: s.id, position: s.position, type: s.type, name: s.name, config: { ...cfg, truePosition, falsePosition } }
    }
    return { id: s.id, position: s.position, type: s.type, name: s.name, config: cfg }
  })
}

export async function bulkEnroll(orgId: string, actor: Actor, input: { sequenceId: string; leadIds: string[] }): Promise<{ enrolled: number; skipped: number }> {
  let enrolled = 0
  let skipped = 0
  for (const leadId of input.leadIds) {
    const result = await enrollLead(orgId, actor, { sequenceId: input.sequenceId, leadId })
    if (result.ok) enrolled++
    else skipped++
  }
  return { enrolled, skipped }
}

// ── enrollment controls (§25-§26, §75) ────────────────────────────────────

export async function pauseEnrollment(orgId: string, actor: Actor, enrollmentId: string, reason: SequencePauseReason = SequencePauseReason.USER_PAUSED): Promise<void> {
  const enrollment = await requireEnrollmentOwnership(orgId, actor, enrollmentId)
  await prisma.sequenceEnrollment.update({ where: { id: enrollmentId }, data: { status: SequenceEnrollmentStatus.PAUSED, pauseReason: reason, nextRunAt: null, activeGuard: null } })
  await audit(orgId, SequenceAuditAction.ENROLLMENT_PAUSED, actor, enrollment.sequenceId, { enrollmentId })
}

export async function resumeEnrollment(orgId: string, actor: Actor, enrollmentId: string): Promise<void> {
  const enrollment = await requireEnrollmentOwnership(orgId, actor, enrollmentId)
  if (enrollment.status !== SequenceEnrollmentStatus.PAUSED) return
  // §24: do not execute missed steps immediately — compute the next eligible
  // time from the org send window.
  const settings = await getSettings(orgId)
  const nextRunAt = await nextAllowableAt(new Date(), settings)
  await prisma.sequenceEnrollment.update({ where: { id: enrollmentId }, data: { status: SequenceEnrollmentStatus.ACTIVE, pauseReason: null, nextRunAt, activeGuard: "ACTIVE" } })
  await audit(orgId, SequenceAuditAction.ENROLLMENT_RESUMED, actor, enrollment.sequenceId, { enrollmentId })
}

export async function stopEnrollment(orgId: string, actor: Actor, enrollmentId: string, reason: SequenceExitReason = SequenceExitReason.MANUAL_STOP): Promise<void> {
  await requireEnrollmentOwnership(orgId, actor, enrollmentId)
  await terminateEnrollment(enrollmentId, reason, null, actor)
}

async function requireEnrollmentOwnership(orgId: string, actor: Actor, enrollmentId: string): Promise<SequenceEnrollment> {
  const enrollment = await prisma.sequenceEnrollment.findFirst({ where: { id: enrollmentId, organizationId: orgId } })
  if (!enrollment) throw new Error("Enrollment not found")
  if (actor.role !== "ADMIN" && enrollment.enrolledById !== actor.id) throw new Error("You can only manage enrollments you created")
  return enrollment
}

// ── scheduler scan (§34-§35, §83) ─────────────────────────────────────────

// Finds due enrollments and queues their next step. Concurrency-safe: the
// claim marks nextRunAt null atomically, so two workers can never process
// the same enrollment (§84-§85). Wait steps move time forward themselves;
// the dev queue re-triggers scans via enqueueSequenceScan and the interval
// in job-queue.ts.
export async function runScheduledSequenceSteps(orgId?: string): Promise<number> {
  const now = new Date()
  const due = await prisma.sequenceEnrollment.findMany({
    where: {
      status: SequenceEnrollmentStatus.ACTIVE,
      nextRunAt: { lte: now },
      ...(orgId ? { organizationId: orgId } : {}),
      sequence: { status: SequenceStatus.ACTIVE },
    },
    select: { id: true },
    take: 100,
  })
  let processed = 0
  for (const { id } of due) {
    const claimed = await prisma.sequenceEnrollment.updateMany({ where: { id, status: SequenceEnrollmentStatus.ACTIVE, nextRunAt: { lte: new Date() } }, data: { nextRunAt: null } })
    if (claimed.count === 0) continue
    try {
      await executeNextStep(id)
      processed++
    } catch (e) {
      console.log(`sequence.scan.error enrollmentId=${id} error=${e instanceof Error ? e.message : "unknown"}`)
    }
  }
  return processed
}

// ── step execution (§37-§39, §86-§87) ─────────────────────────────────────

type StepOutcome =
  | { kind: "advance"; position: number; nextRunAt: Date | null } // move to position; schedule next run (null = asap)
  | { kind: "waitTask"; nextRunAt: Date | null } // TASK step waiting for completion
  | { kind: "reschedule"; at: Date; code?: string } // cooldown/limit/backoff — retry later
  | { kind: "pause"; pauseReason: SequencePauseReason; code: string } // missing data etc.
  | { kind: "stop"; exitReason: SequenceExitReason; code: string }
  | { kind: "complete"; exitReason: SequenceExitReason }

export async function executeNextStep(enrollmentId: string): Promise<void> {
  const enrollment = await prisma.sequenceEnrollment.findUnique({ where: { id: enrollmentId } })
  if (!enrollment || enrollment.status !== SequenceEnrollmentStatus.ACTIVE) return
  const sequence = await prisma.sequence.findUnique({ where: { id: enrollment.sequenceId } })
  if (!sequence) {
    await terminateEnrollment(enrollmentId, SequenceExitReason.FAILED, "SEQUENCE_INVALID")
    return
  }
  if (sequence.status === SequenceStatus.ARCHIVED) {
    await terminateEnrollment(enrollmentId, SequenceExitReason.SEQUENCE_ARCHIVED, null)
    return
  }
  if (sequence.status !== SequenceStatus.ACTIVE) return // paused sequence: pause future execution only (§23)

  const lead = await prisma.lead.findFirst({ where: { id: enrollment.leadId }, include: { contact: true, company: true } })
  if (!lead) {
    await terminateEnrollment(enrollmentId, SequenceExitReason.FAILED, "LEAD_MISSING")
    return
  }
  const email = enrollment.emailId ? await prisma.emailAddress.findUnique({ where: { id: enrollment.emailId } }) : null
  const blocked = await autoStopReason(lead, email)
  if (blocked) {
    await terminateEnrollment(enrollmentId, blocked.exitReason, blocked.code)
    return
  }

  const steps = enrollment.stepsJson as unknown as SnapshotStep[]
  const position = enrollment.currentPosition ?? 0
  if (position >= steps.length) {
    await completeEnrollment(enrollment, SequenceExitReason.COMPLETED)
    return
  }
  const step = steps[position]

  // TASK step (§73): one task created per step position; the enrollment
  // waits on it (polled via TASK_RECHECK_MS) and advances once it resolves.
  // This runs before the claim so a completed exec row never blocks it.
  if (step.type === SequenceStepType.TASK) {
    const open = await prisma.sequenceTask.findFirst({ where: { enrollmentId: enrollment.id, completedAt: null }, orderBy: { createdAt: "asc" } })
    const overdue = open !== null && open.dueAt !== null && open.dueAt <= new Date()
    const continueAfterDue = step.config.continueAfterDue === true
    if (open && !(overdue && continueAfterDue)) {
      await prisma.sequenceEnrollment.update({ where: { id: enrollment.id }, data: { nextRunAt: new Date(Date.now() + TASK_RECHECK_MS) } })
      return
    }
    const done = open !== null ? open : await prisma.sequenceTask.findFirst({ where: { enrollmentId: enrollment.id, completedAt: { not: null } } })
    if (done) {
      await prisma.sequenceEnrollment.update({ where: { id: enrollment.id }, data: { currentPosition: position + 1, nextRunAt: new Date() } })
      return
    }
    // no task yet: fall through — executeTaskStep creates it and waits
  }

  // Idempotent claim: one execution row per (enrollment, position); only
  // PENDING rows can be claimed (§36, §84-§85).
  const exec = await prisma.sequenceStepExecution.upsert({
    where: { enrollmentId_position: { enrollmentId: enrollment.id, position } },
    create: { organizationId: enrollment.organizationId, enrollmentId: enrollment.id, stepId: step.id ?? null, position, status: SequenceStepExecutionStatus.PENDING },
    update: {},
  })
  if (exec.status === SequenceStepExecutionStatus.RUNNING) {
    // §87 crash recovery: RUNNING for too long — reconcile via the stored
    // communicationId instead of blindly resending.
    if (exec.startedAt && Date.now() - exec.startedAt.getTime() > STALE_RUNNING_MS) {
      if (exec.communicationId) {
        await prisma.sequenceStepExecution.update({ where: { id: exec.id }, data: { status: SequenceStepExecutionStatus.COMPLETED, completedAt: new Date() } })
        await prisma.sequenceEnrollment.update({ where: { id: enrollment.id }, data: { currentPosition: position + 1, nextRunAt: new Date() } })
      } else {
        await prisma.sequenceStepExecution.update({ where: { id: exec.id }, data: { status: SequenceStepExecutionStatus.FAILED, errorCode: "STALE_RUNNING" } })
      }
    }
    return
  }
  if (exec.status !== SequenceStepExecutionStatus.PENDING) return
  const claimed = await prisma.sequenceStepExecution.updateMany({
    where: { id: exec.id, status: SequenceStepExecutionStatus.PENDING },
    data: { status: SequenceStepExecutionStatus.RUNNING, startedAt: new Date() },
  })
  if (claimed.count === 0) return

  const settings = await getSettings(enrollment.organizationId)
  const outcome = await executeStep(enrollment, sequence, step, lead, email, settings)
  await applyOutcome(enrollment, sequence, step, exec, outcome)
}

type SeqLead = {
  id: string
  contactId: string | null
  ownerId: string | null
  status: string
  score: number | null
  contactReadiness: number | null
  outreachStatus: OutreachStatus | null
  doNotContact: boolean
  contact: { doNotContact: boolean } | null
}

type SeqLeadFull = Omit<SeqLead, "contact"> & {
  contact: { doNotContact: boolean; firstName: string | null; lastName: string | null; jobTitle: string | null } | null
  company: { name: string | null } | null
}

async function executeStep(
  enrollment: SequenceEnrollment,
  sequence: Sequence,
  step: SnapshotStep,
  lead: SeqLeadFull,
  email: { id: string; email: string; status: EmailStatus } | null,
  settings: EmailSettings,
): Promise<StepOutcome> {
  const cfg = step.config
  switch (step.type) {
    case SequenceStepType.EMAIL:
      return executeEmailStep(enrollment, sequence, step, lead, email, settings)
    case SequenceStepType.WAIT: {
      const duration = Number(cfg.duration)
      const unit = String(cfg.unit ?? "DAYS") as WaitUnit
      const ms = duration * (unit === WaitUnit.MINUTES ? 60_000 : unit === WaitUnit.HOURS ? 3_600_000 : 86_400_000)
      const at = await nextAllowableAt(new Date(Date.now() + ms), settings)
      return { kind: "advance", position: step.position + 1, nextRunAt: at }
    }
    case SequenceStepType.TASK:
      return executeTaskStep(enrollment, sequence, step, lead)
    case SequenceStepType.CONDITION: {
      const target = evaluateCondition(cfg, lead, email)
      if (target === null || target === undefined) return { kind: "complete", exitReason: SequenceExitReason.COMPLETED }
      return { kind: "advance", position: target, nextRunAt: new Date() }
    }
    case SequenceStepType.END:
      return { kind: "complete", exitReason: SequenceExitReason.COMPLETED }
    default:
      return { kind: "stop", exitReason: SequenceExitReason.FAILED, code: "SEQUENCE_INVALID" }
  }
}

async function executeEmailStep(
  enrollment: SequenceEnrollment,
  sequence: Sequence,
  step: SnapshotStep,
  lead: SeqLeadFull,
  email: { id: string; email: string; status: EmailStatus } | null,
  settings: EmailSettings,
): Promise<StepOutcome> {
  const cfg = step.config
  if (!email) return { kind: "stop", exitReason: SequenceExitReason.FAILED, code: "MISSING_EMAIL" }

  // §33: full re-check before EVERY automated send.
  const safety = await checkSendSafety(enrollment.organizationId, lead.id, email.id, settings, {})
  if (!safety.ok) return codeOutcome(safety.code!)

  // §45: per-sequence daily cap (<= org policy, enforced by the org-level
  // check above anyway).
  if (sequence.maxDailyEmails) {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const sentToday = await prisma.communication.count({
      where: { organizationId: enrollment.organizationId, direction: CommunicationDirection.OUTBOUND, status: { in: [CommunicationStatus.SENT, CommunicationStatus.DELIVERED, CommunicationStatus.QUEUED, CommunicationStatus.SENDING] }, createdAt: { gte: startOfDay }, metadata: { path: ["sequenceId"], equals: sequence.id } },
    })
    if (sentToday >= sequence.maxDailyEmails) return { kind: "reschedule", at: new Date(Date.now() + LIMIT_RESCHEDULE_MS), code: "LIMIT_REACHED" }
  }

  // §50-§51: approved variables only; missing data → pause, never a malformed send.
  const context = await personalizationContext(lead, settings)
  const subject = renderTemplate(String(cfg.templateSubject ?? cfg.subject ?? ""), context)
  const body = renderTemplate(String(cfg.templateBody ?? cfg.body ?? ""), context)
  const missing = [...new Set([...subject.missing, ...body.missing])]
  if (missing.length > 0) return { kind: "pause", pauseReason: SequencePauseReason.MISSING_DATA, code: "MISSING_PERSONALIZATION_DATA" }

  const actor: Actor = { id: sequence.createdById ?? "system", name: sequence.createdById ? "Sequence engine" : "System", role: "ADMIN" }
  const result = await sendEmail(enrollment.organizationId, actor, {
    leadId: lead.id,
    emailId: email.id,
    subject: subject.subject,
    body: plainTextBody(body.body),
    accountId: (cfg.senderAccountId as string | null) ?? undefined,
    metadata: { source: "SEQUENCE", sequenceId: sequence.id, enrollmentId: enrollment.id, stepId: step.id, position: step.position },
  })
  if (result.ok) return { kind: "advance", position: step.position + 1, nextRunAt: new Date() }
  return codeOutcome(result.code!, { retryable: true })
}

async function executeTaskStep(
  enrollment: SequenceEnrollment,
  sequence: Sequence,
  step: SnapshotStep,
  lead: SeqLeadFull,
): Promise<StepOutcome> {
  const cfg = step.config
  const existing = await prisma.sequenceTask.findFirst({ where: { enrollmentId: enrollment.id, title: String(cfg.title) } })
  if (!existing) {
    const assignee = await resolveAssignee(enrollment.organizationId, sequence, cfg.assignedTo, lead)
    const dueOffsetHours = Number(cfg.dueOffsetHours ?? 0)
    await prisma.sequenceTask.create({
      data: {
        organizationId: enrollment.organizationId,
        enrollmentId: enrollment.id,
        sequenceId: sequence.id,
        leadId: lead.id,
        contactId: lead.contactId,
        title: String(cfg.title),
        description: (cfg.description as string | null) ?? null,
        assignedToId: assignee,
        dueAt: dueOffsetHours > 0 ? new Date(Date.now() + dueOffsetHours * 3_600_000) : null,
        createdById: sequence.createdById,
      },
    })
    await createActivity(enrollment.organizationId, { type: "TASK", title: `Sequence task: ${String(cfg.title)}`, leadId: lead.id, contactId: lead.contactId ?? undefined }, sequence.createdById ?? undefined)
  }
  // Wait for completion (default) or continue once due (configured). Always
  // schedule a re-check so the scanner wakes us up again (ponytail: fixed
  // 15-min poll, fine until there's a task event bus).
  return { kind: "waitTask", nextRunAt: new Date(Date.now() + TASK_RECHECK_MS) }
}

async function resolveAssignee(orgId: string, sequence: Sequence, assignedTo: unknown, lead: { ownerId: string | null }): Promise<string | null> {
  if (assignedTo === "CURRENT_OWNER") return lead.ownerId
  if (assignedTo === "SEQUENCE_OWNER") return sequence.ownerId
  if (typeof assignedTo === "string" && assignedTo) {
    const user = await prisma.user.findFirst({ where: { id: assignedTo, organizationId: orgId } })
    return user?.id ?? null
  }
  return null
}

// ── condition evaluation (§7-§9) ──────────────────────────────────────────

export function evaluateCondition(
  cfg: Record<string, unknown>,
  lead: SeqLead,
  email: { status: EmailStatus } | null,
): number | null {
  const field = String(cfg.field)
  const operator = String(cfg.operator)
  const value = cfg.value
  let actual: unknown = null
  switch (field) {
    case "email_verified":
      actual = email !== null && (email.status === EmailStatus.VERIFIED || email.status === EmailStatus.LIKELY_VALID)
      break
    case "has_replied":
      actual = lead.outreachStatus === OutreachStatus.REPLIED
      break
    case "lead_score":
      actual = lead.score ?? null
      break
    case "contact_readiness":
      actual = lead.contactReadiness ?? null
      break
    case "outreach_status":
      actual = lead.outreachStatus
      break
    default:
      actual = null // unknown/absent field (e.g. company_size: no schema field)
  }
  const truePos = cfg.truePosition as number | null
  const falsePos = cfg.falsePosition as number | null
  const exists = actual !== null && actual !== undefined
  switch (operator) {
    case "exists":
      return exists ? truePos : falsePos
    case "not_exists":
      return !exists ? truePos : falsePos
    default: {
      if (!exists) return falsePos
      const match = compareValues(operator, actual, value)
      return match ? truePos : falsePos
    }
  }
}

function compareValues(operator: string, actual: unknown, expected: unknown): boolean {
  switch (operator) {
    case "eq":
      return actual == expected // == for string/number coercion of enums
    case "neq":
      return actual != expected
    case "gt":
      return Number(actual) > Number(expected)
    case "gte":
      return Number(actual) >= Number(expected)
    case "lt":
      return Number(actual) < Number(expected)
    case "lte":
      return Number(actual) <= Number(expected)
    case "contains":
      return String(actual).toLowerCase().includes(String(expected).toLowerCase())
    case "in": {
      const list = Array.isArray(expected) ? expected : [expected]
      return list.some((x) => String(x) === String(actual))
    }
    case "not_in": {
      const list = Array.isArray(expected) ? expected : [expected]
      return !list.some((x) => String(x) === String(actual))
    }
    default:
      return false
  }
}

async function personalizationContext(lead: SeqLeadFull, settings: EmailSettings): Promise<Record<string, string | null>> {
  return {
    first_name: lead.contact?.firstName ?? null,
    last_name: lead.contact?.lastName ?? null,
    company_name: lead.company?.name ?? null,
    job_title: lead.contact?.jobTitle ?? null,
    sender_name: settings.senderName ?? null,
  }
}

// ── auto-stop rules (§27-§32, §66-§68) ────────────────────────────────────

async function autoStopReason(
  lead: SeqLead,
  email: { status: EmailStatus } | null,
): Promise<{ exitReason: SequenceExitReason; code: string } | null> {
  if (lead.outreachStatus === OutreachStatus.REPLIED) return { exitReason: SequenceExitReason.REPLIED, code: "REPLIED" }
  if (lead.outreachStatus === OutreachStatus.MEETING_BOOKED) return { exitReason: SequenceExitReason.MEETING_BOOKED, code: "MEETING_BOOKED" }
  if (lead.status === "DISQUALIFIED") return { exitReason: SequenceExitReason.DISQUALIFIED, code: "DISQUALIFIED" }
  if (lead.doNotContact || lead.contact?.doNotContact || lead.outreachStatus === OutreachStatus.DO_NOT_CONTACT) {
    return { exitReason: SequenceExitReason.DO_NOT_CONTACT, code: "DO_NOT_CONTACT" }
  }
  if (!email) return { exitReason: SequenceExitReason.FAILED, code: "MISSING_EMAIL" }
  if (email.status === EmailStatus.UNSUBSCRIBED) return { exitReason: SequenceExitReason.UNSUBSCRIBED, code: "UNSUBSCRIBED" }
  if (email.status === EmailStatus.INVALID || email.status === EmailStatus.REJECTED) return { exitReason: SequenceExitReason.BOUNCED, code: "INVALID_EMAIL" }
  return null
}

// ── outcome application ───────────────────────────────────────────────────

// Failure code → StepOutcome. Used both for the pre-send safety re-check and
// for sendEmail's own result (§33, §65).
function codeOutcome(code: string, opts: { retryable?: boolean } = {}): StepOutcome {
  if (["UNSUBSCRIBED", "DO_NOT_CONTACT"].includes(code)) return { kind: "stop", exitReason: SequenceExitReason.UNSUBSCRIBED, code }
  if (code === "INVALID_RECIPIENT") return { kind: "stop", exitReason: SequenceExitReason.BOUNCED, code }
  if (code === "COOLDOWN") return { kind: "reschedule", at: new Date(Date.now() + COOLDOWN_RESCHEDULE_MS), code }
  if (code === "LIMIT_REACHED") return { kind: "reschedule", at: new Date(Date.now() + LIMIT_RESCHEDULE_MS), code }
  if (opts.retryable && (code === "RATE_LIMITED" || code === "PROVIDER_UNAVAILABLE")) return { kind: "reschedule", at: new Date(Date.now() + 60_000), code }
  return { kind: "stop", exitReason: SequenceExitReason.FAILED, code }
}

async function applyOutcome(
  enrollment: SequenceEnrollment,
  sequence: Sequence,
  step: SnapshotStep,
  exec: SequenceStepExecution,
  outcome: StepOutcome,
): Promise<void> {
  switch (outcome.kind) {
    case "advance":
      await prisma.sequenceStepExecution.update({ where: { id: exec.id }, data: { status: SequenceStepExecutionStatus.COMPLETED, completedAt: new Date() } })
      await prisma.sequenceEnrollment.update({ where: { id: enrollment.id }, data: { currentPosition: outcome.position, nextRunAt: outcome.nextRunAt } })
      await audit(enrollment.organizationId, SequenceAuditAction.SEQUENCE_STEP_EXECUTED, null, sequence.id, { enrollmentId: enrollment.id, position: step.position, type: step.type })
      break
    case "waitTask":
      await prisma.sequenceStepExecution.update({ where: { id: exec.id }, data: { status: SequenceStepExecutionStatus.COMPLETED, completedAt: new Date() } })
      await prisma.sequenceEnrollment.update({ where: { id: enrollment.id }, data: { currentPosition: step.position, nextRunAt: outcome.nextRunAt } })
      break
    case "reschedule": {
      const attempts = exec.attempts + 1
      const retryable = ["RATE_LIMITED", "PROVIDER_UNAVAILABLE"].some((c) => c === outcome.code)
      if (retryable && attempts >= MAX_EXECUTION_ATTEMPTS) {
        await failStep(enrollment, sequence, step, exec, outcome.code ?? "PROVIDER_ERROR", "Max attempts reached", attempts)
        return
      }
      await prisma.sequenceStepExecution.update({ where: { id: exec.id }, data: { status: retryable ? SequenceStepExecutionStatus.PENDING : SequenceStepExecutionStatus.SKIPPED, attempts, scheduledAt: outcome.at, errorCode: outcome.code ?? null, errorMessage: outcome.code ?? null } })
      await prisma.sequenceEnrollment.update({ where: { id: enrollment.id }, data: { nextRunAt: outcome.at } })
      await audit(enrollment.organizationId, SequenceAuditAction.SEQUENCE_STEP_FAILED, null, sequence.id, { enrollmentId: enrollment.id, position: step.position, code: outcome.code })
      break
    }
    case "pause":
      await prisma.sequenceStepExecution.update({ where: { id: exec.id }, data: { status: SequenceStepExecutionStatus.SKIPPED, errorCode: outcome.code, completedAt: new Date() } })
      await prisma.sequenceEnrollment.update({ where: { id: enrollment.id }, data: { status: SequenceEnrollmentStatus.PAUSED, pauseReason: outcome.pauseReason, nextRunAt: null, activeGuard: null } })
      await audit(enrollment.organizationId, SequenceAuditAction.SEQUENCE_STEP_FAILED, null, sequence.id, { enrollmentId: enrollment.id, position: step.position, code: outcome.code })
      break
    case "stop":
      await failStep(enrollment, sequence, step, exec, outcome.code, outcome.exitReason, exec.attempts + 1)
      await terminateEnrollment(enrollment.id, outcome.exitReason, outcome.code)
      break
    case "complete":
      await prisma.sequenceStepExecution.update({ where: { id: exec.id }, data: { status: SequenceStepExecutionStatus.COMPLETED, completedAt: new Date() } })
      await completeEnrollment(enrollment, outcome.exitReason)
      break
  }
}

async function failStep(enrollment: SequenceEnrollment, sequence: Sequence, step: SnapshotStep, exec: SequenceStepExecution, code: string, message: string, attempts: number): Promise<void> {
  await prisma.sequenceStepExecution.update({ where: { id: exec.id }, data: { status: SequenceStepExecutionStatus.FAILED, attempts, errorCode: code, errorMessage: message, completedAt: new Date() } })
  await audit(enrollment.organizationId, SequenceAuditAction.SEQUENCE_STEP_FAILED, null, sequence.id, { enrollmentId: enrollment.id, position: step.position, code, message })
}

async function completeEnrollment(enrollment: SequenceEnrollment, exitReason: SequenceExitReason): Promise<void> {
  await prisma.sequenceEnrollment.update({ where: { id: enrollment.id }, data: { status: SequenceEnrollmentStatus.COMPLETED, completedAt: new Date(), exitReason, nextRunAt: null, activeGuard: null } })
  await audit(enrollment.organizationId, SequenceAuditAction.SEQUENCE_COMPLETED, null, enrollment.sequenceId, { enrollmentId: enrollment.id, exitReason })
  await activityOnExit(enrollment.organizationId, enrollment.sequenceId, enrollment.leadId, enrollment.contactId, exitReason)
}

async function terminateEnrollment(enrollmentId: string, exitReason: SequenceExitReason, code: string | null, actor: Actor | null = null): Promise<void> {
  const enrollment = await prisma.sequenceEnrollment.findUnique({ where: { id: enrollmentId } })
  if (!enrollment || enrollment.status === SequenceEnrollmentStatus.COMPLETED || enrollment.status === SequenceEnrollmentStatus.STOPPED) return
  const status = exitReason === SequenceExitReason.UNSUBSCRIBED ? SequenceEnrollmentStatus.UNSUBSCRIBED : exitReason === SequenceExitReason.BOUNCED ? SequenceEnrollmentStatus.BOUNCED : exitReason === SequenceExitReason.FAILED ? SequenceEnrollmentStatus.FAILED : SequenceEnrollmentStatus.STOPPED
  await prisma.sequenceEnrollment.update({ where: { id: enrollmentId }, data: { status, completedAt: new Date(), exitReason, nextRunAt: null, activeGuard: null } })
  await prisma.sequenceStepExecution.updateMany({ where: { enrollmentId, status: SequenceStepExecutionStatus.PENDING }, data: { status: SequenceStepExecutionStatus.CANCELLED } })
  await audit(enrollment.organizationId, SequenceAuditAction.SEQUENCE_STOPPED, actor, enrollment.sequenceId, { enrollmentId, exitReason, code })
  await activityOnExit(enrollment.organizationId, enrollment.sequenceId, enrollment.leadId, enrollment.contactId, exitReason, code, actor?.id)
}

async function activityOnExit(orgId: string, sequenceId: string, leadId: string, contactId: string | null, exitReason: SequenceExitReason, code: string | null = null, actorId: string | null = null): Promise<void> {
  const sequence = await prisma.sequence.findUnique({ where: { id: sequenceId }, select: { name: true } })
  await createActivity(orgId, { type: "SEQUENCE", title: `Sequence "${sequence?.name ?? ""}" ${exitReason.toLowerCase().replaceAll("_", " ")}`, description: code ?? undefined, leadId, contactId: contactId ?? undefined }, actorId ?? undefined)
}

// ── scheduling helpers (§40-§43) ──────────────────────────────────────────

// Next instant at which sending is allowed: inside the org send window, not
// on a skipped weekend, not on a blackout date, evaluated in the org
// timezone. Timestamps remain UTC in the DB (§40).
export async function nextAllowableAt(candidate: Date, settings: EmailSettings): Promise<Date> {
  const timezone = settings.timezone || "UTC"
  const startHour = settings.sendStartHour ?? 9
  const endHour = settings.sendEndHour ?? 17
  const skipWeekends = settings.skipWeekends ?? true
  const blackouts = new Set((settings.blackoutDates as string[] | null) ?? [])
  let d = new Date(candidate)
  for (let day = 0; day < 21; day++) {
    const p = tzParts(d, timezone)
    const dateKey = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
    const weekend = skipWeekends && (p.weekday === "Sat" || p.weekday === "Sun")
    if (!weekend && !blackouts.has(dateKey)) {
      if (p.hour < startHour) {
        const offset = d.getTime() - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
        const want = Date.UTC(p.year, p.month - 1, p.day, startHour, 0, 0) + offset
        if (want > Date.now()) return new Date(want)
        d = new Date(want)
        continue
      }
      if (p.hour < endHour) return d
    }
    const offset = d.getTime() - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
    d = new Date(Date.UTC(p.year, p.month - 1, p.day + 1, p.hour, p.minute) + offset) // carry the candidate's time-of-day
  }
  return candidate
}

function tzParts(d: Date, timezone: string): { weekday: string; year: number; month: number; day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
  const parts: Record<string, string> = {}
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value
  let hour = Number(parts.hour)
  if (hour === 24) hour = 0
  return { weekday: parts.weekday, year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour, minute: Number(parts.minute) }
}

// ── analytics (§55-§61, §102) ─────────────────────────────────────────────

export interface SequenceAnalytics {
  enrolled: number
  active: number
  completed: number
  stopped: number
  replied: number
  bounced: number
  unsubscribed: number
  meetings: number
  sent: number
  delivered: number
  failed: number
  replyRate: number
  meetingRate: number
  stepStats: { position: number; name: string; type: string; completed: number; failed: number; skipped: number }[]
}

// Communication records are the source of truth for email metrics — no
// independent counters that can diverge from history (§102).
export async function sequenceAnalytics(orgId: string, sequenceId: string): Promise<SequenceAnalytics> {
  const enrollments = await prisma.sequenceEnrollment.findMany({ where: { organizationId: orgId, sequenceId }, select: { id: true, status: true, exitReason: true, leadId: true } })
  const leadIds = [...new Set(enrollments.map((e) => e.leadId))]
  const repliedLeads = leadIds.length > 0 ? await prisma.lead.count({ where: { id: { in: leadIds }, outreachStatus: OutreachStatus.REPLIED } }) : 0
  const meetingLeads = leadIds.length > 0 ? await prisma.lead.count({ where: { id: { in: leadIds }, outreachStatus: OutreachStatus.MEETING_BOOKED } }) : 0
  const emails = await prisma.communication.findMany({
    where: { organizationId: orgId, direction: CommunicationDirection.OUTBOUND, metadata: { path: ["sequenceId"], equals: sequenceId } },
    select: { status: true },
  })
  const sent = emails.filter((e) => ([CommunicationStatus.SENT, CommunicationStatus.DELIVERED] as string[]).includes(e.status)).length
  const delivered = emails.filter((e) => e.status === CommunicationStatus.DELIVERED).length
  const failed = emails.filter((e) => e.status === CommunicationStatus.FAILED).length
  const bounced = emails.filter((e) => e.status === CommunicationStatus.BOUNCED).length
  const steps = await prisma.sequenceStep.findMany({ where: { sequenceId }, orderBy: { position: "asc" }, select: { position: true, name: true, type: true } })
  const stepStatus = await prisma.sequenceStepExecution.groupBy({ by: ["position", "status"], where: { organizationId: orgId, enrollmentId: { in: enrollments.map((e) => e.id) } }, _count: { _all: true } })
  const perPosition = new Map<number, Record<string, number>>()
  for (const row of stepStatus) {
    const m = perPosition.get(row.position) ?? {}
    m[row.status] = row._count._all
    perPosition.set(row.position, m)
  }
  return {
    enrolled: enrollments.length,
    active: enrollments.filter((e) => e.status === SequenceEnrollmentStatus.ACTIVE).length,
    completed: enrollments.filter((e) => e.exitReason === SequenceExitReason.COMPLETED).length,
    stopped: enrollments.filter((e) => e.status === SequenceEnrollmentStatus.STOPPED).length,
    replied: repliedLeads,
    bounced,
    unsubscribed: enrollments.filter((e) => e.status === SequenceEnrollmentStatus.UNSUBSCRIBED).length,
    meetings: meetingLeads,
    sent,
    delivered,
    failed,
    replyRate: sent > 0 ? repliedLeads / sent : 0,
    meetingRate: enrollments.length > 0 ? meetingLeads / enrollments.length : 0,
    stepStats: steps.map((s) => {
      const m = perPosition.get(s.position) ?? {}
      return { position: s.position, name: s.name, type: s.type, completed: m[SequenceStepExecutionStatus.COMPLETED] ?? 0, failed: m[SequenceStepExecutionStatus.FAILED] ?? 0, skipped: m[SequenceStepExecutionStatus.SKIPPED] ?? 0 }
    }),
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

export async function completeSequenceTask(orgId: string, actor: Actor, taskId: string): Promise<void> {
  const task = await prisma.sequenceTask.findFirst({ where: { id: taskId, organizationId: orgId } })
  if (!task) throw new Error("Task not found")
  if (actor.role !== "ADMIN" && task.assignedToId && task.assignedToId !== actor.id) throw new Error("You can only complete your own tasks")
  await prisma.sequenceTask.update({ where: { id: taskId }, data: { completedAt: new Date() } })
  if (task.enrollmentId) {
    // Wake the enrollment so the scan advances past the completed task.
    await prisma.sequenceEnrollment.updateMany({ where: { id: task.enrollmentId, status: SequenceEnrollmentStatus.ACTIVE, nextRunAt: null }, data: { nextRunAt: new Date() } })
  }
}

async function audit(orgId: string, action: SequenceAuditAction, actor: Actor | null, sequenceId: string | null, details?: Record<string, unknown>) {
  await prisma.sequenceAuditEvent.create({
    data: {
      organizationId: orgId,
      action,
      sequenceId,
      actorUserId: actor?.id ?? null,
      actorName: actor?.name ?? null,
      details: details && Object.keys(details).length > 0 ? (details as object) : undefined,
    },
  })
}
