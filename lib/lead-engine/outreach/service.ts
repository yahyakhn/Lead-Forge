// TASK 015: sales outreach & communication workspace.
//
// User-initiated, explicit-send only (§101): nothing in this module sends
// automatically. Sending flows: composer → Communication(QUEUED) →
// OutboxMessage(PENDING) → in-process worker → provider → SENT. Pre-send
// safety is re-checked in the worker, never trusted from the frontend (§24).

import { randomUUID, timingSafeEqual } from "node:crypto"
import { prisma } from "@/lib/db"
import {
  CallOutcome,
  CommunicationChannel,
  CommunicationDirection,
  CommunicationStatus,
  EmailStatus,
  EmailTemplateCategory,
  EmailTemplateStatus,
  EmailAccountStatus,
  OutreachStatus,
  EmailAuditAction,
} from "@/generated/prisma/enums"
import type { Communication, EmailAccount, EmailSettings, EmailTemplate, Lead } from "@/generated/prisma/client"
import { emailProviderRegistry } from "@/lib/lead-engine/email/providers/registry"
import type { EmailProviderEvent } from "@/lib/lead-engine/email/providers/types"
import { getSettings, listEntityEmails, updateSettings as updateEmailSettings } from "@/lib/lead-engine/email/service"
import { outreachPriority, outreachReadiness, type OutreachReadinessInput } from "@/lib/lead-engine/outreach/priority"
import { plainTextBody, renderTemplate, type TemplateContext } from "@/lib/lead-engine/outreach/templates"
import { createActivity } from "@/lib/crm/activities"
import { parsePagination, type PageResult } from "@/lib/crm/pagination"
import { enqueueOutboxMessage } from "@/lib/lead-engine/job-queue"

export type Actor = { id: string; name: string; role?: string }

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_SUBJECT_LENGTH = 200
const MAX_SEND_ATTEMPTS = 2

// ── provider resolution (§15-§17) ─────────────────────────────────────────

export function sendProviderMode(): "development" | "production" {
  return (process.env.EMAIL_PROVIDER_MODE ?? (process.env.NODE_ENV === "production" ? "production" : "development")) as "development" | "production"
}

export function resolveSendProvider(): string | null {
  if (sendProviderMode() === "development") return "dev"
  const smtp = emailProviderRegistry.sending("smtp")
  if (smtp && process.env.EMAIL_SMTP_HOST) return "smtp"
  return null
}

export function sendProviderConfigured(): boolean {
  return resolveSendProvider() !== null
}

// ── outreach queue (§3-§4, §78-§82) ───────────────────────────────────────

export interface SalesQueueFilters {
  page?: string
  pageSize?: string
  search?: string
  owner?: string // "mine" | "team" | lead ownerId
  outreachStatus?: string
  readiness?: string
  hasReply?: string
  hasBounced?: string
  unsubscribed?: string
  dueNextAction?: string
}

export interface SalesQueueRow {
  id: string
  title: string | null
  companyName: string | null
  contactName: string | null
  contactFirstName: string | null
  icpScore: number | null
  overallScore: number | null
  contactReadiness: number | null
  emailStatus: EmailStatus | null
  emailStatuses: EmailStatus[]
  outreachStatus: OutreachStatus
  nextAction: string | null
  nextActionAt: Date | null
  lastActivityAt: Date | null
  lastOutboundAt: Date | null
  createdAt: Date
  ownerName: string | null
  readinessState: string
  readinessReasons: string[]
  priority: number
  priorityBreakdown: { score: number; readiness: number; email: number; recency: number; ownership: number; reply: number }
}

const ACTIVE_OUTBOUND_STATUSES: CommunicationStatus[] = [CommunicationStatus.QUEUED, CommunicationStatus.SENDING, CommunicationStatus.SENT, CommunicationStatus.DELIVERED]

