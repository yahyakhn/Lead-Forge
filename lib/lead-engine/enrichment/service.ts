// TASK 013: enrichment orchestration — requests, job execution, merge
// application, conflicts, freshness, stats. All queries org-scoped.

import { prisma } from "@/lib/db"
import {
  ConflictResolution,
  EnrichmentAuditAction,
  EnrichmentConflictStatus,
  EnrichmentErrorCode,
  EnrichmentRequestStatus,
  EnrichmentResultStatus,
  ScoreStatus,
  CandidateStatus,
} from "@/generated/prisma/enums"
import type { EnrichmentRequest, EnrichmentSettings, Lead, LeadCandidate } from "@/generated/prisma/client"
import { enrichmentProviderRegistry } from "@/lib/lead-engine/enrichment/providers/registry"
import type { EnrichmentField, EnrichmentTarget } from "@/lib/lead-engine/enrichment/providers/types"
import { MERGEABLE_FIELDS } from "@/lib/lead-engine/enrichment/fields"
import { mergeValue } from "@/lib/lead-engine/enrichment/merge"
import { normalizeCompanyName } from "@/lib/lead-engine/resolution/normalize"
import { qualityFields } from "@/lib/lead-engine/resolution/service"
import { startBulkScoring } from "@/lib/lead-engine/scoring/service"
import { enqueueScoringJob } from "@/lib/lead-engine/job-queue"
import { ErrorCategory } from "@/lib/lead-engine/error-categories"

const DEFAULT_SETTINGS = {
  enabled: true,
  maxPagesPerCompany: 5,
  maxDepth: 1,
  requestDelayMs: 1000,
  requestTimeoutMs: 15000,
  allowedDomains: [] as string[],
  enabledProviders: ["WEBSITE"],
  freshnessDays: 7,
  batchMaxLeads: 100,
}

const MAX_RETRIES = 2
const ACTIVE_STATUSES = [EnrichmentRequestStatus.QUEUED, EnrichmentRequestStatus.RUNNING] as EnrichmentRequestStatus[]
const SUCCESS_STATUSES = [EnrichmentRequestStatus.COMPLETED, EnrichmentRequestStatus.PARTIAL] as EnrichmentRequestStatus[]
const RETRYABLE_ERRORS = new Set<EnrichmentErrorCode | null | undefined>([
  EnrichmentErrorCode.TIMEOUT,
  EnrichmentErrorCode.DNS_ERROR,
  EnrichmentErrorCode.RATE_LIMITED,
  EnrichmentErrorCode.PARSER_ERROR,
  EnrichmentErrorCode.PROVIDER_ERROR,
  null,
])

const ERROR_MAP: Record<string, EnrichmentErrorCode> = {
  [ErrorCategory.TIMEOUT]: EnrichmentErrorCode.TIMEOUT,
  [ErrorCategory.NETWORK_ERROR]: EnrichmentErrorCode.DNS_ERROR,
  [ErrorCategory.ROBOTS_BLOCKED]: EnrichmentErrorCode.ROBOTS_BLOCKED,
  [ErrorCategory.RATE_LIMITED]: EnrichmentErrorCode.RATE_LIMITED,
  [ErrorCategory.INVALID_URL]: EnrichmentErrorCode.INVALID_URL,
  [ErrorCategory.PARSE_ERROR]: EnrichmentErrorCode.PARSER_ERROR,
  INSUFFICIENT_DATA: EnrichmentErrorCode.INSUFFICIENT_DATA,
}

const CANDIDATE_FIELD_MAP: Record<string, keyof LeadCandidate> = {
  company_name: "companyName",
  company_domain: "companyDomain",
  website: "websiteUrl",
  description: "description",
  industry: "industry",
  country: "country",
  region: "region",
  city: "city",
  phone: "phone",
  email: "email",
  linkedin_url: "linkedinUrl",
  contact_name: "contactFullName",
  job_title: "contactJobTitle",
}

function mapError(category: string | undefined): EnrichmentErrorCode {
  return (category && ERROR_MAP[category]) || EnrichmentErrorCode.PROVIDER_ERROR
}

async function audit(orgId: string, action: EnrichmentAuditAction, actor: { id?: string; name?: string } | null, details?: Record<string, unknown>) {
  await prisma.enrichmentAuditEvent.create({
    data: {
      organizationId: orgId,
      action,
      actorUserId: actor?.id ?? null,
      actorName: actor?.name ?? null,
      details: details && Object.keys(details).length > 0 ? (details as object) : undefined,
    },
  })
}

// ── settings ──────────────────────────────────────────────────────────────

export async function getSettings(orgId: string): Promise<EnrichmentSettings> {
  const existing = await prisma.enrichmentSettings.findUnique({ where: { organizationId: orgId } })
  if (existing) return existing
  return prisma.enrichmentSettings.create({
    data: {
      organizationId: orgId,
      enabledProviders: DEFAULT_SETTINGS.enabledProviders as unknown as object,
      allowedDomains: [] as unknown as object,
    },
  })
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)))

