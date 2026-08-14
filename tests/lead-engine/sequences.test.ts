// TASK 016: automated outreach sequences & follow-up engine (§100-§126).
// Real-DB integration tests with the file-backed dev mail provider — no real
// email is ever sent. Deterministic: steps are advanced by calling
// executeNextStep directly (never the dev interval), and outbox messages are
// drained manually after each send.

import { describe, it, expect, afterAll, beforeAll } from "vitest"
import { prisma } from "@/lib/db"
import {
  CommunicationDirection,
  CommunicationStatus,
  EmailStatus,
  OutreachStatus,
  SequenceEnrollmentStatus,
  SequenceExitReason,
  SequenceStatus,
  SequenceStepExecutionStatus,
  SequenceStepType,
} from "@/generated/prisma/enums"
import { processOutboxMessage, processProviderWebhook } from "@/lib/lead-engine/outreach/service"
import { registerEmailProvider } from "@/lib/lead-engine/email/providers/registry"
import type { EmailProvider } from "@/lib/lead-engine/email/providers/types"
import { updateSettings } from "@/lib/lead-engine/email/service"
import {
  createSequence,
  updateSequence,
  setSequenceStatus,
  enrollLead,
  executeNextStep,
  nextAllowableAt,
  evaluateCondition,
  completeSequenceTask,
  sequenceAnalytics,
  type StepInput,
} from "@/lib/lead-engine/sequences/service"

const orgIds: string[] = []