export async function lastOutboundToLead(orgId: string, leadId: string, excludeId?: string): Promise<Communication | null> {
  return prisma.communication.findFirst({
    where: {
      organizationId: orgId,
      leadId,
      channel: CommunicationChannel.EMAIL,
      direction: CommunicationDirection.OUTBOUND,
      status: { in: ACTIVE_OUTBOUND_STATUSES },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    orderBy: { createdAt: "desc" },
  })
}

export async function queueLeads(orgId: string, viewerId: string, raw: SalesQueueFilters): Promise<PageResult<SalesQueueRow>> {
  const { page, pageSize } = parsePagination(raw)
  const settings = await getSettings(orgId)

  const where: Record<string, unknown> = { organizationId: orgId }
  if (raw.search) {
    where.OR = [
      { title: { contains: raw.search, mode: "insensitive" } },
      { company: { name: { contains: raw.search, mode: "insensitive" } } },
      { contact: { fullName: { contains: raw.search, mode: "insensitive" } } },
      { contact: { email: { contains: raw.search, mode: "insensitive" } } },
    ]
  }
  if (raw.owner === "mine") where.ownerId = viewerId
  else if (raw.owner === "team") where.ownerId = { not: null }
  else if (raw.owner && raw.owner !== "all") where.ownerId = raw.owner
  if (raw.outreachStatus && raw.outreachStatus !== "all") where.outreachStatus = raw.outreachStatus

  // Bounded pool: readiness/priority are computed in TS (they depend on
  // per-email statuses); pull the freshest high-readiness leads then rank.
  // ponytail: pool cap 500 — raise when orgs exceed ~2k active leads.
  const leads = await prisma.lead.findMany({
    where: where as never,
    orderBy: [{ contactReadiness: "desc" }, { score: "desc" }, { createdAt: "desc" }],
    take: 500,
    include: {
      contact: { select: { id: true, firstName: true, fullName: true, email: true, doNotContact: true } },
      company: { select: { name: true } },
      owner: { select: { id: true, name: true } },
      emailAddresses: { select: { id: true, status: true, email: true } },
      scores: { where: { scoreStatus: "CURRENT" }, orderBy: { scoredAt: "desc" }, take: 1, select: { icpScore: true, overallScore: true } },
    },
  })

  const enriched = await Promise.all(
    leads.map(async (lead) => {
      const lastOutbound = await lastOutboundToLead(orgId, lead.id)
      const readinessInput: OutreachReadinessInput = {
        status: lead.status,
        doNotContact: lead.doNotContact,
        contactDoNotContact: lead.contact?.doNotContact,
        hasContact: Boolean(lead.contact),
        emailStatuses: lead.emailAddresses.map((e) => e.status),
        allowUnverified: settings.allowSendToUnverified,
        minDaysBetweenOutreach: settings.minDaysBetweenOutreach,
        lastOutboundAt: lastOutbound?.createdAt,
      }
      const readiness = outreachReadiness(readinessInput)
      const priority = outreachPriority({ id: lead.id, score: lead.scores[0]?.overallScore ?? lead.score, contactReadiness: lead.contactReadiness, emailStatuses: lead.emailAddresses.map((e) => e.status), outreachStatus: lead.outreachStatus, lastActivityAt: lead.lastActivityAt, createdAt: lead.createdAt, ownerId: lead.ownerId }, viewerId)
      return { lead, lastOutbound, readiness, priority }
    }),
  )

  let rows = enriched
    .map<SalesQueueRow>(({ lead, lastOutbound, readiness, priority }) => ({
      id: lead.id,
      title: lead.title,
      companyName: lead.company?.name ?? null,
      contactName: lead.contact?.fullName ?? null,
      contactFirstName: lead.contact?.firstName ?? null,
      icpScore: lead.scores[0]?.icpScore ?? null,
      overallScore: lead.scores[0]?.overallScore ?? lead.score,
      contactReadiness: lead.contactReadiness,
      emailStatus: lead.emailStatus,
      emailStatuses: lead.emailAddresses.map((e) => e.status),
      outreachStatus: lead.outreachStatus,
      nextAction: lead.nextAction,
      nextActionAt: lead.nextActionAt,
      lastActivityAt: lead.lastActivityAt,
      lastOutboundAt: lastOutbound?.createdAt ?? null,
      createdAt: lead.createdAt,
      ownerName: lead.owner?.name ?? null,
      readinessState: readiness.state,
      readinessReasons: readiness.reasons,
      priority: priority.priority,
      priorityBreakdown: priority.breakdown,
    }))
    .filter((r) => {
      if (raw.readiness && raw.readiness !== "all" && r.readinessState !== raw.readiness) return false
      if (raw.hasReply === "true" && r.outreachStatus !== OutreachStatus.REPLIED) return false
      if (raw.hasBounced === "true" && r.emailStatuses.some((s) => s === EmailStatus.INVALID)) return false
      if (raw.unsubscribed === "true" && !r.emailStatuses.some((s) => s === EmailStatus.UNSUBSCRIBED)) return false
      if (raw.dueNextAction === "true" && !(r.nextActionAt && r.nextActionAt <= new Date())) return false
      return true
    })
    .sort((a, b) => (b.priority - a.priority) || b.createdAt.getTime() - a.createdAt.getTime())

  const total = rows.length
  const start = (page - 1) * pageSize
  rows = rows.slice(start, start + pageSize)
  return { data: rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

// ── email accounts (§18, §64-§66) ─────────────────────────────────────────

export async function listEmailAccounts(orgId: string): Promise<EmailAccount[]> {
  return prisma.emailAccount.findMany({ where: { organizationId: orgId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] })
}

function requireAdmin(actor: Actor) {
  if (actor.role !== "ADMIN") throw new Error("Admin access required")
}

export async function createEmailAccount(orgId: string, actor: Actor, input: { provider?: string; name: string; email: string; isDefault?: boolean }) {
  requireAdmin(actor)
  if (!EMAIL_REGEX.test(input.email)) throw new Error("Invalid sender email address")
  if (input.isDefault) await prisma.emailAccount.updateMany({ where: { organizationId: orgId, isDefault: true }, data: { isDefault: false } })
  const account = await prisma.emailAccount.create({
    data: { organizationId: orgId, provider: input.provider ?? "smtp", name: input.name, email: input.email, isDefault: input.isDefault ?? false },
  })
  if (account.isDefault) await updateEmailSettings(orgId, { senderEmail: account.email, senderName: account.name }, actor)
  return account
}

export async function setDefaultEmailAccount(orgId: string, actor: Actor, accountId: string) {
  requireAdmin(actor)
  const account = await prisma.emailAccount.findFirst({ where: { id: accountId, organizationId: orgId } })
  if (!account) throw new Error("Email account not found")
  await prisma.$transaction([
    prisma.emailAccount.updateMany({ where: { organizationId: orgId, isDefault: true }, data: { isDefault: false } }),
    prisma.emailAccount.update({ where: { id: accountId }, data: { isDefault: true } }),
  ])
  await updateEmailSettings(orgId, { senderEmail: account.email, senderName: account.name }, actor)
}

export async function updateEmailAccountStatus(orgId: string, actor: Actor, accountId: string, status: EmailAccountStatus) {
  requireAdmin(actor)
  const account = await prisma.emailAccount.findFirst({ where: { id: accountId, organizationId: orgId } })
  if (!account) throw new Error("Email account not found")
  if (status === EmailAccountStatus.DISABLED && account.isDefault) throw new Error("Cannot disable the default account")
  return prisma.emailAccount.update({ where: { id: accountId }, data: { status } })
}

// ── templates (§31-§37) ───────────────────────────────────────────────────

export async function listEmailTemplates(orgId: string, includeArchived = false): Promise<EmailTemplate[]> {
  return prisma.emailTemplate.findMany({
    where: { organizationId: orgId, ...(includeArchived ? {} : { status: EmailTemplateStatus.ACTIVE }) },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  })
}

export async function getEmailTemplate(orgId: string, id: string): Promise<EmailTemplate | null> {
  return prisma.emailTemplate.findFirst({ where: { id, organizationId: orgId } })
}

export async function createEmailTemplate(
  orgId: string,
  actor: Actor,
  input: { name: string; description?: string; category: EmailTemplateCategory; subject: string; body: string },
) {
  const name = input.name.trim()
  if (!name) throw new Error("Template name is required")
  if (!input.subject.trim()) throw new Error("Template subject is required")
  if (!input.body.trim()) throw new Error("Template body is required")
  const existing = await prisma.emailTemplate.findUnique({ where: { organizationId_name: { organizationId: orgId, name } } })
  if (existing) throw new Error("A template with this name already exists")
  return prisma.emailTemplate.create({
    data: { organizationId: orgId, name, description: input.description?.trim() ?? null, category: input.category, subject: input.subject.trim(), body: input.body.trim(), createdById: actor.id },
  })
}

export async function updateEmailTemplate(orgId: string, id: string, input: { name?: string; description?: string; category?: EmailTemplateCategory; subject?: string; body?: string }) {
  const template = await getEmailTemplate(orgId, id)
  if (!template) throw new Error("Template not found")
  return prisma.emailTemplate.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() ?? null } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.subject !== undefined ? { subject: input.subject.trim() } : {}),
      ...(input.body !== undefined ? { body: input.body.trim() } : {}),
    },
  })
}

