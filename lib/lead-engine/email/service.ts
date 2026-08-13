// TASK 014: email discovery & verification orchestration — requests, job
// execution, dedupe, provenance, conflicts, history, manual overrides,
// readiness + quality integration, bulk operations. All queries org-scoped.

import { prisma } from "@/lib/db"
import {
  EmailAuditAction,
  EmailConflictResolution,
  EmailConflictStatus,
  EmailDiscoveryJobStatus,
  EmailStatus,
  EmailType,
  EmailVerificationBatchStatus,
  EmailVerificationJobStatus,
  ScoreStatus,
  CandidateStatus,
} from "@/generated/prisma/enums"
import type { EmailAddress, EmailSettings, Lead, LeadCandidate } from "@/generated/prisma/client"
import { emailProviderRegistry } from "@/lib/lead-engine/email/providers/registry"
import type { EmailDiscoveryEvidence, EmailVerificationResult } from "@/lib/lead-engine/email/providers/types"
import { classifyEmailType, domainMatch, normalizeEmailAddress } from "@/lib/lead-engine/email/normalize"
import { calculateReadiness, persistReadiness } from "@/lib/lead-engine/email/readiness"
import { qualityFields } from "@/lib/lead-engine/resolution/service"
import { requestEnrichment } from "@/lib/lead-engine/enrichment/service"
import { startBulkScoring } from "@/lib/lead-engine/scoring/service"
import { enqueueScoringJob, enqueueEnrichmentJob } from "@/lib/lead-engine/job-queue"

// ── default settings (per-org overrides via EmailSettings) ────────────────

export const DEFAULT_SETTINGS = {
  discoveryEnabled: (process.env.EMAIL_DISCOVERY_ENABLED ?? "true") !== "false",
  verificationEnabled: (process.env.EMAIL_VERIFICATION_ENABLED ?? "true") !== "false",
  enrichmentFallback: true,
  verificationCacheDays: Number(process.env.VERIFICATION_CACHE_DAYS ?? 14),
  discoveryFreshnessDays: 14,
  batchMaxEmails: Number(process.env.MAX_VERIFICATION_BATCH ?? 200),
  discoveryRateLimit: Number(process.env.DISCOVERY_RATE_LIMIT ?? 60),
  verificationRateLimit: Number(process.env.VERIFICATION_RATE_LIMIT ?? 120),
}

const MAX_RETRIES = 2
const ACTIVE_STATUSES = [EmailDiscoveryJobStatus.QUEUED, EmailDiscoveryJobStatus.RUNNING] as EmailDiscoveryJobStatus[]
const SUCCESS_STATUSES = [EmailDiscoveryJobStatus.COMPLETED, EmailDiscoveryJobStatus.PARTIAL] as EmailDiscoveryJobStatus[]
const RETRYABLE_ERRORS = new Set<string | null | undefined>(["NETWORK_ERROR", "TIMEOUT", "DNS_ERROR", "RATE_LIMITED", null])

const VALID_EMAIL_STATUSES: EmailStatus[] = [EmailStatus.DISCOVERED, EmailStatus.VERIFIED, EmailStatus.LIKELY_VALID, EmailStatus.RISKY, EmailStatus.DISPOSABLE, EmailStatus.CONFLICT, EmailStatus.STALE]

const round2 = (n: number) => Math.round(n * 100) / 100

// ── rate limiting (§27) ───────────────────────────────────────────────────
// ponytail: in-process fixed window; swap for Redis when multi-instance.
const rateWindows = new Map<string, { windowStart: number; count: number }>()

function rateLimited(orgId: string, kind: "discovery" | "verification", limit: number): boolean {
  const key = `${orgId}:${kind}`
  const now = Date.now()
  const current = rateWindows.get(key)
  if (!current || now - current.windowStart >= 60_000) {
    rateWindows.set(key, { windowStart: now, count: 1 })
    return false
  }
  if (current.count >= limit) return true
  current.count++
  return false
}

export async function emailRateLimitRemaining(orgId: string): Promise<{ discovery: number; verification: number }> {
  const settings = await getSettings(orgId)
  const count = (kind: "discovery" | "verification") => {
    const current = rateWindows.get(`${orgId}:${kind}`)
    if (!current || Date.now() - current.windowStart >= 60_000) return 0
    return current.count
  }
  return { discovery: Math.max(0, settings.discoveryRateLimit - count("discovery")), verification: Math.max(0, settings.verificationRateLimit - count("verification")) }
}

async function audit(orgId: string, action: EmailAuditAction, actor: { id?: string; name?: string } | null, emailId?: string, details?: Record<string, unknown>) {
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

// ── settings ──────────────────────────────────────────────────────────────

export async function getSettings(orgId: string): Promise<EmailSettings> {
  const existing = await prisma.emailSettings.findUnique({ where: { organizationId: orgId } })
  if (existing) return existing
  return prisma.emailSettings.create({
    data: { organizationId: orgId },
  })
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)))