export async function updateSettings(
  orgId: string,
  input: {
    enabled?: boolean
    maxPagesPerCompany?: number
    maxDepth?: number
    requestDelayMs?: number
    requestTimeoutMs?: number
    allowedDomains?: string[]
    enabledProviders?: string[]
    freshnessDays?: number
    batchMaxLeads?: number
  },
  actor?: { id: string; name: string } | null,
) {
  const updated = await prisma.enrichmentSettings.update({
    where: { organizationId: orgId },
    data: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.maxPagesPerCompany !== undefined ? { maxPagesPerCompany: clamp(input.maxPagesPerCompany, 1, 20) } : {}),
      ...(input.maxDepth !== undefined ? { maxDepth: clamp(input.maxDepth, 0, 2) } : {}),
      ...(input.requestDelayMs !== undefined ? { requestDelayMs: clamp(input.requestDelayMs, 0, 60_000) } : {}),
      ...(input.requestTimeoutMs !== undefined ? { requestTimeoutMs: clamp(input.requestTimeoutMs, 1000, 60_000) } : {}),
      ...(input.freshnessDays !== undefined ? { freshnessDays: clamp(input.freshnessDays, 0, 90) } : {}),
      ...(input.batchMaxLeads !== undefined ? { batchMaxLeads: clamp(input.batchMaxLeads, 1, 500) } : {}),
      ...(input.allowedDomains !== undefined ? { allowedDomains: input.allowedDomains as unknown as object } : {}),
      ...(input.enabledProviders !== undefined ? { enabledProviders: input.enabledProviders as unknown as object } : {}),
    },
  })
  await audit(orgId, EnrichmentAuditAction.ENRICHMENT_REQUESTED, actor ?? null, { settings: true })
  return updated
}

export function providerEnabled(settings: EnrichmentSettings, providerId: string): boolean {
  const enabled = (settings.enabledProviders as string[] | null) ?? DEFAULT_SETTINGS.enabledProviders
  return enabled.includes(providerId)
}

// ── eligibility + target loading ──────────────────────────────────────────

export function eligibilityOf(entity: { companyDomain?: string | null; websiteUrl?: string | null } | { company?: { domain?: string | null; website?: string | null } | null }): { eligible: boolean } {
  if ("companyDomain" in entity || "websiteUrl" in entity) {
    const c = entity as { companyDomain?: string | null; websiteUrl?: string | null }
    return { eligible: Boolean(c.companyDomain || c.websiteUrl) }
  }
  const lead = entity as { company?: { domain?: string | null; website?: string | null } | null }
  return { eligible: Boolean(lead.company?.domain || lead.company?.website) }
}

type CompanyFields = { id: string; name: string; normalizedName: string; domain: string | null; website: string | null; industry: string | null; country: string | null; state: string | null; city: string | null; description: string | null; phone: string | null; linkedinUrl: string | null; source: string | null }
type ContactFields = { id: string; firstName: string; lastName: string | null; fullName: string; jobTitle: string | null; email: string | null; phone: string | null; linkedinUrl: string | null; source: string | null }
type LeadTargetRow = Lead & { company?: CompanyFields | null; contact?: ContactFields | null }
type TargetEntity = LeadCandidate | LeadTargetRow

async function loadTarget(orgId: string, input: { leadId?: string; candidateId?: string }): Promise<{ target: EnrichmentTarget; entity: TargetEntity | null }> {
  if (input.candidateId) {
    const candidate = await prisma.leadCandidate.findFirst({ where: { id: input.candidateId, organizationId: orgId } })
    if (!candidate) return { target: undefined as never, entity: null }
    return {
      target: {
        kind: "candidate",
        id: candidate.id,
        companyName: candidate.companyName,
        companyDomain: candidate.companyDomain,
        websiteUrl: candidate.websiteUrl,
        contactFullName: candidate.contactFullName,
        email: candidate.email,
      },
      entity: candidate,
    }
  }
  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, organizationId: orgId },
    include: {
      company: { select: { id: true, name: true, normalizedName: true, domain: true, website: true, industry: true, country: true, state: true, city: true, description: true, phone: true, linkedinUrl: true, source: true } },
      contact: { select: { id: true, firstName: true, lastName: true, fullName: true, jobTitle: true, email: true, phone: true, linkedinUrl: true, source: true } },
    },
  })
  if (!lead) return { target: undefined as never, entity: null }
  return {
    target: {
      kind: "lead",
      id: lead.id,
      companyName: lead.company?.name,
      companyDomain: lead.company?.domain,
      websiteUrl: lead.company?.website,
      contactFullName: lead.contact?.fullName,
      email: lead.contact?.email,
    },
    entity: lead,
  }
}

// ── request lifecycle ─────────────────────────────────────────────────────

export type EnrichmentRequestResult =
  | { ok: true; id: string; skipped?: "ACTIVE" | "RECENT" }
  | { ok: false; error: string }