export async function duplicateEmailTemplate(orgId: string, actor: Actor, id: string) {
  const template = await getEmailTemplate(orgId, id)
  if (!template) throw new Error("Template not found")
  let name = `${template.name} (copy)`
  let n = 2
  while (await prisma.emailTemplate.findUnique({ where: { organizationId_name: { organizationId: orgId, name } } })) {
    name = `${template.name} (copy ${n++})`
  }
  return prisma.emailTemplate.create({
    data: { organizationId: orgId, name, description: template.description, category: template.category, subject: template.subject, body: template.body, status: EmailTemplateStatus.ACTIVE, createdById: actor.id },
  })
}

// Archive, never delete — templates are referenced by communication history
// (§36). Archived templates are hidden from the composer but kept for
// rendering past communications.
export async function archiveEmailTemplate(orgId: string, id: string) {
  const template = await getEmailTemplate(orgId, id)
  if (!template) throw new Error("Template not found")
  return prisma.emailTemplate.update({ where: { id }, data: { status: template.status === EmailTemplateStatus.ARCHIVED ? EmailTemplateStatus.ACTIVE : EmailTemplateStatus.ARCHIVED } })
}

export interface ComposerTemplate {
  id: string
  name: string
  category: EmailTemplateCategory
  subject: string
  body: string
  missing: string[]
}

export interface ComposerContext {
  lead: Lead & { contact: { firstName: string | null; fullName: string | null; email: string | null; jobTitle: string | null; doNotContact: boolean } | null; company: { name: string } | null; emailAddresses: { id: string; status: EmailStatus }[]; scores: { icpScore: number; overallScore: number; qualification: string }[] }
  emails: Awaited<ReturnType<typeof listEntityEmails>>
  templates: ComposerTemplate[]
  accounts: EmailAccount[]
  settings: EmailSettings
  lastOutbound: Communication | null
  readiness: { state: string; reasons: string[] }
  warnings: { unverified: boolean; cooldownDays: number | null; dailyLimitPct: number; blocked: { code: string; message: string } | null }
}

export async function getComposerContext(orgId: string, leadId: string): Promise<ComposerContext | null> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId: orgId },
    include: {
      contact: { select: { id: true, firstName: true, fullName: true, email: true, jobTitle: true, doNotContact: true } },
      company: { select: { name: true } },
      emailAddresses: { select: { id: true, status: true } },
      scores: { where: { scoreStatus: "CURRENT" }, orderBy: { scoredAt: "desc" }, take: 1, select: { icpScore: true, overallScore: true, qualification: true } },
    },
  })
  if (!lead) return null
  const [settings, emails, accounts, templates, lastOutbound] = await Promise.all([
    getSettings(orgId),
    listEntityEmails(orgId, { leadId }),
    listEmailAccounts(orgId),
    listEmailTemplates(orgId),
    lastOutboundToLead(orgId, leadId),
  ])

  const context: TemplateContext = {
    first_name: lead.contact?.firstName ?? null,
    last_name: null,
    company_name: lead.company?.name ?? null,
    job_title: lead.contact?.jobTitle ?? null,
    sender_name: settings.senderName ?? null,
  }
  const renderedTemplates = templates.map((t) => {
    const subject = renderTemplate(t.subject, context)
    const body = renderTemplate(t.body, context)
    const missing = [...new Set([...subject.missing, ...body.missing])]
    return { id: t.id, name: t.name, category: t.category, subject: subject.subject, body: body.body, missing }
  })
  return {
    lead,
    emails,
    templates: renderedTemplates,
    accounts,
    settings,
    lastOutbound,
    readiness: outreachReadiness({
      status: lead.status,
      doNotContact: lead.doNotContact,
      contactDoNotContact: lead.contact?.doNotContact,
      hasContact: Boolean(lead.contact),
      emailStatuses: lead.emailAddresses.map((e) => e.status),
      allowUnverified: settings.allowSendToUnverified,
      minDaysBetweenOutreach: settings.minDaysBetweenOutreach,
      lastOutboundAt: lastOutbound?.createdAt,
    }),
    warnings: await outreachWarnings(orgId, leadId, settings),
  }
}

// ── safety (§24, §85-§90) ─────────────────────────────────────────────────