export async function updateSettings(
  orgId: string,
  input: {
    discoveryEnabled?: boolean
    verificationEnabled?: boolean
    enrichmentFallback?: boolean
    verificationCacheDays?: number
    discoveryFreshnessDays?: number
    batchMaxEmails?: number
    discoveryRateLimit?: number
    verificationRateLimit?: number
    genericDomains?: string[]
    rolePrefixes?: string[]
    disposableDomains?: string[]
    enabledProviders?: string[]
  },
  actor?: { id: string; name: string } | null,
) {
  await getSettings(orgId)
  const updated = await prisma.emailSettings.update({
    where: { organizationId: orgId },
    data: {
      ...(input.discoveryEnabled !== undefined ? { discoveryEnabled: input.discoveryEnabled } : {}),
      ...(input.verificationEnabled !== undefined ? { verificationEnabled: input.verificationEnabled } : {}),
      ...(input.enrichmentFallback !== undefined ? { enrichmentFallback: input.enrichmentFallback } : {}),
      ...(input.verificationCacheDays !== undefined ? { verificationCacheDays: clamp(input.verificationCacheDays, 1, 90) } : {}),
      ...(input.discoveryFreshnessDays !== undefined ? { discoveryFreshnessDays: clamp(input.discoveryFreshnessDays, 0, 90) } : {}),
      ...(input.batchMaxEmails !== undefined ? { batchMaxEmails: clamp(input.batchMaxEmails, 1, 1000) } : {}),
      ...(input.discoveryRateLimit !== undefined ? { discoveryRateLimit: clamp(input.discoveryRateLimit, 1, 10000) } : {}),
      ...(input.verificationRateLimit !== undefined ? { verificationRateLimit: clamp(input.verificationRateLimit, 1, 10000) } : {}),
      ...(input.genericDomains !== undefined ? { genericDomains: input.genericDomains as unknown as object } : {}),
      ...(input.rolePrefixes !== undefined ? { rolePrefixes: input.rolePrefixes as unknown as object } : {}),
      ...(input.disposableDomains !== undefined ? { disposableDomains: input.disposableDomains as unknown as object } : {}),
      ...(input.enabledProviders !== undefined ? { enabledProviders: input.enabledProviders as unknown as object } : {}),
    },
  })
  await audit(orgId, EmailAuditAction.EMAIL_SETTINGS_UPDATED, actor ?? null, undefined, { settings: true })
  return updated
}

export function providerEnabled(settings: EmailSettings, providerId: string, capability: "DISCOVERY" | "VERIFICATION"): boolean {
  const enabled = (settings.enabledProviders as string[] | null) ?? []
  if (enabled.length > 0) return enabled.includes(providerId)
  if (capability === "DISCOVERY") return settings.discoveryEnabled
  return settings.verificationEnabled
}

export function settingsLists(settings: EmailSettings) {
  return {
    genericDomains: (settings.genericDomains as string[] | null) ?? undefined,
    rolePrefixes: (settings.rolePrefixes as string[] | null) ?? undefined,
    disposableDomains: (settings.disposableDomains as string[] | null) ?? undefined,
  }
}

// ── target loading + eligibility ──────────────────────────────────────────

type LeadTargetRow = Lead & { company?: { id: string; name: string; domain: string | null; website: string | null } | null; contact?: { id: string; fullName: string; jobTitle: string | null; phone: string | null; email: string | null; source: string | null } | null }

type TargetEntity = LeadCandidate | LeadTargetRow

async function loadTarget(orgId: string, input: { leadId?: string; candidateId?: string }): Promise<{ entity: TargetEntity | null; kind: "lead" | "candidate" }> {
  if (input.candidateId) {
    const candidate = await prisma.leadCandidate.findFirst({ where: { id: input.candidateId, organizationId: orgId } })
    if (!candidate) return { entity: null, kind: "candidate" }
    return { entity: candidate, kind: "candidate" }
  }
  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, organizationId: orgId },
    include: {
      company: { select: { id: true, name: true, domain: true, website: true } },
      contact: { select: { id: true, fullName: true, jobTitle: true, phone: true, email: true, source: true } },
    },
  })
  if (!lead) return { entity: null, kind: "lead" }
  return { entity: lead, kind: "lead" }
}

function targetOf(entity: TargetEntity, kind: "lead" | "candidate") {
  if (kind === "candidate") {
    const c = entity as LeadCandidate
    return { kind: "candidate" as const, id: c.id, companyName: c.companyName, companyDomain: c.companyDomain, websiteUrl: c.websiteUrl, contactFullName: c.contactFullName, email: c.email }
  }
  const lead = entity as LeadTargetRow
  return { kind: "lead" as const, id: lead.id, companyName: lead.company?.name, companyDomain: lead.company?.domain, websiteUrl: lead.company?.website, contactFullName: lead.contact?.fullName, email: lead.contact?.email }
}

function eligibilityOf(entity: TargetEntity, kind: "lead" | "candidate"): boolean {
  if (kind === "candidate") {
    const c = entity as LeadCandidate
    return Boolean(c.companyDomain || c.websiteUrl || c.email)
  }
  const lead = entity as LeadTargetRow
  return Boolean(lead.company?.domain || lead.company?.website || lead.contact?.email)
}

// ── discovery request lifecycle ───────────────────────────────────────────

export type EmailDiscoveryRequestResult =
  | { ok: true; id: string; skipped?: "ACTIVE" | "RECENT" }
  | { ok: false; error: string }

export async function requestEmailDiscovery(
  orgId: string,
  actor: { id: string; name: string } | null,
  input: { leadId?: string; candidateId?: string; providerId?: string; force?: boolean },
): Promise<EmailDiscoveryRequestResult> {
  const settings = await getSettings(orgId)
  if (!settings.discoveryEnabled) return { ok: false, error: "Email discovery is disabled for this organization" }
  const providerId = input.providerId ?? "EXISTING_DATA"
  const provider = emailProviderRegistry.get(providerId)
  if (!provider) return { ok: false, error: `Unknown email provider: ${providerId}` }
  if (!providerEnabled(settings, providerId, "DISCOVERY")) return { ok: false, error: `Provider ${providerId} is not enabled` }
  if (rateLimited(orgId, "discovery", settings.discoveryRateLimit)) return { ok: false, error: "Discovery rate limit reached. Try again in a minute." }

  const { entity, kind } = await loadTarget(orgId, { leadId: input.leadId, candidateId: input.candidateId })
  if (!entity) return { ok: false, error: "Entity not found in this organization" }
  if (!eligibilityOf(entity, kind)) return { ok: false, error: "Not eligible for email discovery: add a website, domain or existing email first" }
  const BLOCKED_CANDIDATE_STATUSES = [CandidateStatus.DUPLICATE, CandidateStatus.FAILED, CandidateStatus.SKIPPED] as CandidateStatus[]
  if (kind === "candidate" && BLOCKED_CANDIDATE_STATUSES.includes((entity as LeadCandidate).status)) {
    return { ok: false, error: "This candidate is not eligible for email discovery" }
  }

  const activeWhere = {
    organizationId: orgId,
    providerId,
    status: { in: ACTIVE_STATUSES },
    ...(kind === "lead" ? { leadId: entity.id } : { candidateId: entity.id }),
  }
  const active = await prisma.emailDiscoveryJob.findFirst({ where: activeWhere, select: { id: true } })
  if (active) return { ok: true, id: active.id, skipped: "ACTIVE" }

  if (!input.force) {
    const recent = await prisma.emailDiscoveryJob.findFirst({
      where: {
        organizationId: orgId,
        providerId,
        status: { in: SUCCESS_STATUSES },
        completedAt: { gte: new Date(Date.now() - settings.discoveryFreshnessDays * 86400000) },
        ...(kind === "lead" ? { leadId: entity.id } : { candidateId: entity.id }),
      },
      select: { id: true },
      orderBy: { completedAt: "desc" },
    })
    if (recent) return { ok: true, id: recent.id, skipped: "RECENT" }
  }

  const job = await prisma.emailDiscoveryJob.create({
    data: {
      organizationId: orgId,
      ...(kind === "lead" ? { leadId: entity.id } : { candidateId: entity.id }),
      providerId,
      forceRefresh: Boolean(input.force),
      requestedById: actor?.id ?? null,
    },
  })
  await audit(orgId, EmailAuditAction.EMAIL_DISCOVERY_REQUESTED, actor, undefined, {
    jobId: job.id,
    providerId,
    ...(kind === "lead" ? { leadId: entity.id } : { candidateId: entity.id }),
  })
  return { ok: true, id: job.id }
}