export async function requestEnrichment(
  orgId: string,
  actor: { id: string; name: string } | null,
  input: { leadId?: string; candidateId?: string; providerId?: string; force?: boolean },
): Promise<EnrichmentRequestResult> {
  const settings = await getSettings(orgId)
  if (!settings.enabled) return { ok: false, error: "Enrichment is disabled for this organization" }
  const providerId = input.providerId ?? "WEBSITE"
  const provider = enrichmentProviderRegistry.get(providerId)
  if (!provider) return { ok: false, error: `Unknown enrichment provider: ${providerId}` }
  if (!providerEnabled(settings, providerId)) return { ok: false, error: `Provider ${providerId} is not enabled` }

  const { target, entity } = await loadTarget(orgId, { leadId: input.leadId, candidateId: input.candidateId })
  if (!entity) return { ok: false, error: "Entity not found in this organization" }
  const { eligible } = eligibilityOf(entity)
  if (!eligible) return { ok: false, error: "Insufficient information for website enrichment. Add a website or domain first." }
  const BLOCKED_CANDIDATE_STATUSES = [CandidateStatus.DUPLICATE, CandidateStatus.FAILED, CandidateStatus.SKIPPED] as CandidateStatus[]
  if (target.kind === "candidate" && BLOCKED_CANDIDATE_STATUSES.includes((entity as LeadCandidate).status)) {
    return { ok: false, error: "This candidate is not eligible for enrichment." }
  }

  const activeWhere = {
    organizationId: orgId,
    providerId,
    status: { in: [EnrichmentRequestStatus.QUEUED, EnrichmentRequestStatus.RUNNING] },
    ...(target.kind === "lead" ? { leadId: entity.id } : { candidateId: entity.id }),
  }
  const active = await prisma.enrichmentRequest.findFirst({ where: activeWhere, select: { id: true } })
  if (active) return { ok: true, id: active.id, skipped: "ACTIVE" }

  if (!input.force) {
    const recent = await prisma.enrichmentRequest.findFirst({
      where: {
        organizationId: orgId,
        providerId,
        status: { in: [EnrichmentRequestStatus.COMPLETED, EnrichmentRequestStatus.PARTIAL] },
        completedAt: { gte: new Date(Date.now() - settings.freshnessDays * 86400000) },
        ...(target.kind === "lead" ? { leadId: entity.id } : { candidateId: entity.id }),
      },
      select: { id: true },
      orderBy: { completedAt: "desc" },
    })
    if (recent) return { ok: true, id: recent.id, skipped: "RECENT" }
  }

  const request = await prisma.enrichmentRequest.create({
    data: {
      organizationId: orgId,
      ...(target.kind === "lead" ? { leadId: entity.id } : { candidateId: entity.id }),
      providerId,
      forceRefresh: Boolean(input.force),
      requestedById: actor?.id ?? null,
    },
  })
  await audit(orgId, input.force ? EnrichmentAuditAction.ENRICHMENT_FORCE_REFRESHED : EnrichmentAuditAction.ENRICHMENT_REQUESTED, actor, {
    requestId: request.id,
    providerId,
    ...(target.kind === "lead" ? { leadId: entity.id } : { candidateId: entity.id }),
  })
  return { ok: true, id: request.id }
}

// ── job execution ─────────────────────────────────────────────────────────

const entityExistingValue = (entity: TargetEntity, target: EnrichmentTarget, field: string): string | null => {
  if (target.kind === "lead") {
    const c = (entity as LeadTargetRow).company ?? null
    const p = (entity as LeadTargetRow).contact ?? null
    switch (field) {
      case "company_name": return c?.name ?? null
      case "company_domain": return c?.domain ?? null
      case "website": return c?.website ?? null
      case "description": return c?.description ?? null
      case "industry": return c?.industry ?? null
      case "country": return c?.country ?? null
      case "region": return c?.state ?? null
      case "city": return c?.city ?? null
      case "phone": return c?.phone ?? null
      case "linkedin_url": return c?.linkedinUrl ?? null
      case "contact_name": return p?.fullName ?? null
      case "job_title": return p?.jobTitle ?? null
      case "email": return p?.email ?? null
      default: return null
    }
  }
  const c = entity as LeadCandidate
  return (c[CANDIDATE_FIELD_MAP[field] as keyof LeadCandidate] as string | null | undefined) ?? null
}

const entitySourceOf = (entity: LeadCandidate | { company?: { source?: string | null } | null; contact?: { source?: string | null } | null }, target: EnrichmentTarget, field: string): string | null => {
  if (target.kind === "lead") {
    const lead = entity as { company?: { source?: string | null } | null; contact?: { source?: string | null } | null }
    const companyFields = ["company_name", "company_domain", "website", "description", "industry", "country", "region", "city", "phone", "linkedin_url"]
    const owner = companyFields.includes(field) ? lead.company : lead.contact
    return owner?.source ? sourceToHierarchy(owner.source) : null
  }
  return "PUBLIC_WEBSITE"
}

function sourceToHierarchy(source: string): string {
  const key = source.toUpperCase()
  if (key === "MANUAL") return "MANUAL"
  if (key === "SCRAPER") return "PUBLIC_WEBSITE"
  if (key === "IMPORT") return "USER_IMPORT"
  return "OTHER_PROVIDER"
}