export async function countOutboundSince(orgId: string, hours: number, excludeId?: string): Promise<number> {
  const since = new Date(Date.now() - hours * 3600000)
  return prisma.communication.count({
    where: { organizationId: orgId, channel: CommunicationChannel.EMAIL, direction: CommunicationDirection.OUTBOUND, status: { in: ACTIVE_OUTBOUND_STATUSES }, createdAt: { gte: since }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
  })
}

export async function countOutboundToday(orgId: string, excludeId?: string): Promise<number> {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return prisma.communication.count({
    where: { organizationId: orgId, channel: CommunicationChannel.EMAIL, direction: CommunicationDirection.OUTBOUND, status: { in: ACTIVE_OUTBOUND_STATUSES }, createdAt: { gte: start }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
  })
}

export interface SafetyResult {
  ok: boolean
  code?: string
  error?: string
  warnings: { unverified: boolean; cooldownDays: number | null; dailyLimitPct: number }
}

export async function outreachWarnings(orgId: string, leadId: string, settings: EmailSettings): Promise<{ unverified: boolean; cooldownDays: number | null; dailyLimitPct: number; blocked: { code: string; message: string } | null }> {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId: orgId }, include: { contact: { select: { doNotContact: true } }, emailAddresses: { select: { id: true, status: true } } } })
  if (!lead) return { unverified: false, cooldownDays: null, dailyLimitPct: 0, blocked: { code: "NOT_FOUND", message: "Lead not found" } }
  const blocked = await sendBlockReason(orgId, lead, settings, null, true)
  const lastOutbound = await lastOutboundToLead(orgId, leadId)
  let cooldownDays: number | null = null
  if (lastOutbound && settings.minDaysBetweenOutreach > 0) {
    const elapsed = (Date.now() - lastOutbound.createdAt.getTime()) / 86400000
    if (elapsed < settings.minDaysBetweenOutreach) cooldownDays = Math.ceil(settings.minDaysBetweenOutreach - elapsed)
  }
  const sentToday = await countOutboundToday(orgId)
  return { unverified: !settings.allowSendToUnverified && !lead.emailAddresses.some((e) => ["VERIFIED", "LIKELY_VALID"].includes(e.status)), cooldownDays, dailyLimitPct: Math.min(100, Math.round((sentToday / Math.max(1, settings.dailySendLimit)) * 100)), blocked }
}

async function sendBlockReason(orgId: string, lead: { doNotContact: boolean; status: string; contactId: string | null; contact: { doNotContact: boolean } | null; emailAddresses: { id: string; status: EmailStatus }[] }, settings: EmailSettings, emailId: string | null, allowUnverifiedOverride: boolean, excludeId?: string): Promise<{ code: string; message: string } | null> {
  if (lead.doNotContact || lead.contact?.doNotContact) return { code: "DO_NOT_CONTACT", message: "This lead or contact is marked do-not-contact" }
  if (["DISQUALIFIED", "LOST", "CONVERTED"].includes(lead.status)) return { code: "SENDING_DISABLED", message: `Lead status is ${lead.status}` }

  const email = emailId ? lead.emailAddresses.find((e) => e.id === emailId) : null
  if (emailId && !email) return { code: "EMAIL_MISSING", message: "Email not found in this organization" }
  const statuses = email ? [email.status] : lead.emailAddresses.map((e) => e.status)
  if (email) {
    if (email.status === EmailStatus.REJECTED) return { code: "EMAIL_MISSING", message: "This email was rejected and cannot be used" }
    if (email.status === EmailStatus.INVALID) return { code: "INVALID_RECIPIENT", message: "This email was marked invalid" }
    if (email.status === EmailStatus.DO_NOT_CONTACT) return { code: "DO_NOT_CONTACT", message: "This email address is do-not-contact" }
    if (email.status === EmailStatus.UNSUBSCRIBED) return { code: "UNSUBSCRIBED", message: "This email address has unsubscribed" }
  }
  if (!allowUnverifiedOverride && !settings.allowSendToUnverified && !statuses.some((s) => ["VERIFIED", "LIKELY_VALID"].includes(s))) {
    return { code: "EMAIL_UNVERIFIED", message: "No verified email address and organization policy requires verification" }
  }
  if (!settings.sendingEnabled) return { code: "SENDING_DISABLED", message: "Sending is disabled for this organization" }
  if (!sendProviderConfigured()) return { code: "NOT_CONFIGURED", message: "Email provider is not configured." }
  const daily = await countOutboundToday(orgId, excludeId)
  if (daily >= settings.dailySendLimit) return { code: "LIMIT_REACHED", message: `Daily sending limit of ${settings.dailySendLimit} reached` }
  const hourly = await countOutboundSince(orgId, 1, excludeId)
  if (hourly >= settings.hourlySendLimit) return { code: "LIMIT_REACHED", message: `Hourly sending limit of ${settings.hourlySendLimit} reached` }
  return null
}

// §24: backend re-check before any send — never trust the frontend.
export async function checkSendSafety(orgId: string, leadId: string, emailId: string, settings: EmailSettings, opts: { confirmCooldown?: boolean; allowUnverified?: boolean; excludeId?: string } = {}): Promise<SafetyResult> {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId: orgId }, include: { contact: { select: { doNotContact: true } }, emailAddresses: { select: { id: true, status: true } } } })
  if (!lead) return { ok: false, code: "NOT_FOUND", error: "Lead not found", warnings: { unverified: false, cooldownDays: null, dailyLimitPct: 0 } }
  const blocked = await sendBlockReason(orgId, lead, settings, emailId, opts.allowUnverified ?? false, opts.excludeId)
  if (blocked) return { ok: false, code: blocked.code, error: blocked.message, warnings: { unverified: false, cooldownDays: null, dailyLimitPct: 0 } }
  const lastOutbound = await lastOutboundToLead(orgId, leadId, opts.excludeId)
  let cooldownDays: number | null = null
  if (lastOutbound && settings.minDaysBetweenOutreach > 0) {
    const elapsed = (Date.now() - lastOutbound.createdAt.getTime()) / 86400000
    if (elapsed < settings.minDaysBetweenOutreach) {
      cooldownDays = Math.ceil(settings.minDaysBetweenOutreach - elapsed)
      if (!opts.confirmCooldown) return { ok: false, code: "COOLDOWN", error: `An email was sent to this contact ${cooldownDays === 0 ? "today" : `${cooldownDays} day${cooldownDays === 1 ? "" : "s"} ago`}. Confirm to send anyway.`, warnings: { unverified: false, cooldownDays, dailyLimitPct: 0 } }
    }
  }
  const sentToday = await countOutboundToday(orgId)
  return { ok: true, warnings: { unverified: false, cooldownDays, dailyLimitPct: Math.min(100, Math.round((sentToday / Math.max(1, settings.dailySendLimit)) * 100)) } }
}