// ── discovery job execution ───────────────────────────────────────────────

export async function runEmailDiscoveryJob(jobId: string): Promise<void> {
  const job = await prisma.emailDiscoveryJob.findUnique({ where: { id: jobId } })
  if (!job || job.status !== EmailDiscoveryJobStatus.QUEUED) return
  const orgId = job.organizationId

  await prisma.emailDiscoveryJob.update({ where: { id: jobId }, data: { status: EmailDiscoveryJobStatus.RUNNING, startedAt: new Date() } })

  try {
    const settings = await getSettings(orgId)
    const provider = emailProviderRegistry.discovery(job.providerId)
    const { entity, kind } = await loadTarget(orgId, { leadId: job.leadId ?? undefined, candidateId: job.candidateId ?? undefined })
    if (!provider || !entity) {
      await settleDiscoveryFailure(jobId, orgId, "PROVIDER_ERROR", "Provider unavailable or entity deleted")
      return
    }

    const outcome = await provider.discover({
      organizationId: orgId,
      target: targetOf(entity, kind),
      jobId,
      forceRefresh: job.forceRefresh,
    })

    if (outcome.errorCode && outcome.emails.length === 0) {
      await settleDiscoveryFailure(jobId, orgId, outcome.errorCode, outcome.errorMessage ?? "Discovery failed")
      return
    }

    const created = await applyDiscoveredEmails(orgId, job, entity, kind, outcome.emails, settings)

    // §75: reuse TASK 013 enrichment for public-website discovery instead of
    // building a second crawler. Only when nothing was found on record.
    if (created === 0 && settings.enrichmentFallback && eligibilityOf(entity, kind)) {
      const enriched = await requestEnrichment(orgId, null, { ...(kind === "lead" ? { leadId: entity.id } : { candidateId: entity.id }) })
      if (enriched.ok) {
        await prisma.emailDiscoveryJob.update({ where: { id: jobId }, data: { enrichmentRequestId: enriched.id } })
        enqueueEnrichmentJob(enriched.id)
      }
    }

    const status = created > 0 ? EmailDiscoveryJobStatus.COMPLETED : EmailDiscoveryJobStatus.PARTIAL
    await prisma.emailDiscoveryJob.update({
      where: { id: jobId },
      data: { status, emailsFound: created, completedAt: new Date(), errorMessage: created === 0 ? "No new emails found in existing evidence" : null },
    })
    await audit(orgId, EmailAuditAction.EMAIL_DISCOVERY_COMPLETED, null, undefined, { jobId, emailsFound: created, status })
  } catch (e) {
    console.log(`email.discovery.job.failed jobId=${jobId} error=${e instanceof Error ? e.message : "unknown"}`)
    await settleDiscoveryFailure(jobId, orgId, "PROVIDER_ERROR", e instanceof Error ? e.message : "Unknown error")
  }
}

async function settleDiscoveryFailure(jobId: string, orgId: string, code: string, message: string) {
  await prisma.emailDiscoveryJob.update({
    where: { id: jobId },
    data: { status: EmailDiscoveryJobStatus.FAILED, completedAt: new Date(), errorCode: code, errorMessage: message },
  })
  await audit(orgId, EmailAuditAction.EMAIL_DISCOVERY_FAILED, null, undefined, { jobId, errorCode: code, errorMessage: message })
}