export async function runEnrichmentJob(requestId: string): Promise<void> {
  const request = await prisma.enrichmentRequest.findUnique({ where: { id: requestId } })
  if (!request || request.status !== EnrichmentRequestStatus.QUEUED) return
  const orgId = request.organizationId

  await prisma.enrichmentRequest.update({ where: { id: requestId }, data: { status: EnrichmentRequestStatus.RUNNING, startedAt: new Date() } })
  await audit(orgId, EnrichmentAuditAction.ENRICHMENT_STARTED, null, { requestId })

  try {
    const settings = await getSettings(orgId)
    const provider = enrichmentProviderRegistry.get(request.providerId)
    const loaded = await loadTarget(orgId, { leadId: request.leadId ?? undefined, candidateId: request.candidateId ?? undefined })
    if (!provider || !loaded.entity) {
      await settleFailure(requestId, orgId, EnrichmentErrorCode.PROVIDER_ERROR, "Provider unavailable or entity deleted")
      return
    }
    const { target, entity } = loaded
    const allowedDomains = ((settings.allowedDomains as string[] | null) ?? DEFAULT_SETTINGS.allowedDomains) ?? []

    const outcome = await provider.enrich({
      target,
      forceRefresh: request.forceRefresh,
      requestId,
      maxPages: settings.maxPagesPerCompany,
      maxDepth: settings.maxDepth,
      requestDelayMs: settings.requestDelayMs,
      requestTimeoutMs: settings.requestTimeoutMs,
      allowedDomains,
    })

    if (outcome.errorCode && outcome.fields.length === 0) {
      const code = mapError(outcome.errorCode)
      const partial = outcome.pagesVisited > 0 && code === EnrichmentErrorCode.INSUFFICIENT_DATA
      await prisma.enrichmentRequest.update({
        where: { id: requestId },
        data: {
          status: partial ? EnrichmentRequestStatus.PARTIAL : EnrichmentRequestStatus.FAILED,
          pagesVisited: outcome.pagesVisited,
          completedAt: new Date(),
          errorCode: code,
          errorMessage: outcome.errorMessage ?? null,
        },
      })
      await audit(orgId, EnrichmentAuditAction.ENRICHMENT_COMPLETED, null, { requestId, status: partial ? "PARTIAL" : "FAILED", errorCode: code, pagesVisited: outcome.pagesVisited })
      return
    }

    const { applied, changed } = await applyFields(orgId, request, target, entity, settings, outcome.fields)

    const status = applied > 0 || outcome.fields.length > 0 ? EnrichmentRequestStatus.COMPLETED : EnrichmentRequestStatus.PARTIAL
    await prisma.enrichmentRequest.update({
      where: { id: requestId },
      data: {
        status,
        pagesVisited: outcome.pagesVisited,
        fieldsFound: outcome.fields.length,
        fieldsUpdated: changed.updated,
        conflictsCount: changed.conflicts,
        completedAt: new Date(),
        errorCode: status === EnrichmentRequestStatus.PARTIAL ? EnrichmentErrorCode.INSUFFICIENT_DATA : null,
        errorMessage: status === EnrichmentRequestStatus.PARTIAL ? "No fields could be applied" : null,
      },
    })
    await audit(orgId, EnrichmentAuditAction.ENRICHMENT_COMPLETED, null, { requestId, status, fieldsFound: outcome.fields.length, fieldsUpdated: changed.updated, conflicts: changed.conflicts, pagesVisited: outcome.pagesVisited })
  } catch (e) {
    console.log(`enrichment.job.failed requestId=${requestId} error=${e instanceof Error ? e.message : "unknown"}`)
    await settleFailure(requestId, orgId, EnrichmentErrorCode.PROVIDER_ERROR, e instanceof Error ? e.message : "Unknown error")
  }
}

async function settleFailure(requestId: string, orgId: string, code: EnrichmentErrorCode, message: string) {
  await prisma.enrichmentRequest.update({
    where: { id: requestId },
    data: { status: EnrichmentRequestStatus.FAILED, completedAt: new Date(), errorCode: code, errorMessage: message },
  })
  await audit(orgId, EnrichmentAuditAction.ENRICHMENT_FAILED, null, { requestId, errorCode: code, errorMessage: message })
}

interface ApplyResult {
  applied: number
  changed: { updated: number; conflicts: number }
}