// ── drafts (§71-§73) ──────────────────────────────────────────────────────

export async function listDrafts(orgId: string, leadId: string): Promise<Communication[]> {
  return prisma.communication.findMany({
    where: { organizationId: orgId, leadId, channel: CommunicationChannel.EMAIL, status: CommunicationStatus.DRAFT },
    orderBy: { updatedAt: "desc" },
    take: 50,
  })
}

export async function saveDraft(orgId: string, actor: Actor, input: { leadId: string; draftId?: string; emailId?: string | null; cc?: string | null; bcc?: string | null; subject: string; body: string; templateId?: string | null }) {
  const data = {
    organizationId: orgId,
    leadId: input.leadId,
    emailId: input.emailId ?? null,
    channel: CommunicationChannel.EMAIL,
    direction: CommunicationDirection.OUTBOUND,
    status: CommunicationStatus.DRAFT,
    subject: input.subject.trim() || null,
    body: input.body.trim() || null,
    cc: input.cc?.trim() || null,
    bcc: input.bcc?.trim() || null,
  }
  if (input.draftId) {
    const existing = await prisma.communication.findFirst({ where: { id: input.draftId, organizationId: orgId, status: CommunicationStatus.DRAFT } })
    if (!existing) throw new Error("Draft not found")
    return prisma.communication.update({ where: { id: input.draftId }, data: { emailId: data.emailId, subject: data.subject, body: data.body, cc: data.cc, bcc: data.bcc, createdById: actor.id } })
  }
  return prisma.communication.create({ data: { ...data, createdById: actor.id } })
}

export async function deleteDraft(orgId: string, actor: Actor, draftId: string) {
  const draft = await prisma.communication.findFirst({ where: { id: draftId, organizationId: orgId, status: CommunicationStatus.DRAFT } })
  if (!draft) throw new Error("Draft not found")
  return prisma.communication.delete({ where: { id: draftId } })
}

// ── send (§22, §25, §29-§30, §69-§70) ─────────────────────────────────────

function validateSubject(subject: string): string | null {
  if (!subject.trim()) return "Subject is required"
  if (subject.length > MAX_SUBJECT_LENGTH) return `Subject must be ${MAX_SUBJECT_LENGTH} characters or fewer`
  if (/[\r\n]/.test(subject)) return "Subject must be a single line"
  return null
}

export async function sendEmail(
  orgId: string,
  actor: Actor,
  input: { leadId: string; emailId: string; cc?: string; bcc?: string; subject: string; body: string; templateId?: string | null; accountId?: string | null; confirmCooldown?: boolean; metadata?: object },
): Promise<{ ok: true; id: string } | { ok: false; code: string; error: string }> {
  const subjectError = validateSubject(input.subject)
  if (subjectError) return { ok: false, code: "MESSAGE_REJECTED", error: subjectError }
  const body = plainTextBody(input.body)
  if (!body) return { ok: false, code: "MESSAGE_REJECTED", error: "Body is required" }

  const lead = await prisma.lead.findFirst({ where: { id: input.leadId, organizationId: orgId }, include: { contact: true } })
  if (!lead) return { ok: false, code: "NOT_FOUND", error: "Lead not found" }
  const email = await prisma.emailAddress.findFirst({ where: { id: input.emailId, organizationId: orgId } })
  if (!email) return { ok: false, code: "EMAIL_MISSING", error: "Email not found in this organization" }
  const belongsToLead = email.leadId === lead.id || (lead.contactId !== null && email.contactId === lead.contactId) || (lead.contact?.email ? email.email === lead.contact.email : false)
  if (!belongsToLead) return { ok: false, code: "EMAIL_MISSING", error: "Email does not belong to this lead" }
  if (!EMAIL_REGEX.test(email.email)) return { ok: false, code: "INVALID_RECIPIENT", error: "Recipient email is malformed" }

  const settings = await getSettings(orgId)
  const safety = await checkSendSafety(orgId, input.leadId, input.emailId, settings, { confirmCooldown: input.confirmCooldown })
  if (!safety.ok) return { ok: false, code: safety.code!, error: safety.error! }

  // Account selection: explicit account (validated) → default → settings sender.
  let account: EmailAccount | null = null
  if (input.accountId) {
    account = (await prisma.emailAccount.findFirst({ where: { id: input.accountId, organizationId: orgId, status: EmailAccountStatus.ACTIVE } })) ?? null
    if (!account) return { ok: false, code: "SENDING_DISABLED", error: "Selected sender is not available" }
  } else {
    account = (await prisma.emailAccount.findFirst({ where: { organizationId: orgId, isDefault: true, status: EmailAccountStatus.ACTIVE } })) ?? null
  }

  // Idempotency: identical content within a 60s window is treated as the same
  // send (§70). Rapid double-clicks hit the unique constraint and are
  // rejected instead of producing duplicates.
  const window = Math.floor(Date.now() / 60_000)
  const idempotencyKey = hash([orgId, email.email, input.subject.trim(), body, window].join("|"))

  const providerId = resolveSendProvider()!
  const prior = await prisma.communication.findFirst({ where: { organizationId: orgId, leadId: input.leadId, channel: CommunicationChannel.EMAIL, direction: CommunicationDirection.OUTBOUND, status: { in: ACTIVE_OUTBOUND_STATUSES } }, orderBy: { createdAt: "asc" } })
  const threadId = prior ? (prior.threadId ?? prior.id) : randomUUID()

  let communicationId: string
  try {
    const communication = await prisma.communication.create({
      data: {
        organizationId: orgId,
        leadId: input.leadId,
        contactId: lead.contactId,
        emailId: email.id,
        threadId,
        channel: CommunicationChannel.EMAIL,
        direction: CommunicationDirection.OUTBOUND,
        status: CommunicationStatus.QUEUED,
        subject: input.subject.trim(),
        body,
        cc: input.cc?.trim() || null,
        bcc: input.bcc?.trim() || null,
        provider: providerId,
        idempotencyKey,
        metadata: { fromName: account?.name ?? null, fromEmail: account?.email ?? null, ...(input.metadata ?? {}) } as object,
        createdById: actor.id,
      },
    })
    communicationId = communication.id
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      return { ok: false, code: "MESSAGE_REJECTED", error: "This message was already submitted moments ago" }
    }
    throw e
  }
  await prisma.outboxMessage.create({ data: { organizationId: orgId, communicationId } })
  enqueueOutboxMessage(communicationId)
  return { ok: true, id: communicationId }
}