async function applyDiscoveredEmails(
  orgId: string,
  job: { id: string },
  entity: TargetEntity,
  kind: "lead" | "candidate",
  evidence: EmailDiscoveryEvidence[],
  settings: EmailSettings,
): Promise<number> {
  const { genericDomains, rolePrefixes } = settingsLists(settings)
  const entityId = entity.id
  const companyDomain = kind === "lead" ? (entity as LeadTargetRow).company?.domain : (entity as LeadCandidate).companyDomain
  const existing = await prisma.emailAddress.findMany({
    where: { organizationId: orgId, ...(kind === "lead" ? { leadId: entityId } : { candidateId: entityId }) },
    select: { id: true, normalizedEmail: true, status: true, isPrimary: true },
  })
  const existingByNorm = new Map(existing.map((e) => [e.normalizedEmail, e]))
  const existingPrimary = existing.find((e) => e.isPrimary)
  const contactId = kind === "lead" ? (entity as LeadTargetRow).contact?.id : null

  const primaryEmail = existingPrimary?.normalizedEmail ?? (kind === "lead" ? (entity as LeadTargetRow).contact?.email : (entity as LeadCandidate).email)

  let created = 0
  for (const item of evidence) {
    const normalized = normalizeEmailAddress(item.email)
    if (!normalized) continue
    if (existingByNorm.has(normalized)) continue
    const host = normalized.slice(normalized.lastIndexOf("@") + 1)
    const local = normalized.slice(0, normalized.lastIndexOf("@"))
    const type = classifyEmailType(local, host, rolePrefixes, genericDomains)
    const match = domainMatch(normalized, companyDomain)
    const isPrimary = !primaryEmail && type === EmailType.PERSONAL_BUSINESS ? true : false
    const address = await prisma.emailAddress.create({
      data: {
        organizationId: orgId,
        ...(kind === "lead" ? { leadId: entityId } : { candidateId: entityId }),
        ...(contactId && type === EmailType.PERSONAL_BUSINESS ? { contactId } : {}),
        email: normalized,
        normalizedEmail: normalized,
        type,
        status: EmailStatus.DISCOVERED,
        confidence: round2(item.confidence),
        isPrimary,
        sourceType: item.sourceType,
        provider: "EXISTING_DATA",
        sourceUrl: item.sourceUrl,
        evidence: item.evidence?.slice(0, 500) ?? null,
        observedAt: item.observedAt ?? new Date(),
        domainMatch: match,
      },
    })
    existingByNorm.set(normalized, address)
    created++
    await audit(orgId, EmailAuditAction.EMAIL_DISCOVERED, null, address.id, { jobId: job.id, type, confidence: address.confidence, domainMatch: match })

    // §32: never replace — a differing primary is surfaced as a conflict.
    if (primaryEmail && normalized !== primaryEmail && !isPrimary) {
      const open = await prisma.emailConflict.findFirst({
        where: { organizationId: orgId, emailId: address.id, status: EmailConflictStatus.OPEN },
      })
      if (!open) {
        await prisma.emailConflict.create({
          data: {
            organizationId: orgId,
            emailId: address.id,
            existingEmail: primaryEmail,
            discoveredEmail: normalized,
          },
        })
        await audit(orgId, EmailAuditAction.EMAIL_CONFLICT_CREATED, null, address.id, { jobId: job.id, existingEmail: primaryEmail, discoveredEmail: normalized })
      }
    }
  }

  if (created > 0) {
    // §11: professional contact email mirrors onto the CRM contact when the
    // contact has no email yet (never overwrites an existing one).
    if (kind === "lead" && contactId) {
      const lead = entity as LeadTargetRow
      if (!lead.contact?.email) {
        const primary = await prisma.emailAddress.findFirst({
          where: { organizationId: orgId, leadId: entityId, isPrimary: true },
        })
        if (primary) {
          await prisma.contact.update({ where: { id: contactId }, data: { email: primary.normalizedEmail, verificationStatus: "UNKNOWN" } })
        }
      }
    }
    await syncEmailMirrors(orgId, kind, entityId)
    await recalculateAfterEmailChange(orgId, entity, kind)
  }
  return created
}

// Mirror Lead.emailStatus + candidate.email + recompute readiness after any
// email mutation.
export async function syncEmailMirrors(orgId: string, kind: "lead" | "candidate", entityId: string): Promise<void> {
  if (kind !== "lead") {
    const primary = await prisma.emailAddress.findFirst({
      where: { organizationId: orgId, candidateId: entityId, isPrimary: true, status: { in: VALID_EMAIL_STATUSES } },
      select: { normalizedEmail: true },
    })
    if (primary) await prisma.leadCandidate.update({ where: { id: entityId }, data: { email: primary.normalizedEmail } })
    return
  }
  const addresses = await prisma.emailAddress.findMany({
    where: { organizationId: orgId, leadId: entityId, status: { in: VALID_EMAIL_STATUSES } },
    select: { status: true, isPrimary: true },
  })
  const rank: Record<string, number> = { VERIFIED: 6, LIKELY_VALID: 5, DISCOVERED: 4, STALE: 3, RISKY: 2, DISPOSABLE: 2, CONFLICT: 2, INVALID: 1, REJECTED: 0, UNKNOWN: 0 }
  const primary = addresses.find((a) => a.isPrimary)
  const best = [...addresses].sort((a, b) => (rank[b.status] ?? 0) - (rank[a.status] ?? 0))[0]
  const emailStatus = (primary ?? best)?.status ?? null
  const where = { where: { id: entityId }, data: { emailStatus } }
  await prisma.lead.update(where)
  await recomputeReadiness(orgId, { leadId: entityId })
}

async function recomputeReadiness(orgId: string, entity: { leadId?: string; candidateId?: string }) {
  if (entity.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: entity.leadId, organizationId: orgId },
      include: {
        company: { select: { website: true, domain: true } },
        contact: { select: { fullName: true, jobTitle: true, phone: true } },
        emailAddresses: { select: { status: true } },
      },
    })
    if (!lead) return
    const result = calculateReadiness({
      contactName: lead.contact?.fullName,
      jobTitle: lead.contact?.jobTitle,
      phone: lead.contact?.phone,
      website: lead.company?.website,
      domain: lead.company?.domain,
      emailStatuses: lead.emailAddresses.map((e) => e.status),
      hasPublicEvidence: lead.emailAddresses.some(() => true),
    })
    await persistReadiness(orgId, { leadId: lead.id }, result)
  } else if (entity.candidateId) {
    const candidate = await prisma.leadCandidate.findFirst({
      where: { id: entity.candidateId, organizationId: orgId },
      select: { contactFullName: true, contactJobTitle: true, phone: true, websiteUrl: true, companyDomain: true },
    })
    if (!candidate) return
    const emails = await prisma.emailAddress.findMany({ where: { organizationId: orgId, candidateId: entity.candidateId }, select: { status: true } })
    const result = calculateReadiness({
      contactName: candidate.contactFullName,
      jobTitle: candidate.contactJobTitle,
      phone: candidate.phone,
      website: candidate.websiteUrl,
      domain: candidate.companyDomain,
      emailStatuses: emails.map((e) => e.status),
      hasPublicEvidence: emails.length > 0,
    })
    await persistReadiness(orgId, { candidateId: entity.candidateId }, result)
  }
}