async function applyFields(
  orgId: string,
  request: EnrichmentRequest,
  target: EnrichmentTarget,
  entity: TargetEntity,
  settings: EnrichmentSettings,
  fields: EnrichmentField[],
): Promise<ApplyResult> {
  const entityId = target.id
  const changed = { updated: 0, conflicts: 0 }
  let applied = 0
  const candidate = target.kind === "candidate" ? (entity as LeadCandidate) : null
  const lead = target.kind === "lead" ? (entity as LeadTargetRow) : null

  const staleOld = async (field: string) => {
    await prisma.enrichmentResult.updateMany({
      where: {
        organizationId: orgId,
        field,
        status: { in: [EnrichmentResultStatus.NEW, EnrichmentResultStatus.CONFIRMED] },
        ...(target.kind === "lead" ? { leadId: entityId } : { candidateId: entityId }),
      },
      data: { status: EnrichmentResultStatus.STALE },
    })
  }

  for (const field of fields) {
    const duplicate = await prisma.enrichmentResult.findFirst({
      where: {
        organizationId: orgId,
        field: field.field,
        value: { equals: field.value, mode: "insensitive" },
        ...(target.kind === "lead" ? { leadId: entityId } : { candidateId: entityId }),
        status: { in: [EnrichmentResultStatus.NEW, EnrichmentResultStatus.CONFIRMED, EnrichmentResultStatus.CONFLICT] },
      },
      select: { id: true, status: true },
    })
    if (duplicate) continue

    if (!MERGEABLE_FIELDS.has(field.field)) {
      await staleOld(field.field)
      await prisma.enrichmentResult.create({
        data: {
          organizationId: orgId,
          requestId: request.id,
          ...(target.kind === "lead" ? { leadId: entityId } : { candidateId: entityId }),
          field: field.field,
          value: field.value,
          normalizedValue: field.normalizedValue,
          source: field.source,
          sourceUrl: field.sourceUrl,
          evidence: field.evidence,
          method: field.method,
          confidence: field.confidence,
          status: EnrichmentResultStatus.NEW,
        },
      })
      applied++
      continue
    }

    const existingValue = entityExistingValue(entity, target, field.field)
    const existingSource = entitySourceOf(entity, target, field.field)
    const verdict = mergeValue({
      field: field.field,
      existingValue,
      existingSource,
      enrichedValue: field.value,
      enrichedSource: field.source,
      enrichedConfidence: field.confidence,
    })

    if (verdict.decision === "ACCEPT" || verdict.decision === "CONFIRM") {
      if (verdict.decision === "ACCEPT") {
        await writeEntityValue(entity, target, field)
        changed.updated++
      }
      await staleOld(field.field)
      await prisma.enrichmentResult.create({
        data: {
          organizationId: orgId,
          requestId: request.id,
          ...(target.kind === "lead" ? { leadId: entityId } : { candidateId: entityId }),
          field: field.field,
          value: field.value,
          normalizedValue: field.normalizedValue,
          source: field.source,
          sourceUrl: field.sourceUrl,
          evidence: field.evidence,
          method: field.method,
          confidence: field.confidence,
          status: verdict.decision === "ACCEPT" ? EnrichmentResultStatus.NEW : EnrichmentResultStatus.CONFIRMED,
        },
      })
      applied++
      continue
    }

    // CONFLICT (or trusted-existing preserve)
    await staleOld(field.field)
    await prisma.enrichmentResult.create({
      data: {
        organizationId: orgId,
        requestId: request.id,
        ...(target.kind === "lead" ? { leadId: entityId } : { candidateId: entityId }),
        field: field.field,
        value: field.value,
        normalizedValue: field.normalizedValue,
        source: field.source,
        sourceUrl: field.sourceUrl,
        evidence: field.evidence,
        method: field.method,
        confidence: field.confidence,
        status: EnrichmentResultStatus.CONFLICT,
      },
    })
    const existingOpen = await prisma.enrichmentConflict.findFirst({
      where: {
        organizationId: orgId,
        field: field.field,
        ...(target.kind === "lead" ? { leadId: entityId } : { candidateId: entityId }),
        status: EnrichmentConflictStatus.OPEN,
        enrichedValue: field.value,
      },
    })
    if (!existingOpen) {
      await prisma.enrichmentConflict.create({
        data: {
          organizationId: orgId,
          requestId: request.id,
          ...(target.kind === "lead" ? { leadId: entityId } : { candidateId: entityId }),
          field: field.field,
          existingValue: existingValue ?? "",
          enrichedValue: field.value,
          existingSource: existingSource ?? "",
          enrichedSource: field.source,
          confidence: field.confidence,
        },
      })
      changed.conflicts++
      await audit(orgId, EnrichmentAuditAction.FIELD_CONFLICT_CREATED, null, { requestId: request.id, field: field.field, entityId, enrichedValue: field.value })
    }
    applied++
  }

  if (changed.updated > 0) {
    if (candidate) {
      await recalculateQualityAndScores(orgId, target, candidate)
    } else if (lead) {
      await markScoresStale(orgId, { leadId: entityId })
    }
    await audit(orgId, EnrichmentAuditAction.FIELD_ENRICHED, null, { requestId: request.id, entityId, fieldsUpdated: changed.updated })
  }
  return { applied, changed }
}

async function writeEntityValue(
  entity: LeadCandidate | { company?: { id?: string; name?: string; normalizedName?: string } | null; contact?: { id?: string } | null },
  target: EnrichmentTarget,
  field: EnrichmentField,
) {
  const value = field.normalizedValue ?? field.value
  if (target.kind === "lead") {
    const lead = entity as { company?: { id?: string; name?: string; normalizedName?: string } | null; contact?: { id?: string } | null }
    const companyFieldMap: Record<string, string> = {
      company_name: "name",
      company_domain: "domain",
      website: "website",
      description: "description",
      industry: "industry",
      country: "country",
      region: "state",
      city: "city",
      phone: "phone",
      linkedin_url: "linkedinUrl",
    }
    if (field.field === "company_name" && lead.company?.id) {
      await prisma.company.update({ where: { id: lead.company.id }, data: { name: value, normalizedName: normalizeCompanyName(value) } })
      return
    }
    if (companyFieldMap[field.field] && lead.company?.id) {
      const data = { [companyFieldMap[field.field]]: value }
      await prisma.company.update({ where: { id: lead.company.id }, data }).catch((e: unknown) => {
        // §64: never silently drop the old value — surface unique-violation
        // domain/email collisions as a conflict instead.
        if ((e as { code?: string }).code === "P2002" && field.field === "company_domain") {
          throw new Error("Domain already belongs to another company in this organization")
        }
        throw e
      })
      return
    }
    const contactFieldMap: Record<string, string> = { email: "email", phone: "phone", linkedin_url: "linkedinUrl", job_title: "jobTitle" }
    if (contactFieldMap[field.field] && lead.contact?.id) {
      await prisma.contact.update({ where: { id: lead.contact.id }, data: { [contactFieldMap[field.field]]: value } })
      return
    }
    if (field.field === "contact_name" && lead.contact?.id) {
      const [first, ...rest] = value.trim().split(/\s+/)
      await prisma.contact.update({
        where: { id: lead.contact.id },
        data: { firstName: first, lastName: rest.length ? rest.join(" ") : null, fullName: value.trim() },
      })
    }
    return
  }
  const candidate = entity as LeadCandidate
  const column = CANDIDATE_FIELD_MAP[field.field]
  if (!column) return
  await prisma.leadCandidate.update({ where: { id: candidate.id }, data: { [column]: value } })
  if (field.field === "company_name") {
    await prisma.leadCandidate.update({ where: { id: candidate.id }, data: { normalizedCompanyName: normalizeCompanyName(value) } })
  }
}