function hash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h.toString(36)
}

// ── calls & notes (§44-§46) ───────────────────────────────────────────────

export async function logCall(orgId: string, actor: Actor, input: { leadId: string; contactId?: string | null; durationMin?: number | null; outcome: CallOutcome; notes?: string }) {
  const lead = await prisma.lead.findFirst({ where: { id: input.leadId, organizationId: orgId } })
  if (!lead) throw new Error("Lead not found")
  const communication = await prisma.communication.create({
    data: {
      organizationId: orgId,
      leadId: input.leadId,
      contactId: input.contactId ?? lead.contactId,
      channel: CommunicationChannel.CALL,
      direction: CommunicationDirection.OUTBOUND,
      status: CommunicationStatus.SENT,
      body: input.notes?.trim() || null,
      subject: input.outcome,
      metadata: { durationMin: input.durationMin ?? null, outcome: input.outcome } as object,
      createdById: actor.id,
    },
  })
  await prisma.lead.update({ where: { id: input.leadId }, data: { lastActivityAt: new Date(), ...(lead.outreachStatus === OutreachStatus.NOT_CONTACTED ? { outreachStatus: OutreachStatus.CONTACTED } : {}) } })
  await createActivity(orgId, { type: "CALL", title: `Call — ${input.outcome.replaceAll("_", " ").toLowerCase()}${input.durationMin ? ` (${input.durationMin} min)` : ""}`, description: input.notes?.trim() || undefined, leadId: input.leadId, contactId: input.contactId ?? lead.contactId ?? undefined }, actor.id)
  return communication
}

export async function addNote(orgId: string, actor: Actor, input: { leadId: string; contactId?: string | null; body: string; visibility?: "INTERNAL" }) {
  const lead = await prisma.lead.findFirst({ where: { id: input.leadId, organizationId: orgId } })
  if (!lead) throw new Error("Lead not found")
  const body = plainTextBody(input.body)
  if (!body) throw new Error("Note body is required")
  const communication = await prisma.communication.create({
    data: {
      organizationId: orgId,
      leadId: input.leadId,
      contactId: input.contactId ?? lead.contactId,
      channel: CommunicationChannel.NOTE,
      direction: CommunicationDirection.INTERNAL,
      status: CommunicationStatus.SENT,
      body,
      subject: "Note",
      metadata: { visibility: input.visibility ?? "INTERNAL" } as object,
      createdById: actor.id,
    },
  })
  await prisma.lead.update({ where: { id: input.leadId }, data: { lastActivityAt: new Date() } })
  await createActivity(orgId, { type: "NOTE", title: `Note: ${body.slice(0, 80)}${body.length > 80 ? "…" : ""}`, leadId: input.leadId, contactId: input.contactId ?? lead.contactId ?? undefined }, actor.id)
  return communication
}

// ── next action & outreach status (§48-§50) ───────────────────────────────

export async function updateOutreach(orgId: string, actor: Actor, input: { leadId: string; outreachStatus?: OutreachStatus; nextAction?: string | null; nextActionAt?: Date | null }) {
  const lead = await prisma.lead.findFirst({ where: { id: input.leadId, organizationId: orgId } })
  if (!lead) throw new Error("Lead not found")
  const changes: Record<string, unknown> = {}
  if (input.outreachStatus !== undefined && input.outreachStatus !== lead.outreachStatus) {
    changes.outreachStatus = input.outreachStatus
    if (input.outreachStatus === OutreachStatus.DO_NOT_CONTACT) changes.doNotContact = true
    if (input.outreachStatus !== OutreachStatus.DO_NOT_CONTACT && lead.outreachStatus === OutreachStatus.DO_NOT_CONTACT) changes.doNotContact = false
  }
  if (input.nextAction !== undefined) changes.nextAction = input.nextAction?.trim() || null
  if (input.nextActionAt !== undefined) changes.nextActionAt = input.nextActionAt
  if (Object.keys(changes).length > 0) await prisma.lead.update({ where: { id: lead.id }, data: changes })
  if (input.outreachStatus !== undefined && input.outreachStatus !== lead.outreachStatus) {
    await createActivity(orgId, { type: "STATUS_CHANGE", title: `Outreach status → ${input.outreachStatus.replaceAll("_", " ")}`, leadId: input.leadId }, actor.id)
  }
  return prisma.lead.findUnique({ where: { id: lead.id } })
}

// ── timeline (§38-§43) ────────────────────────────────────────────────────

export async function listCommunications(orgId: string, leadId: string): Promise<Communication[]> {
  return prisma.communication.findMany({
    where: { organizationId: orgId, leadId, status: { not: CommunicationStatus.DRAFT } },
    orderBy: { createdAt: "desc" },
    take: 200,
  })
}

// ── outbox worker (§69, §92, §94) ─────────────────────────────────────────

const TRANSIENT_CODES = new Set(["RATE_LIMITED", "PROVIDER_UNAVAILABLE"])

// In-process claim serialization: concurrent calls for the same message (the
// enqueued worker callback and a direct retry) share one run instead of both
// claiming; the loser awaits the winner.
const inFlight = new Map<string, Promise<void>>()

export async function processOutboxMessage(messageId: string): Promise<void> {
  const existing = inFlight.get(messageId)
  if (existing) return existing
  const run = doProcessOutboxMessage(messageId)
  inFlight.set(messageId, run)
  try {
    await run
  } finally {
    inFlight.delete(messageId)
  }
}