// §36/§74: email changes invalidate data quality + scores; ICP fit itself is
// untouched unless an ICP-relevant field changed (mirrors TASK 013 flow).
async function recalculateAfterEmailChange(orgId: string, entity: TargetEntity, kind: "lead" | "candidate") {
  if (kind === "candidate") {
    const candidate = entity as LeadCandidate
    const fresh = await prisma.leadCandidate.findFirst({
      where: { id: candidate.id, organizationId: orgId },
      select: {
        companyName: true, companyDomain: true, websiteUrl: true, contactFullName: true, email: true, phone: true,
        linkedinUrl: true, extractionConfidence: true, pageClassification: true, fieldProvenance: true,
      },
    })
    if (!fresh) return
    const quality = qualityFields(fresh)
    await prisma.leadCandidate.update({ where: { id: candidate.id }, data: quality })
    await prisma.leadScore.updateMany({
      where: { organizationId: orgId, candidateId: candidate.id, scoreStatus: ScoreStatus.CURRENT },
      data: { scoreStatus: ScoreStatus.STALE },
    })
    const scoring = await startBulkScoring(orgId, [candidate.id]).catch(() => null)
    if (scoring?.ok) enqueueScoringJob(scoring.jobId)
  } else {
    await prisma.leadScore.updateMany({
      where: { organizationId: orgId, leadId: entity.id, scoreStatus: ScoreStatus.CURRENT },
      data: { scoreStatus: ScoreStatus.STALE },
    })
  }
  await recomputeReadiness(orgId, kind === "lead" ? { leadId: entity.id } : { candidateId: entity.id })
}

// ── verification ──────────────────────────────────────────────────────────

export type EmailVerificationRequestResult = { ok: true; id: string; skipped?: "FRESH" | "ACTIVE" } | { ok: false; error: string }

export async function requestEmailVerification(
  orgId: string,
  actor: { id: string; name: string } | null,
  emailId: string,
  opts: { force?: boolean; providerId?: string } = {},
): Promise<EmailVerificationRequestResult> {
  const settings = await getSettings(orgId)
  if (!settings.verificationEnabled) return { ok: false, error: "Email verification is disabled for this organization" }
  const providerId = opts.providerId ?? "INTERNAL"
  const provider = emailProviderRegistry.get(providerId)
  if (!provider) return { ok: false, error: `Unknown verification provider: ${providerId}` }
  if (!providerEnabled(settings, providerId, "VERIFICATION")) return { ok: false, error: `Provider ${providerId} is not enabled` }
  if (rateLimited(orgId, "verification", settings.verificationRateLimit)) return { ok: false, error: "Verification rate limit reached. Try again in a minute." }

  const address = await prisma.emailAddress.findFirst({ where: { id: emailId, organizationId: orgId } })
  if (!address) return { ok: false, error: "Email not found in this organization" }

  const active = await prisma.emailVerificationJob.findFirst({
    where: { organizationId: orgId, emailId, status: { in: [EmailVerificationJobStatus.PENDING, EmailVerificationJobStatus.RUNNING] } },
    select: { id: true },
  })
  if (active) return { ok: true, id: active.id, skipped: "ACTIVE" }

  if (!opts.force && address.verifiedAt && address.expiresAt && address.expiresAt > new Date()) {
    return { ok: true, id: address.id, skipped: "FRESH" }
  }

  const job = await prisma.emailVerificationJob.create({
    data: {
      organizationId: orgId,
      emailId,
      batchId: null,
      providerId,
    },
  })
  await audit(orgId, EmailAuditAction.EMAIL_VERIFICATION_REQUESTED, actor, address.id, { jobId: job.id, providerId })
  return { ok: true, id: job.id }
}

export async function runEmailVerificationJob(jobId: string): Promise<void> {
  const job = await prisma.emailVerificationJob.findUnique({ where: { id: jobId } })
  if (!job || job.status !== EmailVerificationJobStatus.PENDING) return
  const orgId = job.organizationId

  await prisma.emailVerificationJob.update({ where: { id: jobId }, data: { status: EmailVerificationJobStatus.RUNNING } })

  try {
    const settings = await getSettings(orgId)
    const provider = emailProviderRegistry.verification(job.providerId)
    const address = await prisma.emailAddress.findFirst({ where: { id: job.emailId, organizationId: orgId } })
    if (!provider || !address) {
      await prisma.emailVerificationJob.update({ where: { id: jobId }, data: { status: EmailVerificationJobStatus.FAILED, errorCode: "PROVIDER_ERROR", errorMessage: "Provider unavailable or email deleted" } })
      await audit(orgId, EmailAuditAction.EMAIL_VERIFICATION_FAILED, null, address?.id, { jobId, errorCode: "PROVIDER_ERROR" })
      return
    }

    const result = await provider.verify(address.email, { ...settingsLists(settings), resolver: undefined })
    await applyVerificationResult(orgId, address, result, settings.verificationCacheDays)
    await prisma.emailVerificationJob.update({
      where: { id: jobId },
      data: { status: EmailVerificationJobStatus.COMPLETED, checkedAt: result.checkedAt },
    })
    await audit(orgId, EmailAuditAction.EMAIL_VERIFICATION_COMPLETED, null, address.id, { jobId, status: result.status, confidence: result.confidence })
  } catch (e) {
    console.log(`email.verification.job.failed jobId=${jobId} error=${e instanceof Error ? e.message : "unknown"}`)
    await prisma.emailVerificationJob.update({ where: { id: jobId }, data: { status: EmailVerificationJobStatus.FAILED, errorCode: "PROVIDER_ERROR", errorMessage: e instanceof Error ? e.message : "Unknown error" } })
    await audit(orgId, EmailAuditAction.EMAIL_VERIFICATION_FAILED, null, undefined, { jobId })
  }
}

export async function applyVerificationResult(orgId: string, address: EmailAddress, result: EmailVerificationResult, cacheDays: number): Promise<void> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + cacheDays * 86400000)
  const status = mapVerificationStatus(result.status)
  const verification = {
    syntaxValid: result.syntaxValid,
    domainValid: result.domainValid,
    mxPresent: result.mxPresent,
    disposable: result.disposable,
    roleBased: result.roleBased,
    confidence: result.confidence,
    provider: result.provider,
    errorCode: result.errorCode ?? null,
  }
  await prisma.emailAddress.update({
    where: { id: address.id },
    data: {
      status,
      verification,
      verifiedAt: now,
      expiresAt,
      confidence: address.confidence >= result.confidence ? address.confidence : round2(result.confidence),
    },
  })
  // §80: INVALID is never silently deleted — the row stays, status visible.
  await recalculateAfterEmailMutation(orgId, address)
}