async function recalculateQualityAndScores(orgId: string, target: EnrichmentTarget, candidate: LeadCandidate) {
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
  await markScoresStale(orgId, { candidateId: candidate.id })
  // §47: queue the rescore instead of scoring synchronously.
  const scoring = await startBulkScoring(orgId, [candidate.id])
  if (scoring.ok) enqueueScoringJob(scoring.jobId)
}

async function markScoresStale(orgId: string, entity: { leadId?: string; candidateId?: string }) {
  await prisma.leadScore.updateMany({
    where: {
      organizationId: orgId,
      scoreStatus: ScoreStatus.CURRENT,
      ...(entity.leadId ? { leadId: entity.leadId } : { candidateId: entity.candidateId }),
    },
    data: { scoreStatus: ScoreStatus.STALE },
  })
}

// ── conflicts ─────────────────────────────────────────────────────────────

export async function resolveConflict(
  orgId: string,
  conflictId: string,
  resolution: ConflictResolution,
  actor: { id: string; name: string } | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const conflict = await prisma.enrichmentConflict.findFirst({ where: { id: conflictId, organizationId: orgId } })
  if (!conflict) return { ok: false, error: "Conflict not found" }
  if (conflict.status !== EnrichmentConflictStatus.OPEN) return { ok: false, error: "Conflict already resolved" }

  const result = await prisma.enrichmentResult.findFirst({
    where: {
      organizationId: orgId,
      requestId: conflict.requestId,
      field: conflict.field,
      value: { equals: conflict.enrichedValue, mode: "insensitive" },
      status: EnrichmentResultStatus.CONFLICT,
    },
  })

  try {
    if (resolution === ConflictResolution.ACCEPT_NEW) {
      const target = await loadTarget(orgId, { leadId: conflict.leadId ?? undefined, candidateId: conflict.candidateId ?? undefined })
      if (!target.entity) return { ok: false, error: "Target entity no longer exists" }
      await writeEntityValue(target.entity, target.target, {
        field: conflict.field as Parameters<typeof mergeValue>[0]["field"],
        value: conflict.enrichedValue,
        normalizedValue: conflict.enrichedValue,
        source: conflict.enrichedSource,
        method: "ENRICHMENT",
        confidence: conflict.confidence,
      })
      await markScoresStale(orgId, { leadId: conflict.leadId ?? undefined, candidateId: conflict.candidateId ?? undefined })
      if (conflict.candidateId) {
        const candidate = await prisma.leadCandidate.findFirst({ where: { id: conflict.candidateId, organizationId: orgId } })
        if (candidate) await recalculateQualityAndScores(orgId, { kind: "candidate", id: conflict.candidateId }, candidate)
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to apply resolution" }
  }

  await prisma.enrichmentConflict.update({
    where: { id: conflictId },
    data: {
      status: resolution === ConflictResolution.DISMISSED ? EnrichmentConflictStatus.DISMISSED : EnrichmentConflictStatus.RESOLVED,
      resolution,
      resolvedById: actor?.id ?? null,
      resolvedAt: new Date(),
    },
  })
  if (result) {
    await prisma.enrichmentResult.update({
      where: { id: result.id },
      data: { status: resolution === ConflictResolution.ACCEPT_NEW ? EnrichmentResultStatus.CONFIRMED : EnrichmentResultStatus.REJECTED },
    })
  }
  await audit(orgId, EnrichmentAuditAction.FIELD_CONFLICT_RESOLVED, actor, { conflictId, resolution })
  return { ok: true }
}

// ── retry / cancel ────────────────────────────────────────────────────────

export async function retryEnrichment(orgId: string, requestId: string, actor: { id: string; name: string } | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const request = await prisma.enrichmentRequest.findFirst({ where: { id: requestId, organizationId: orgId } })
  if (!request) return { ok: false, error: "Request not found" }
  if (request.status !== EnrichmentRequestStatus.FAILED) return { ok: false, error: "Only failed requests can be retried" }
  if (request.retries >= MAX_RETRIES) return { ok: false, error: "Maximum retries reached" }
  if (!RETRYABLE_ERRORS.has(request.errorCode)) return { ok: false, error: `"${request.errorCode}" is not retryable` }

  await prisma.enrichmentRequest.update({
    where: { id: requestId },
    data: { status: EnrichmentRequestStatus.QUEUED, retries: request.retries + 1, errorCode: null, errorMessage: null, completedAt: null, startedAt: null },
  })
  await audit(orgId, EnrichmentAuditAction.ENRICHMENT_RETRIED, actor, { requestId })
  return { ok: true }
}

export async function cancelEnrichment(orgId: string, requestId: string, actor: { id: string; name: string } | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const request = await prisma.enrichmentRequest.findFirst({ where: { id: requestId, organizationId: orgId } })
  if (!request) return { ok: false, error: "Request not found" }
  if (!ACTIVE_STATUSES.includes(request.status)) {
    return { ok: false, error: "Only queued or running requests can be cancelled" }
  }
  await prisma.enrichmentRequest.update({ where: { id: requestId }, data: { status: EnrichmentRequestStatus.CANCELLED, completedAt: new Date() } })
  await audit(orgId, EnrichmentAuditAction.ENRICHMENT_CANCELLED, actor, { requestId })
  return { ok: true }
}

// ── reads ─────────────────────────────────────────────────────────────────

export async function listRequests(orgId: string, filters: { page?: string; pageSize?: string; status?: string } = {}) {
  const { parsePagination } = await import("@/lib/crm/pagination")
  const { page, pageSize } = parsePagination(filters)
  const where: Record<string, unknown> = { organizationId: orgId }
  if (filters.status) where.status = filters.status
  const [total, data] = await Promise.all([
    prisma.enrichmentRequest.count({ where }),
    prisma.enrichmentRequest.findMany({
      where,
      orderBy: { requestedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        lead: { select: { title: true, company: { select: { name: true } } } },
        candidate: { select: { companyName: true, contactFullName: true } },
      },
    }),
  ])
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function getRequest(orgId: string, requestId: string) {
  return prisma.enrichmentRequest.findFirst({
    where: { id: requestId, organizationId: orgId },
    include: {
      lead: { select: { id: true, title: true, company: { select: { name: true } } } },
      candidate: { select: { id: true, companyName: true, contactFullName: true } },
      requestedBy: { select: { name: true } },
      results: { orderBy: { observedAt: "desc" } },
      conflicts: { orderBy: { createdAt: "desc" } },
    },
  })
}

export async function latestEntityRequest(orgId: string, entity: { leadId?: string; candidateId?: string }) {
  return prisma.enrichmentRequest.findFirst({
    where: {
      organizationId: orgId,
      ...(entity.leadId ? { leadId: entity.leadId } : { candidateId: entity.candidateId }),
    },
    orderBy: { requestedAt: "desc" },
  })
}

export async function listEntityResults(orgId: string, entity: { leadId?: string; candidateId?: string }) {
  return prisma.enrichmentResult.findMany({
    where: {
      organizationId: orgId,
      ...(entity.leadId ? { leadId: entity.leadId } : { candidateId: entity.candidateId }),
      status: { not: EnrichmentResultStatus.STALE },
    },
    orderBy: [{ field: "asc" }, { observedAt: "desc" }],
  })
}

export async function listEntityConflicts(orgId: string, entity: { leadId?: string; candidateId?: string }, status?: EnrichmentConflictStatus) {
  return prisma.enrichmentConflict.findMany({
    where: {
      organizationId: orgId,
      ...(entity.leadId ? { leadId: entity.leadId } : { candidateId: entity.candidateId }),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
  })
}

// ── bulk ──────────────────────────────────────────────────────────────────

export async function bulkPreview(orgId: string, ids: string[]): Promise<{ eligible: number; recentlyEnriched: number; missingWebsite: number; active: number; queued: number }> {
  const settings = await getSettings(orgId)
  const cutoff = new Date(Date.now() - settings.freshnessDays * 86400000)
  const candidates = await prisma.leadCandidate.findMany({
    where: { organizationId: orgId, id: { in: ids } },
    select: { id: true, companyDomain: true, websiteUrl: true, status: true },
  })
  const requests = await prisma.enrichmentRequest.findMany({
    where: {
      organizationId: orgId,
      candidateId: { in: ids },
      status: { in: [EnrichmentRequestStatus.QUEUED, EnrichmentRequestStatus.RUNNING, EnrichmentRequestStatus.COMPLETED, EnrichmentRequestStatus.PARTIAL] },
    },
    select: { candidateId: true, status: true, completedAt: true },
  })
  const eligible = candidates.filter((c) => Boolean(c.companyDomain || c.websiteUrl) && !["DUPLICATE", "FAILED", "SKIPPED"].includes(c.status))
  const activeCount = eligible.filter((c) => requests.some((r) => r.candidateId === c.id && ACTIVE_STATUSES.includes(r.status))).length
  const recentCount = eligible.filter((c) =>
    requests.some((r) => r.candidateId === c.id && SUCCESS_STATUSES.includes(r.status) && r.completedAt && r.completedAt >= cutoff),
  ).length
  return {
    eligible: eligible.length,
    recentlyEnriched: recentCount,
    missingWebsite: candidates.length - eligible.length,
    active: activeCount,
    queued: eligible.length - recentCount - activeCount,
  }
}

export async function bulkEnrich(orgId: string, actor: { id: string; name: string } | null, ids: string[]): Promise<{ queued: number; skippedRecent: number; skippedActive: number; ineligible: number; failed: number }> {
  const settings = await getSettings(orgId)
  if (ids.length > settings.batchMaxLeads) {
    throw new Error(`Batches are limited to ${settings.batchMaxLeads} leads per request`)
  }
  const preview = await bulkPreview(orgId, ids)
  const candidates = await prisma.leadCandidate.findMany({
    where: { organizationId: orgId, id: { in: ids } },
    select: { id: true, companyDomain: true, websiteUrl: true, status: true },
  })
  const requests = await prisma.enrichmentRequest.findMany({
    where: { organizationId: orgId, candidateId: { in: ids }, status: { in: [EnrichmentRequestStatus.QUEUED, EnrichmentRequestStatus.RUNNING, EnrichmentRequestStatus.COMPLETED, EnrichmentRequestStatus.PARTIAL] } },
    select: { candidateId: true, status: true, completedAt: true },
  })
  const cutoff = new Date(Date.now() - settings.freshnessDays * 86400000)

  let queued = 0
  let failed = 0
  for (const candidate of candidates) {
    if (!candidate.companyDomain && !candidate.websiteUrl) continue
    if (["DUPLICATE", "FAILED", "SKIPPED"].includes(candidate.status)) continue
    const hasActive = requests.some((r) => r.candidateId === candidate.id && ACTIVE_STATUSES.includes(r.status))
    if (hasActive) continue
    const hasRecent = requests.some(
      (r) => r.candidateId === candidate.id && SUCCESS_STATUSES.includes(r.status) && r.completedAt && r.completedAt >= cutoff,
    )
    if (hasRecent) continue
    const result = await requestEnrichment(orgId, actor, { candidateId: candidate.id })
    if (result.ok) queued++
    else failed++
  }
  return { queued, skippedRecent: preview.recentlyEnriched, skippedActive: preview.active, ineligible: preview.missingWebsite, failed }
}

// ── stats ─────────────────────────────────────────────────────────────────

export interface EnrichmentStats {
  coveragePct: number | null
  candidates: number
  eligibleCandidates: number
  enrichedCandidates: number
  recentlyEnriched: number
  failedLast7d: number
  openConflicts: number
}

export async function enrichmentStats(orgId: string): Promise<EnrichmentStats> {
  const settings = await getSettings(orgId)
  const cutoff = new Date(Date.now() - settings.freshnessDays * 86400000)
  const weekAgo = new Date(Date.now() - 7 * 86400000)
  const [eligible, completions, recent, failed, openConflicts] = await Promise.all([
    prisma.leadCandidate.count({ where: { organizationId: orgId, OR: [{ companyDomain: { not: null } }, { websiteUrl: { not: null } }] } }),
    prisma.enrichmentRequest.findMany({
      where: { organizationId: orgId, candidateId: { not: null }, status: { in: [EnrichmentRequestStatus.COMPLETED, EnrichmentRequestStatus.PARTIAL] } },
      select: { candidateId: true },
      distinct: ["candidateId"],
    }),
    prisma.enrichmentRequest.count({ where: { organizationId: orgId, status: { in: [EnrichmentRequestStatus.COMPLETED, EnrichmentRequestStatus.PARTIAL] }, completedAt: { gte: cutoff } } }),
    prisma.enrichmentRequest.count({ where: { organizationId: orgId, status: EnrichmentRequestStatus.FAILED, requestedAt: { gte: weekAgo } } }),
    prisma.enrichmentConflict.count({ where: { organizationId: orgId, status: EnrichmentConflictStatus.OPEN } }),
  ])
  const enrichedCandidates = completions.length
  return {
    coveragePct: eligible > 0 ? Math.round((enrichedCandidates / eligible) * 100) : null,
    candidates: eligible,
    eligibleCandidates: eligible,
    enrichedCandidates,
    recentlyEnriched: recent,
    failedLast7d: failed,
    openConflicts,
  }
}

export async function providerStats(orgId: string) {
  const requests = await prisma.enrichmentRequest.findMany({
    where: { organizationId: orgId },
    select: { providerId: true, status: true, fieldsFound: true, conflictsCount: true, createdAt: true },
  })
  const byProvider = new Map<string, { total: number; successful: number; fields: number; conflicts: number; lastUsed: Date | null }>()
  for (const r of requests) {
    const acc = byProvider.get(r.providerId) ?? { total: 0, successful: 0, fields: 0, conflicts: 0, lastUsed: null }
    acc.total++
    if (SUCCESS_STATUSES.includes(r.status)) acc.successful++
    acc.fields += r.fieldsFound
    acc.conflicts += r.conflictsCount
    if (!acc.lastUsed || r.createdAt > acc.lastUsed) acc.lastUsed = r.createdAt
    byProvider.set(r.providerId, acc)
  }
  return [...byProvider.entries()].map(([providerId, s]) => ({
    providerId,
    requests: s.total,
    successRate: s.total > 0 ? Math.round((s.successful / s.total) * 100) : null,
    avgFieldsFound: s.total > 0 ? Math.round((s.fields / s.total) * 10) / 10 : null,
    conflictCount: s.conflicts,
    lastUsed: s.lastUsed,
  }))
}

export async function queueCounts(orgId: string) {
  const [running, queued, completedToday, failed] = await Promise.all([
    prisma.enrichmentRequest.count({ where: { organizationId: orgId, status: EnrichmentRequestStatus.RUNNING } }),
    prisma.enrichmentRequest.count({ where: { organizationId: orgId, status: EnrichmentRequestStatus.QUEUED } }),
    prisma.enrichmentRequest.count({ where: { organizationId: orgId, status: { in: [EnrichmentRequestStatus.COMPLETED, EnrichmentRequestStatus.PARTIAL] }, completedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
    prisma.enrichmentRequest.count({ where: { organizationId: orgId, status: EnrichmentRequestStatus.FAILED } }),
  ])
  return { running, queued, completedToday, failed }
}