async function doProcessOutboxMessage(messageId: string): Promise<void> {
  const message = await prisma.outboxMessage.findUnique({ where: { id: messageId } })
  if (!message || message.status !== "PENDING") return

  const claimed = await prisma.outboxMessage.updateMany({ where: { id: messageId, status: "PENDING" }, data: { status: "SENDING" } })
  if (claimed.count === 0) return
  const comm = await prisma.communication.findUnique({ where: { id: message.communicationId }, include: { email: true } })
  if (!comm) return

  // Re-check safety at send time (§24) — hard blocks only; soft warnings
  // (cooldown) were confirmed at compose time.
  const settings = await getSettings(comm.organizationId)
  if (comm.leadId) {
    // Soft warnings (cooldown) were confirmed at compose time; re-check only
    // hard blocks at send time.
    const safety = await checkSendSafety(comm.organizationId, comm.leadId, comm.emailId ?? "", settings, { allowUnverified: true, confirmCooldown: true, excludeId: comm.id })
    if (!safety.ok) {
      await failMessage(messageId, comm, safety.code!, safety.error!, actorFrom(comm))
      return
    }
  }

  const provider = emailProviderRegistry.sending(comm.provider ?? "")
  if (!provider) {
    await failMessage(messageId, comm, "NOT_CONFIGURED", "Email provider is not configured.", actorFrom(comm))
    return
  }

  const meta = (comm.metadata as { fromName?: string | null; fromEmail?: string | null } | null) ?? null
  const result = await provider.send({
    to: comm.email?.email ?? "",
    cc: comm.cc ?? undefined,
    bcc: comm.bcc ?? undefined,
    subject: comm.subject ?? "",
    body: comm.body ?? "",
    from: `${meta?.fromName ?? settings.senderName ?? "Sales"} <${meta?.fromEmail ?? settings.senderEmail ?? "sales@example.com"}>`,
    replyTo: settings.replyTo ?? undefined,
  })

  if (result.ok) {
    await prisma.$transaction([
      prisma.communication.update({ where: { id: comm.id }, data: { status: CommunicationStatus.SENT, providerMessageId: result.providerMessageId ?? null, sentAt: new Date() } }),
      prisma.outboxMessage.update({ where: { id: messageId }, data: { status: "SENT" } }),
    ])
    await audit(comm.organizationId, EmailAuditAction.EMAIL_SENT, actorFrom(comm), comm.emailId ?? undefined, { communicationId: comm.id, providerMessageId: result.providerMessageId })
    if (comm.leadId) {
      await prisma.lead.updateMany({ where: { id: comm.leadId, outreachStatus: OutreachStatus.NOT_CONTACTED }, data: { outreachStatus: OutreachStatus.CONTACTED, lastActivityAt: new Date() } })
      const seq = (comm.metadata as { source?: string } | null)?.source === "SEQUENCE"
      await createActivity(comm.organizationId, { type: "EMAIL", title: `${seq ? "Automated sequence email sent" : "Email sent"}${comm.subject ? ` — ${comm.subject}` : ""}`, leadId: comm.leadId, contactId: comm.contactId ?? undefined }, actorFrom(comm)?.id)
    }
  } else {
    const transient = TRANSIENT_CODES.has(result.errorCode ?? "UNKNOWN")
    const nextAttempt = message.attempts + 1
    if (transient && nextAttempt < MAX_SEND_ATTEMPTS) {
      await prisma.outboxMessage.update({ where: { id: messageId }, data: { status: "PENDING", attempts: nextAttempt, errorCode: result.errorCode ?? null, lastError: result.errorMessage ?? null } })
      enqueueOutboxMessage(comm.id)
    } else {
      await failMessage(messageId, comm, result.errorCode ?? "UNKNOWN", result.errorMessage ?? "Send failed", actorFrom(comm))
    }
  }
}

async function failMessage(messageId: string, comm: Communication, code: string, error: string, actor: { id: string; name: string } | null) {
  await prisma.$transaction([
    prisma.communication.update({ where: { id: comm.id }, data: { status: CommunicationStatus.FAILED } }),
    prisma.outboxMessage.update({ where: { id: messageId }, data: { status: "FAILED", attempts: { increment: 1 }, errorCode: code, lastError: error } }),
  ])
  await audit(comm.organizationId, EmailAuditAction.EMAIL_SEND_FAILED, actor, comm.emailId ?? undefined, { communicationId: comm.id, errorCode: code, error })
  if (comm.leadId) {
    await createActivity(comm.organizationId, { type: "EMAIL", title: `Email failed — ${comm.subject ?? ""}`.trim(), description: error, leadId: comm.leadId, contactId: comm.contactId ?? undefined }, actor?.id)
  }
}

function actorFrom(comm: Communication): { id: string; name: string } | null {
  return comm.createdById ? { id: comm.createdById, name: comm.createdById } : null
}

// ── webhooks (§56-§58) ────────────────────────────────────────────────────

export interface WebhookResult {
  ok: boolean
  processed: number
  duplicates: number
  error?: string
}