function mapVerificationStatus(status: EmailVerificationResult["status"]): EmailStatus {
  switch (status) {
    case "VERIFIED": return EmailStatus.VERIFIED
    case "LIKELY_VALID": return EmailStatus.LIKELY_VALID
    case "INVALID": return EmailStatus.INVALID
    case "DISPOSABLE": return EmailStatus.DISPOSABLE
    case "RISKY": return EmailStatus.RISKY
    default: return EmailStatus.UNKNOWN
  }
}

async function recalculateAfterEmailMutation(orgId: string, address: EmailAddress) {
  const kind = address.leadId ? "lead" : address.candidateId ? "candidate" : null
  if (!kind) return
  const { entity } = await loadTarget(orgId, { leadId: address.leadId ?? undefined, candidateId: address.candidateId ?? undefined })
  if (!entity) return
  await recalculateAfterEmailChange(orgId, entity, kind)
  await syncEmailMirrors(orgId, kind, address.leadId ?? address.candidateId ?? "")
}

// §25/§81: effective status — expired verification reads as STALE, never
// INVALID. Pure read-layer helper.
export function effectiveStatus(address: Pick<EmailAddress, "status" | "expiresAt">): EmailStatus {
  if ((address.status === EmailStatus.VERIFIED || address.status === EmailStatus.LIKELY_VALID || address.status === EmailStatus.RISKY || address.status === EmailStatus.DISPOSABLE) && address.expiresAt && address.expiresAt <= new Date()) {
    return EmailStatus.STALE
  }
  return address.status
}

// ── bulk verification (§28, §83-§84) ──────────────────────────────────────

export async function bulkVerify(orgId: string, actor: { id: string; name: string } | null, emailIds: string[]): Promise<{ ok: true; batchId: string; queued: number } | { ok: false; error: string }> {
  const settings = await getSettings(orgId)
  if (emailIds.length > settings.batchMaxEmails) {
    return { ok: false, error: `Batches are limited to ${settings.batchMaxEmails} emails per request` }
  }
  const addresses = await prisma.emailAddress.findMany({ where: { organizationId: orgId, id: { in: emailIds } }, select: { id: true } })
  if (addresses.length === 0) return { ok: false, error: "No emails found in this organization" }

  const batch = await prisma.emailVerificationBatch.create({
    data: { organizationId: orgId, requestedById: actor?.id ?? null, status: EmailVerificationBatchStatus.PENDING, total: addresses.length },
  })
  await prisma.emailVerificationJob.createMany({
    data: addresses.map((a) => ({ organizationId: orgId, emailId: a.id, batchId: batch.id, providerId: "INTERNAL" })),
  })
  return { ok: true, batchId: batch.id, queued: addresses.length }
}

// Sequential processing: one DNS/network check at a time (§27, §85); one
// failure never aborts the batch (§83).
export async function runEmailVerificationBatch(batchId: string): Promise<void> {
  const batch = await prisma.emailVerificationBatch.findUnique({ where: { id: batchId } })
  if (!batch || batch.status !== EmailVerificationBatchStatus.PENDING) return
  const orgId = batch.organizationId
  const settings = await getSettings(orgId)

  await prisma.emailVerificationBatch.update({ where: { id: batchId }, data: { status: EmailVerificationBatchStatus.RUNNING, startedAt: new Date() } })
  const jobs = await prisma.emailVerificationJob.findMany({ where: { batchId, organizationId: orgId }, orderBy: { createdAt: "asc" } })

  const counts = { verified: 0, invalid: 0, unknown: 0, failed: 0 }
  let processed = 0
  try {
    for (const job of jobs) {
      if (rateLimited(orgId, "verification", settings.verificationRateLimit)) {
        await prisma.emailVerificationJob.update({ where: { id: job.id }, data: { status: EmailVerificationJobStatus.FAILED, errorCode: "RATE_LIMITED", errorMessage: "Rate limit reached" } })
        counts.failed++
      } else {
        await runEmailVerificationJob(job.id)
        const state = await prisma.emailVerificationJob.findUnique({ where: { id: job.id } })
        if (state?.status === EmailVerificationJobStatus.COMPLETED) {
          const address = await prisma.emailAddress.findFirst({ where: { id: job.emailId, organizationId: orgId }, select: { status: true } })
          if (address?.status === EmailStatus.VERIFIED || address?.status === EmailStatus.LIKELY_VALID) counts.verified++
          else if (address?.status === EmailStatus.INVALID) counts.invalid++
          else counts.unknown++
        } else {
          counts.failed++
        }
      }
      processed++
      await prisma.emailVerificationBatch.update({
        where: { id: batchId },
        data: { processed, verified: counts.verified, invalid: counts.invalid, unknown: counts.unknown, failed: counts.failed },
      })
      // Respect provider politeness: small pause between checks.
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    await prisma.emailVerificationBatch.update({
      where: { id: batchId },
      data: { status: EmailVerificationBatchStatus.COMPLETED, finishedAt: new Date() },
    })
  } catch (e) {
    console.log(`email.verification.batch.failed batchId=${batchId} error=${e instanceof Error ? e.message : "unknown"}`)
    await prisma.emailVerificationBatch.update({ where: { id: batchId }, data: { status: EmailVerificationBatchStatus.FAILED, finishedAt: new Date() } })
  }
}

// ── manual overrides (§35) ────────────────────────────────────────────────

export async function setPrimaryEmail(orgId: string, emailId: string, actor: { id: string; name: string } | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const address = await prisma.emailAddress.findFirst({ where: { id: emailId, organizationId: orgId } })
  if (!address) return { ok: false, error: "Email not found" }
  if (!address.leadId && !address.candidateId) return { ok: false, error: "This email is not attached to a lead or candidate" }

  const owner = address.leadId ? { leadId: address.leadId } : { candidateId: address.candidateId }
  await prisma.$transaction([
    prisma.emailAddress.updateMany({ where: { organizationId: orgId, ...owner }, data: { isPrimary: false } }),
    prisma.emailAddress.update({ where: { id: emailId }, data: { isPrimary: true } }),
  ])
  if (address.leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: address.leadId, organizationId: orgId }, include: { contact: { select: { id: true, email: true } } } })
    if (lead?.contact && (!lead.contact.email || lead.contact.email.toLowerCase() === address.normalizedEmail)) {
      await prisma.contact.update({ where: { id: lead.contact.id }, data: { email: address.normalizedEmail } })
    }
    await syncEmailMirrors(orgId, "lead", address.leadId)
  } else if (address.candidateId) {
    await prisma.leadCandidate.update({ where: { id: address.candidateId }, data: { email: address.normalizedEmail } })
    await recalculateAfterEmailMutation(orgId, address)
  }
  await audit(orgId, EmailAuditAction.EMAIL_MARKED_PRIMARY, actor, address.id, { email: address.normalizedEmail })
  return { ok: true }
}