const newOrg = async () => {
  const org = await prisma.organization.create({
    data: { name: `Seq Test Org ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  })
  orgIds.push(org.id)
  return org
}

const newActor = async (orgId: string, role: "ADMIN" | "MEMBER" = "ADMIN") => {
  const user = await prisma.user.create({
    data: {
      organizationId: orgId,
      name: `Seq user ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      email: `seq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
      passwordHash: "test",
      role,
    },
  })
  return { id: user.id, name: user.name, role }
}

const seedLead = async (orgId: string, over: Record<string, unknown> = {}, emailStatus: EmailStatus | null = EmailStatus.VERIFIED) => {
  const company = await prisma.company.create({
    data: { organizationId: orgId, name: "Acme Seq", normalizedName: "acme seq", domain: `acme-seq-${Math.random().toString(36).slice(2, 8)}.test.local` },
  })
  const contact = await prisma.contact.create({
    data: {
      organizationId: orgId,
      companyId: company.id,
      firstName: "Jane",
      lastName: "Doe",
      fullName: "Jane Doe",
      jobTitle: "CTO",
      email: `jane-${Math.random().toString(36).slice(2, 8)}@acme-seq.test.local`,
    },
  })
  const lead = await prisma.lead.create({
    data: {
      organizationId: orgId,
      companyId: company.id,
      contactId: contact.id,
      title: "Acme Corp",
      status: "NEW",
      outreachStatus: OutreachStatus.NOT_CONTACTED,
      contactReadiness: 80,
      score: 90,
      ...over,
    },
  })
  if (emailStatus) {
    await prisma.emailAddress.create({
      data: {
        organizationId: orgId,
        leadId: lead.id,
        contactId: contact.id,
        email: contact.email!,
        normalizedEmail: contact.email!.toLowerCase(),
        status: emailStatus,
        isPrimary: true,
        sourceType: "MANUAL",
        provider: "test",
        observedAt: new Date(),
      },
    })
  }
  return { lead, contact, company }
}

const emailStep = (name: string, subject: string, body: string): StepInput => ({ type: SequenceStepType.EMAIL, name, config: { subject, body } })
const waitStep = (name: string, duration: number, unit = "DAYS"): StepInput => ({ type: SequenceStepType.WAIT, name, config: { duration, unit } })
const endStep = (name: string): StepInput => ({ type: SequenceStepType.END, name, config: {} })

// Permissive settings so the sequence engine (not org policy) is under test.
const permissiveSettings = async (orgId: string, actor: { id: string; name: string; role: string }) => {
  await updateSettings(orgId, {
    sendingEnabled: true,
    dailySendLimit: 1000,
    hourlySendLimit: 1000,
    minDaysBetweenOutreach: 0,
    allowSendToUnverified: true,
  }, actor)
}

const makeActiveSequence = async (orgId: string, actor: { id: string; name: string; role: string }, steps: StepInput[], over: Record<string, unknown> = {}) => {
  const sequence = await createSequence(orgId, actor, { name: `Seq ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...over })
  await updateSequence(orgId, actor, sequence.id, { steps })
  await setSequenceStatus(orgId, actor, sequence.id, SequenceStatus.ACTIVE)
  return sequence
}

// Same throwaway webhook provider as the TASK 015 tests (§56-§58): lets tests
// simulate provider events (reply/bounce/unsubscribe) end to end.
const webhookProvider: EmailProvider = {
  id: "webhook-test",
  name: "Webhook Test",
  capabilities: ["SENDING"],
  send: async () => ({ ok: true }),
  parseWebhook: (payload) =>
    (payload as { events: Array<{ id: string; type: string; subjectId?: string; email?: string; subject?: string; body?: string; bounceType?: string }> }).events.map((e) => ({
      providerEventId: e.id,
      eventType: e.type as never,
      subjectId: e.subjectId,
      email: e.email,
      subject: e.subject,
      body: e.body,
      bounceType: e.bounceType as "hard" | "soft" | undefined,
    })),
}

// Dev provider writes the sent file on processOutboxMessage; drain this org's
// pending outbox rows so Communications reach SENT deterministically.
async function drainOutbox(orgId: string) {
  // sendEmail's setImmediate may claim the row first; flush the check phase
  // and mop up leftovers so SENT is guaranteed before assertions.
  for (let round = 0; round < 2; round++) {
    const messages = await prisma.outboxMessage.findMany({ where: { status: { not: "SENT" }, communication: { organizationId: orgId } } })
    for (const m of messages) await processOutboxMessage(m.id)
    if (messages.length === 0) return
    await new Promise((r) => setImmediate(r))
  }
}

const sentFor = async (orgId: string, leadId: string) =>
  prisma.communication.findMany({ where: { organizationId: orgId, leadId, direction: CommunicationDirection.OUTBOUND, status: CommunicationStatus.SENT }, orderBy: { createdAt: "asc" } })

describe("TASK 016 sequences", () => {
  beforeAll(() => {
    process.env.EMAIL_PROVIDER_MODE = "development"
    registerEmailProvider(webhookProvider)
  })

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
  })

  it("activation validates the graph: empty, cycle, unknown condition field", async () => {
    const org = await newOrg()
    const a = await newActor(org.id)
    const seq = await createSequence(org.id, a, { name: "Broken" })
    await expect(updateSequence(org.id, a, seq.id, { steps: [] })).rejects.toThrow(/at least one step/)

    const selfLoop: StepInput[] = [
      emailStep("s0", "Hi", "Hello {{first_name}}"),
      { type: SequenceStepType.CONDITION, name: "c1", config: { field: "lead_score", operator: "gt", value: 50, trueStepId: "c1" } },
      endStep("s2"),
    ]
    await updateSequence(org.id, a, seq.id, { steps: selfLoop })
    await expect(setSequenceStatus(org.id, a, seq.id, SequenceStatus.ACTIVE)).rejects.toThrow(/loop|cycle/i)

    const badField: StepInput[] = [
      emailStep("s0", "Hi", "Hello"),
      { type: SequenceStepType.CONDITION, name: "c1", config: { field: "company_size", operator: "gt", value: 5, trueStepId: "s2" } },
      endStep("s2"),
    ]
    await updateSequence(org.id, a, seq.id, { steps: badField })
    await expect(setSequenceStatus(org.id, a, seq.id, SequenceStatus.ACTIVE)).rejects.toThrow(/unsupported condition field/)
  })

  it("non-admin cannot create or modify sequences", async () => {
    const org = await newOrg()
    const admin = await newActor(org.id, "ADMIN")
    const member = await newActor(org.id, "MEMBER")
    await expect(createSequence(org.id, member, { name: "Nope" })).rejects.toThrow(/Admin/)
    const seq = await createSequence(org.id, admin, { name: "Adm" })
    await expect(setSequenceStatus(org.id, member, seq.id, SequenceStatus.ACTIVE)).rejects.toThrow(/Admin/)
  })

  it("email → end: enrollment sends, advances, completes", async () => {
    const org = await newOrg()
    const a = await newActor(org.id)
    await permissiveSettings(org.id, a)
    const { lead } = await seedLead(org.id)
    const seq = await makeActiveSequence(org.id, a, [emailStep("s0", "First", "Hello {{first_name}}"), endStep("s1")])

    const enrolled = await enrollLead(org.id, a, { sequenceId: seq.id, leadId: lead.id })
    expect(enrolled.ok).toBe(true)
    if (!enrolled.ok) return
    const enrollment = await prisma.sequenceEnrollment.findUnique({ where: { id: enrolled.id } })
    expect(enrollment!.status).toBe(SequenceEnrollmentStatus.ACTIVE)

    await executeNextStep(enrolled.id)
    await drainOutbox(org.id)
    const sent = await sentFor(org.id, lead.id)
    expect(sent).toHaveLength(1)
    expect(sent[0].subject).toBe("First")
    expect((sent[0].metadata as Record<string, unknown> | null)?.sequenceId).toBe(seq.id)

    await executeNextStep(enrolled.id)
    const done = await prisma.sequenceEnrollment.findUnique({ where: { id: enrolled.id } })
    expect(done!.status).toBe(SequenceEnrollmentStatus.COMPLETED)
    expect(done!.exitReason).toBe(SequenceExitReason.COMPLETED)
  })

  it("re-enrollment is rejected; do-not-contact and email-less leads cannot enroll", async () => {
    const org = await newOrg()
    const a = await newActor(org.id)
    await permissiveSettings(org.id, a)
    const seq = await makeActiveSequence(org.id, a, [emailStep("s0", "Hi", "Hello"), endStep("s1")])

    const { lead } = await seedLead(org.id)
    const first = await enrollLead(org.id, a, { sequenceId: seq.id, leadId: lead.id })
    expect(first.ok).toBe(true)
    const dup = await enrollLead(org.id, a, { sequenceId: seq.id, leadId: lead.id })
    expect(dup.ok).toBe(false)
    if (dup.ok) return
    expect(dup.code).toBe("ALREADY_ENROLLED")

    const { lead: dnc } = await seedLead(org.id, { doNotContact: true })
    const blocked = await enrollLead(org.id, a, { sequenceId: seq.id, leadId: dnc.id })
    expect(blocked.ok).toBe(false)
    if (blocked.ok) return
    expect(blocked.code).toBe("DO_NOT_CONTACT")

    const { lead: noEmail } = await seedLead(org.id, {}, null)
    const noMail = await enrollLead(org.id, a, { sequenceId: seq.id, leadId: noEmail.id })
    expect(noMail.ok).toBe(false)
    if (noMail.ok) return
    expect(noMail.code).toBe("MISSING_EMAIL")
  })

  it("wait step schedules the next run in the send window; sequence advances only when due", async () => {
    const org = await newOrg()
    const a = await newActor(org.id)
    await permissiveSettings(org.id, a)
    const { lead } = await seedLead(org.id)
    const seq = await makeActiveSequence(org.id, a, [emailStep("s0", "First", "Hello"), waitStep("w1", 2, "DAYS"), emailStep("s2", "Second", "Hi again")])

    const enrolled = await enrollLead(org.id, a, { sequenceId: seq.id, leadId: lead.id })
    if (!enrolled.ok) return
    await executeNextStep(enrolled.id)
    await drainOutbox(org.id)
    expect(await sentFor(org.id, lead.id)).toHaveLength(1)

    await executeNextStep(enrolled.id)
    const enrollment = await prisma.sequenceEnrollment.findUnique({ where: { id: enrolled.id } })
    expect(enrollment!.currentPosition).toBe(2) // moved past the wait
    expect(enrollment!.nextRunAt!.getTime()).toBeGreaterThan(Date.now())

    // Force the wait to elapse, then the second email sends.
    await prisma.sequenceEnrollment.update({ where: { id: enrolled.id }, data: { nextRunAt: new Date() } })
    await executeNextStep(enrolled.id)
    await drainOutbox(org.id)
    const sent = await sentFor(org.id, lead.id)
    expect(sent).toHaveLength(2)
    expect(sent[1].subject).toBe("Second")
  })

  it("reply auto-stops before the next send (§28-§31)", async () => {
    const org = await newOrg()
    const a = await newActor(org.id)
    await permissiveSettings(org.id, a)
    const { lead } = await seedLead(org.id)
    const seq = await makeActiveSequence(org.id, a, [emailStep("s0", "First", "Hello"), emailStep("s1", "Second", "Hi again"), endStep("s2")])

    const enrolled = await enrollLead(org.id, a, { sequenceId: seq.id, leadId: lead.id })
    if (!enrolled.ok) return
    await executeNextStep(enrolled.id)
    await drainOutbox(org.id)
    const comm = (await sentFor(org.id, lead.id))[0]

    const webhook = await processProviderWebhook(org.id, "webhook-test", {
      events: [{ id: `reply-seq-${Date.now()}`, type: "reply", subjectId: comm.providerMessageId, subject: "Re: First", body: "Let's talk" }],
    })
    expect(webhook.ok).toBe(true)
    expect((await prisma.lead.findUnique({ where: { id: lead.id } }))!.outreachStatus).toBe(OutreachStatus.REPLIED)

    await executeNextStep(enrolled.id)
    const stopped = await prisma.sequenceEnrollment.findUnique({ where: { id: enrolled.id } })
    expect(stopped!.status).toBe(SequenceEnrollmentStatus.STOPPED)
    expect(stopped!.exitReason).toBe(SequenceExitReason.REPLIED)
    expect(await sentFor(org.id, lead.id)).toHaveLength(1)
  })

  it("condition step branches on lead_score; missing-data pauses the enrollment", async () => {
    const org = await newOrg()
    const a = await newActor(org.id)
    await permissiveSettings(org.id, a)
    const steps: StepInput[] = [
      emailStep("s0", "First", "Hello {{first_name}}"),
      { type: SequenceStepType.CONDITION, name: "c1", config: { field: "lead_score", operator: "gt", value: 50, trueStepId: "s2", falseStepId: "s3" } },
      endStep("s2"),
      endStep("s3"),
    ]
    const seq = await makeActiveSequence(org.id, a, steps)

    const { lead: hot } = await seedLead(org.id, { score: 90 })
    const h = await enrollLead(org.id, a, { sequenceId: seq.id, leadId: hot.id })
    if (!h.ok) return
    await executeNextStep(h.id)
    await executeNextStep(h.id)
    const hotEnr = await prisma.sequenceEnrollment.findUnique({ where: { id: h.id } })
    expect(hotEnr!.currentPosition).toBe(2) // s0 done, c1 true → s2

    const { lead: cold } = await seedLead(org.id, { score: 10 })
    const c = await enrollLead(org.id, a, { sequenceId: seq.id, leadId: cold.id })
    if (!c.ok) return
    await executeNextStep(c.id)
    await executeNextStep(c.id)
    const coldEnr = await prisma.sequenceEnrollment.findUnique({ where: { id: c.id } })
    expect(coldEnr!.currentPosition).toBe(3) // false branch → s3

    // Missing personalization data → pause, never a malformed send (§51).
    const missing: StepInput[] = [emailStep("m0", "Hey", "Hi {{first_name}} {{sender_name}}"), endStep("m1")]
    const seq2 = await makeActiveSequence(org.id, a, missing)
    const { lead: l2 } = await seedLead(org.id)
    const m = await enrollLead(org.id, a, { sequenceId: seq2.id, leadId: l2.id })
    if (!m.ok) return
    await executeNextStep(m.id)
    const paused = await prisma.sequenceEnrollment.findUnique({ where: { id: m.id } })
    expect(paused!.status).toBe(SequenceEnrollmentStatus.PAUSED)
    expect(paused!.pauseReason).toBe("MISSING_DATA")
  })

  it("task step waits for manual completion, then advances", async () => {
    const org = await newOrg()
    const a = await newActor(org.id)
    await permissiveSettings(org.id, a)
    const steps: StepInput[] = [
      emailStep("s0", "First", "Hello"),
      { type: SequenceStepType.TASK, name: "t1", config: { title: "Call the lead", assignedTo: "CURRENT_OWNER" } },
      emailStep("s2", "Follow up", "Following up"),
      endStep("s3"),
    ]
    const seq = await makeActiveSequence(org.id, a, steps)
    const { lead } = await seedLead(org.id)
    const enrolled = await enrollLead(org.id, a, { sequenceId: seq.id, leadId: lead.id })
    if (!enrolled.ok) return

    await executeNextStep(enrolled.id)
    await drainOutbox(org.id)
    await executeNextStep(enrolled.id) // moves onto the TASK step
    const task = await prisma.sequenceTask.findFirst({ where: { enrollmentId: enrolled.id } })
    expect(task).toBeTruthy()
    expect(task!.assignedToId).toBeNull() // CURRENT_OWNER, but the lead has no owner

    await executeNextStep(enrolled.id) // still waiting — task is open
    let enrollment = await prisma.sequenceEnrollment.findUnique({ where: { id: enrolled.id } })
    expect(enrollment!.currentPosition).toBe(1)

    await completeSequenceTask(org.id, a, task!.id)
    await executeNextStep(enrolled.id) // advance past the resolved task
    await executeNextStep(enrolled.id) // and send the follow-up
    await drainOutbox(org.id)
    enrollment = await prisma.sequenceEnrollment.findUnique({ where: { id: enrolled.id } })
    expect(enrollment!.currentPosition).toBe(3) // moved past the follow-up email
    expect(await sentFor(org.id, lead.id)).toHaveLength(2)
  })

  it("per-sequence daily cap reschedules the next send, not fails it (§45)", async () => {
    const org = await newOrg()
    const a = await newActor(org.id)
    await permissiveSettings(org.id, a)
    const seq = await makeActiveSequence(org.id, a, [emailStep("s0", "First", "Hello"), emailStep("s1", "Second", "Hi"), endStep("s2")], { maxDailyEmails: 1 })
    const { lead } = await seedLead(org.id)
    const enrolled = await enrollLead(org.id, a, { sequenceId: seq.id, leadId: lead.id })
    if (!enrolled.ok) return

    await executeNextStep(enrolled.id)
    await drainOutbox(org.id)
    await executeNextStep(enrolled.id)
    const exec = await prisma.sequenceStepExecution.findUnique({ where: { enrollmentId_position: { enrollmentId: enrolled.id, position: 1 } } })
    expect(exec!.status).toBe(SequenceStepExecutionStatus.SKIPPED)
    const enrollment = await prisma.sequenceEnrollment.findUnique({ where: { id: enrolled.id } })
    expect(enrollment!.nextRunAt!.getTime()).toBeGreaterThan(Date.now())
    expect(await sentFor(org.id, lead.id)).toHaveLength(1)
  })

  it("nextAllowableAt respects the send window, weekends, and blackout dates", async () => {
    const settings = { timezone: "UTC", sendStartHour: 9, sendEndHour: 17, skipWeekends: true, blackoutDates: null }
    const early = new Date("2026-08-10T08:30:00.000Z") // Monday 08:30 UTC
    expect((await nextAllowableAt(early, settings)).toISOString()).toBe("2026-08-10T09:00:00.000Z")

    const saturday = new Date("2026-08-15T10:00:00.000Z") // Saturday, inside window
    expect((await nextAllowableAt(saturday, settings)).toISOString()).toBe("2026-08-17T10:00:00.000Z") // → Monday

    const blackout = { ...settings, blackoutDates: ["2026-08-11"] }
    const tuesday = new Date("2026-08-11T10:00:00.000Z")
    expect((await nextAllowableAt(tuesday, blackout)).toISOString()).toBe("2026-08-12T10:00:00.000Z")
  })

  it("evaluateCondition covers the supported operators", () => {
    const lead = { id: "x", contactId: null, ownerId: null, status: "NEW", score: 75, contactReadiness: 60, outreachStatus: OutreachStatus.NOT_CONTACTED, doNotContact: false, contact: null }
    const email = { status: EmailStatus.VERIFIED }
    expect(evaluateCondition({ field: "lead_score", operator: "gte", value: 75, truePosition: 1, falsePosition: null }, lead, email)).toBe(1)
    expect(evaluateCondition({ field: "lead_score", operator: "lt", value: 75, truePosition: 1, falsePosition: null }, lead, email)).toBeNull()
    expect(evaluateCondition({ field: "email_verified", operator: "eq", value: true, truePosition: 1, falsePosition: null }, lead, email)).toBe(1)
    expect(evaluateCondition({ field: "outreach_status", operator: "in", value: ["REPLIED", "MEETING_BOOKED"], truePosition: 1, falsePosition: null }, lead, email)).toBeNull()
    expect(evaluateCondition({ field: "company_size", operator: "gt", value: 10, truePosition: 1, falsePosition: null }, lead, email)).toBeNull() // unsupported → false branch
  })

  it("analytics derives reply/meeting/bounce counts from Communications", async () => {
    const org = await newOrg()
    const a = await newActor(org.id)
    await permissiveSettings(org.id, a)
    const seq = await makeActiveSequence(org.id, a, [emailStep("s0", "First", "Hello"), endStep("s1")])
    const { lead } = await seedLead(org.id)
    const enrolled = await enrollLead(org.id, a, { sequenceId: seq.id, leadId: lead.id })
    if (!enrolled.ok) return
    await executeNextStep(enrolled.id)
    await drainOutbox(org.id)

    const stats = await sequenceAnalytics(org.id, seq.id)
    expect(stats.enrolled).toBe(1)
    expect(stats.sent).toBe(1)
    expect(stats.completed).toBe(0)
    expect(stats.stepStats[0].completed).toBe(1)
  })
})