export function webhookSignatureValid(expected: string, provided: string): boolean {
  if (!expected || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function processProviderWebhook(orgId: string, providerId: string, rawPayload: unknown): Promise<WebhookResult> {
  const provider = emailProviderRegistry.get(providerId)
  if (!provider?.parseWebhook) return { ok: false, processed: 0, duplicates: 0, error: `Provider "${providerId}" does not support webhooks` }

  const events = provider.parseWebhook(rawPayload)
  let processed = 0
  let duplicates = 0
  for (const event of events) {
    const stored = await prisma.emailWebhookEvent.create({
      data: {
        organizationId: orgId,
        providerEventId: event.providerEventId,
        provider: providerId,
        eventType: event.eventType,
        subjectId: event.subjectId ?? null,
        payload: rawPayload as object,
      },
    }).catch((e) => (e?.code === "P2002" ? null : (() => { throw e })()))
    if (!stored) {
      duplicates++
      continue
    }
    await applyProviderEvent(orgId, event)
    processed++
  }
  return { ok: true, processed, duplicates }
}

async function applyProviderEvent(orgId: string, event: EmailProviderEvent) {
  const comm = event.subjectId ? await prisma.communication.findFirst({ where: { organizationId: orgId, providerMessageId: event.subjectId } }) : null
  switch (event.eventType) {
    case "delivered":
      if (comm) {
        await prisma.communication.update({ where: { id: comm.id }, data: { status: CommunicationStatus.DELIVERED, deliveredAt: new Date() } })
        await audit(orgId, EmailAuditAction.EMAIL_DELIVERED, null, comm.emailId ?? undefined, { communicationId: comm.id })
      }
      break
    case "failed":
      if (comm) {
        await prisma.communication.update({ where: { id: comm.id }, data: { status: CommunicationStatus.FAILED } })
        await audit(orgId, EmailAuditAction.EMAIL_SEND_FAILED, null, comm.emailId ?? undefined, { communicationId: comm.id })
      }
      break
    case "bounced": {
      if (!comm) break
      const hard = event.bounceType === "hard"
      await prisma.communication.update({ where: { id: comm.id }, data: { status: hard ? CommunicationStatus.BOUNCED : CommunicationStatus.TEMPORARY_FAILURE } })
      await audit(orgId, EmailAuditAction.EMAIL_BOUNCED, null, comm.emailId ?? undefined, { communicationId: comm.id, bounceType: event.bounceType ?? "soft" })
      // Hard bounce → update the email's contactability state (§52, §54).
      // Soft bounce → nothing else; bounded retry is a future sequence step.
      if (hard && comm.emailId) {
        await prisma.emailAddress.update({ where: { id: comm.emailId }, data: { status: EmailStatus.INVALID, expiresAt: null, isPrimary: false } })
      }
      break
    }
    case "opened":
      if (comm) {
        await prisma.communication.update({ where: { id: comm.id }, data: { openedAt: new Date() } })
        await audit(orgId, EmailAuditAction.EMAIL_OPENED, null, comm.emailId ?? undefined, { communicationId: comm.id })
      }
      break
    case "clicked":
      if (comm) {
        await prisma.communication.update({ where: { id: comm.id }, data: { clickedAt: new Date() } })
        await audit(orgId, EmailAuditAction.EMAIL_CLICKED, null, comm.emailId ?? undefined, { communicationId: comm.id })
      }
      break
    case "unsubscribe":
    case "complaint": {
      const email = event.email ? await prisma.emailAddress.findFirst({ where: { organizationId: orgId, email: event.email } }) : comm?.emailId ? await prisma.emailAddress.findUnique({ where: { id: comm.emailId } }) : null
      if (email && email.status !== EmailStatus.UNSUBSCRIBED) {
        await prisma.emailAddress.update({ where: { id: email.id }, data: { status: EmailStatus.UNSUBSCRIBED } })
        await audit(orgId, EmailAuditAction.EMAIL_UNSUBSCRIBED, null, email.id, { communicationId: comm?.id })
      }
      break
    }
    case "reply": {
      if (!comm) break
      await prisma.communication.create({
        data: {
          organizationId: orgId,
          leadId: comm.leadId,
          contactId: comm.contactId,
          emailId: comm.emailId,
          threadId: comm.threadId ?? comm.id,
          inReplyToId: comm.id,
          channel: CommunicationChannel.EMAIL,
          direction: CommunicationDirection.INBOUND,
          status: CommunicationStatus.SENT,
          subject: event.subject ?? comm.subject ?? null,
          body: event.body ?? null,
          provider: comm.provider,
        },
      })
      if (comm.leadId) {
        await prisma.lead.update({ where: { id: comm.leadId }, data: { outreachStatus: OutreachStatus.REPLIED, lastActivityAt: new Date() } })
        await createActivity(comm.organizationId, { type: "EMAIL", title: `Reply received${comm.subject ? ` — ${comm.subject}` : ""}`, leadId: comm.leadId, contactId: comm.contactId ?? undefined })
      }
      await audit(orgId, EmailAuditAction.EMAIL_REPLY_RECEIVED, null, comm.emailId ?? undefined, { communicationId: comm.id })
      break
    }
  }
}

async function audit(orgId: string, action: EmailAuditAction, actor: { id: string; name: string } | null, emailId?: string, details?: Record<string, unknown>) {
  await prisma.emailEvent.create({
    data: {
      organizationId: orgId,
      emailId: emailId ?? null,
      action,
      actorUserId: actor?.id ?? null,
      actorName: actor?.name ?? null,
      details: details && Object.keys(details).length > 0 ? (details as object) : undefined,
    },
  })
}

// ── dashboard helpers (§77-§80) ───────────────────────────────────────────

export async function salesDashboardCounts(orgId: string) {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const [queueReady, emailsSentToday, replies, followUpsDue, bounces, unsubscribed] = await Promise.all([
    prisma.lead.count({ where: { organizationId: orgId, doNotContact: false, contact: { isNot: null }, emailStatus: { in: ["VERIFIED", "LIKELY_VALID"] }, outreachStatus: { notIn: [OutreachStatus.DO_NOT_CONTACT, OutreachStatus.DISQUALIFIED] } } }),
    prisma.communication.count({ where: { organizationId: orgId, channel: CommunicationChannel.EMAIL, direction: CommunicationDirection.OUTBOUND, status: { in: [CommunicationStatus.QUEUED, CommunicationStatus.SENDING, CommunicationStatus.SENT, CommunicationStatus.DELIVERED] }, createdAt: { gte: startOfDay } } }),
    prisma.lead.count({ where: { organizationId: orgId, outreachStatus: OutreachStatus.REPLIED } }),
    prisma.lead.count({ where: { organizationId: orgId, nextActionAt: { lte: new Date() }, outreachStatus: { notIn: [OutreachStatus.DO_NOT_CONTACT, OutreachStatus.DISQUALIFIED] } } }),
    prisma.communication.count({ where: { organizationId: orgId, channel: CommunicationChannel.EMAIL, status: CommunicationStatus.BOUNCED } }),
    prisma.emailAddress.count({ where: { organizationId: orgId, status: EmailStatus.UNSUBSCRIBED } }),
  ])
  return { queueReady, emailsSentToday, replies, followUpsDue, bounces, unsubscribed }
}