export async function markEmailInvalid(orgId: string, emailId: string, actor: { id: string; name: string } | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const address = await prisma.emailAddress.findFirst({ where: { id: emailId, organizationId: orgId } })
  if (!address) return { ok: false, error: "Email not found" }
  await prisma.emailAddress.update({ where: { id: emailId }, data: { status: EmailStatus.INVALID, expiresAt: null } })
  if (address.leadId) await syncEmailMirrors(orgId, "lead", address.leadId)
  else if (address.candidateId) await recalculateAfterEmailMutation(orgId, address)
  await audit(orgId, EmailAuditAction.EMAIL_MANUALLY_INVALIDATED, actor, address.id, { email: address.normalizedEmail })
  return { ok: true }
}

export async function removeEmail(orgId: string, emailId: string, actor: { id: string; name: string } | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const address = await prisma.emailAddress.findFirst({ where: { id: emailId, organizationId: orgId } })
  if (!address) return { ok: false, error: "Email not found" }
  await prisma.emailAddress.update({ where: { id: emailId }, data: { status: EmailStatus.REJECTED, isPrimary: false, expiresAt: null } })
  if (address.leadId) await syncEmailMirrors(orgId, "lead", address.leadId)
  else if (address.candidateId) await recalculateAfterEmailMutation(orgId, address)
  await audit(orgId, EmailAuditAction.EMAIL_REMOVED, actor, address.id, { email: address.normalizedEmail })
  return { ok: true }
}

// ── conflicts (§32, §35) ──────────────────────────────────────────────────

export async function listOpenEmailConflicts(orgId: string) {
  return prisma.emailConflict.findMany({
    where: { organizationId: orgId, status: EmailConflictStatus.OPEN },
    include: { email: { select: { email: true, normalizedEmail: true, status: true, type: true, sourceType: true, lead: { select: { id: true, title: true, company: { select: { name: true } } } }, candidate: { select: { id: true, companyName: true } } } } },
    orderBy: { createdAt: "desc" },
  })
}

export async function resolveEmailConflict(
  orgId: string,
  conflictId: string,
  resolution: EmailConflictResolution,
  actor: { id: string; name: string } | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const conflict = await prisma.emailConflict.findFirst({ where: { id: conflictId, organizationId: orgId } })
  if (!conflict) return { ok: false, error: "Conflict not found" }
  if (conflict.status !== EmailConflictStatus.OPEN) return { ok: false, error: "Conflict already resolved" }

  if (resolution === EmailConflictResolution.ACCEPT_NEW) {
    const result = await setPrimaryEmail(orgId, conflict.emailId, actor)
    if (!result.ok) return result
  } else if (resolution === EmailConflictResolution.DISMISSED) {
    await prisma.emailAddress.update({ where: { id: conflict.emailId }, data: { status: EmailStatus.REJECTED, isPrimary: false } })
  } else {
    // KEEP_BOTH: the additional email stays, just no longer marked as a conflict.
    await prisma.emailAddress.update({ where: { id: conflict.emailId }, data: { status: EmailStatus.DISCOVERED } })
  }

  await prisma.emailConflict.update({
    where: { id: conflictId },
    data: {
      status: resolution === EmailConflictResolution.DISMISSED ? EmailConflictStatus.DISMISSED : EmailConflictStatus.RESOLVED,
      resolution,
      resolvedById: actor?.id ?? null,
      resolvedAt: new Date(),
    },
  })
  await audit(orgId, EmailAuditAction.EMAIL_CONFLICT_RESOLVED, actor, conflict.emailId, { conflictId, resolution })
  return { ok: true }
}

// ── retry / cancel ────────────────────────────────────────────────────────

export async function retryEmailDiscovery(orgId: string, jobId: string, actor: { id: string; name: string } | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const job = await prisma.emailDiscoveryJob.findFirst({ where: { id: jobId, organizationId: orgId } })
  if (!job) return { ok: false, error: "Job not found" }
  if (job.status !== EmailDiscoveryJobStatus.FAILED) return { ok: false, error: "Only failed jobs can be retried" }
  if (job.retries >= MAX_RETRIES) return { ok: false, error: "Maximum retries reached" }
  if (!RETRYABLE_ERRORS.has(job.errorCode)) return { ok: false, error: `"${job.errorCode}" is not retryable` }

  await prisma.emailDiscoveryJob.update({
    where: { id: jobId },
    data: { status: EmailDiscoveryJobStatus.QUEUED, retries: job.retries + 1, errorCode: null, errorMessage: null, completedAt: null, startedAt: null },
  })
  await audit(orgId, EmailAuditAction.EMAIL_DISCOVERY_REQUESTED, actor, undefined, { jobId, retry: job.retries + 1 })
  return { ok: true }
}

export async function cancelEmailDiscovery(orgId: string, jobId: string, actor: { id: string; name: string } | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const job = await prisma.emailDiscoveryJob.findFirst({ where: { id: jobId, organizationId: orgId } })
  if (!job) return { ok: false, error: "Job not found" }
  if (!ACTIVE_STATUSES.includes(job.status)) return { ok: false, error: "Only queued or running jobs can be cancelled" }
  await prisma.emailDiscoveryJob.update({ where: { id: jobId }, data: { status: EmailDiscoveryJobStatus.CANCELLED, completedAt: new Date() } })
  await audit(orgId, EmailAuditAction.EMAIL_DISCOVERY_REQUESTED, actor, undefined, { jobId, cancelled: true })
  return { ok: true }
}

// ── bulk discovery (§29-§30, §45) ─────────────────────────────────────────

export async function bulkDiscoverEmails(orgId: string, actor: { id: string; name: string } | null, candidateIds: string[]): Promise<{ ok: true; summary: { queued: number; failed: number; skippedRecent: number; skippedActive: number; ineligible: number } } | { ok: false; error: string }> {
  const settings = await getSettings(orgId)
  if (candidateIds.length > settings.batchMaxEmails) return { ok: false, error: `Batches are limited to ${settings.batchMaxEmails} per request` }
  const cutoff = new Date(Date.now() - settings.discoveryFreshnessDays * 86400000)
  const [candidates, jobs] = await Promise.all([
    prisma.leadCandidate.findMany({
      where: { organizationId: orgId, id: { in: candidateIds } },
      select: { id: true, companyDomain: true, websiteUrl: true, email: true, status: true },
    }),
    prisma.emailDiscoveryJob.findMany({
      where: { organizationId: orgId, candidateId: { in: candidateIds }, status: { in: [...ACTIVE_STATUSES, ...SUCCESS_STATUSES] } },
      select: { candidateId: true, status: true, completedAt: true },
    }),
  ])
  const eligible = candidates.filter((c) => Boolean(c.companyDomain || c.websiteUrl || c.email) && !["DUPLICATE", "FAILED", "SKIPPED"].includes(c.status))
  const skippedActive = eligible.filter((c) => jobs.some((j) => j.candidateId === c.id && ACTIVE_STATUSES.includes(j.status)))
  const skippedRecent = eligible.filter((c) => jobs.some((j) => j.candidateId === c.id && SUCCESS_STATUSES.includes(j.status) && j.completedAt && j.completedAt >= cutoff))

  let queued = 0
  let failed = 0
  for (const candidate of eligible) {
    if (skippedActive.includes(candidate) || skippedRecent.includes(candidate)) continue
    const result = await requestEmailDiscovery(orgId, actor, { candidateId: candidate.id })
    if (result.ok) queued++
    else failed++
  }
  return { ok: true, summary: { queued, failed, skippedRecent: skippedRecent.length, skippedActive: skippedActive.length, ineligible: candidates.length - eligible.length } }
}

// ── reads ─────────────────────────────────────────────────────────────────

export async function listEntityEmails(orgId: string, entity: { leadId?: string; candidateId?: string }) {
  const addresses = await prisma.emailAddress.findMany({
    where: {
      organizationId: orgId,
      ...(entity.leadId ? { leadId: entity.leadId } : { candidateId: entity.candidateId }),
      status: { not: EmailStatus.REJECTED },
    },
    orderBy: [{ isPrimary: "desc" }, { status: "asc" }, { observedAt: "desc" }],
  })
  return addresses.map((a) => ({ ...a, status: effectiveStatus(a) }))
}

export async function listDiscoveryJobs(orgId: string, filters: { page?: string; pageSize?: string; status?: string } = {}) {
  const { parsePagination } = await import("@/lib/crm/pagination")
  const { page, pageSize } = parsePagination(filters)
  const where: Record<string, unknown> = { organizationId: orgId }
  if (filters.status) where.status = filters.status
  const [total, data] = await Promise.all([
    prisma.emailDiscoveryJob.count({ where }),
    prisma.emailDiscoveryJob.findMany({
      where,
      orderBy: { requestedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        lead: { select: { title: true, company: { select: { name: true, domain: true } } } },
        candidate: { select: { companyName: true, companyDomain: true, contactFullName: true } },
      },
    }),
  ])
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function listVerificationJobs(orgId: string, filters: { page?: string; pageSize?: string; status?: string } = {}) {
  const { parsePagination } = await import("@/lib/crm/pagination")
  const { page, pageSize } = parsePagination(filters)
  const where: Record<string, unknown> = { organizationId: orgId }
  if (filters.status) where.status = filters.status
  const [total, data] = await Promise.all([
    prisma.emailVerificationJob.count({ where }),
    prisma.emailVerificationJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        email: {
          select: { email: true, normalizedEmail: true, status: true, lead: { select: { id: true, title: true, company: { select: { name: true } } } }, candidate: { select: { id: true, companyName: true } } },
        },
      },
    }),
  ])
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function emailQueueCounts(orgId: string) {
  const [discoveryRunning, discoveryQueued, discoveryFailed, verificationRunning, verificationQueued, verificationFailed, openConflicts] = await Promise.all([
    prisma.emailDiscoveryJob.count({ where: { organizationId: orgId, status: EmailDiscoveryJobStatus.RUNNING } }),
    prisma.emailDiscoveryJob.count({ where: { organizationId: orgId, status: EmailDiscoveryJobStatus.QUEUED } }),
    prisma.emailDiscoveryJob.count({ where: { organizationId: orgId, status: EmailDiscoveryJobStatus.FAILED } }),
    prisma.emailVerificationJob.count({ where: { organizationId: orgId, status: EmailVerificationJobStatus.RUNNING } }),
    prisma.emailVerificationJob.count({ where: { organizationId: orgId, status: EmailVerificationJobStatus.PENDING } }),
    prisma.emailVerificationJob.count({ where: { organizationId: orgId, status: EmailVerificationJobStatus.FAILED } }),
    prisma.emailConflict.count({ where: { organizationId: orgId, status: EmailConflictStatus.OPEN } }),
  ])
  return { discoveryRunning, discoveryQueued, discoveryFailed, verificationRunning, verificationQueued, verificationFailed, openConflicts }
}
