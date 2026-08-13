// TASK 012: scoring service — persistence, idempotency, rescoring, bulk
// jobs, invalidation and audit (§16-§22, §58-§66). All queries org-scoped.

import { prisma } from "@/lib/db"
import { getActiveICP } from "@/lib/crm/icp"
import type { ICPCriteria } from "@/lib/crm/icp-shared"
import { evaluate, SCORING_VERSION, type CriterionResult, type ScoreInput, type Seniority } from "./engine"
import { ScoringAuditAction, ScoreSource, ScoreStatus, Qualification, LeadScoreJobStatus, CandidateStatus } from "@/generated/prisma/enums"
import type { Lead, LeadCandidate } from "@/generated/prisma/client"

export interface ScoredResult {
  icpScore: number
  overallScore: number
  qualification: Qualification
  breakdown: CriterionResult[]
  reasons: string[]
  modelVersion: string
  icpProfileId: string | null
}

// ── entity → engine input ─────────────────────────────────────────────────

export function candidateInput(candidate: Pick<LeadCandidate, "companyName" | "description" | "industry" | "country" | "city" | "contactJobTitle" | "email" | "companyDomain" | "dataQualityScore">): ScoreInput {
  return {
    industry: candidate.industry,
    companyName: candidate.companyName,
    description: candidate.description,
    country: candidate.country,
    city: candidate.city,
    jobTitle: candidate.contactJobTitle,
    email: candidate.email,
    companyDomain: candidate.companyDomain,
    dataQualityScore: candidate.dataQualityScore,
  }
}

export function leadInput(lead: Pick<Lead, "title" | "sourceCandidateId"> & { company?: { employeeCount: number | null; industry: string | null; country: string | null; city: string | null; description: string | null; name: string; domain: string | null } | null; contact?: { jobTitle: string | null; email: string | null } | null }): ScoreInput {
  return {
    industry: lead.company?.industry,
    companyName: lead.company?.name,
    description: lead.company?.description,
    employeeCount: lead.company?.employeeCount,
    country: lead.company?.country,
    city: lead.company?.city,
    jobTitle: lead.contact?.jobTitle ?? lead.title,
    email: lead.contact?.email,
    companyDomain: lead.company?.domain,
    dataQualityScore: null,
  }
}

// ── active ICP config ─────────────────────────────────────────────────────

export function scoringCriteriaOf(criteria: ICPCriteria) {
  const scoring = criteria.scoring ?? {
    keywords: [],
    jobTitles: [],
    seniorities: [],
    domains: [],
    weights: { industry: 20, companySize: 20, location: 10, title: 20, keyword: 10, domain: 10, quality: 10 },
    thresholds: { hot: 80, good: 60, maybe: 40 },
    unknownCredit: 40,
  }
  return {
    industries: criteria.industries,
    countries: criteria.countries,
    cities: criteria.cities,
    sizeRange: criteria.employeeRange,
    keywords: scoring.keywords,
    jobTitles: scoring.jobTitles,
    seniorities: scoring.seniorities as Seniority[],
    domains: scoring.domains,
    weights: scoring.weights,
    thresholds: scoring.thresholds,
    unknownCredit: scoring.unknownCredit,
  }
}

export async function loadActiveScoring(orgId: string): Promise<{ icpProfileId: string; config: ReturnType<typeof scoringCriteriaOf> } | null> {
  const icp = await getActiveICP(orgId)
  if (!icp) return null
  return { icpProfileId: icp.id, config: scoringCriteriaOf(icp.criteria) }
}

// ── scoring + persistence ─────────────────────────────────────────────────

async function audit(orgId: string, action: ScoringAuditAction, actor: { id?: string; name?: string } | null, details?: Record<string, unknown>) {
  await prisma.scoringAuditEvent.create({
    data: {
      organizationId: orgId,
      action,
      actorUserId: actor?.id ?? null,
      actorName: actor?.name ?? null,
      details: details && Object.keys(details).length > 0 ? (details as object) : undefined,
    },
  })
}

async function currentScore(orgId: string, entity: { leadId?: string; candidateId?: string }) {
  return prisma.leadScore.findFirst({
    where: {
      organizationId: orgId,
      scoreStatus: ScoreStatus.CURRENT,
      ...(entity.leadId ? { leadId: entity.leadId } : { candidateId: entity.candidateId }),
    },
    orderBy: { scoredAt: "desc" },
  })
}

export interface ScoreOptions {
  actor?: { id: string; name: string } | null
  source?: ScoreSource
}

/**
 * §61: idempotent — a CURRENT score for the same entity is returned as-is
 * unless `force` (rescoring) is set. Rescoring marks the previous CURRENT
 * record STALE and appends the new score (§18-§19).
 */
export async function scoreCandidate(orgId: string, candidateId: string, opts: ScoreOptions = {}, force = false): Promise<ScoredResult | null> {
  const [candidate, active] = await Promise.all([
    prisma.leadCandidate.findFirst({
      where: { id: candidateId, organizationId: orgId },
      select: {
        status: true,
        companyName: true, description: true, industry: true, country: true, city: true,
        contactJobTitle: true, email: true, companyDomain: true, dataQualityScore: true,
      },
    }),
    loadActiveScoring(orgId),
  ])
  if (!candidate || !active) return null
  // §33: never score duplicates/failed/skipped — the canonical covers them.
  const skipStatuses: CandidateStatus[] = [CandidateStatus.DUPLICATE, CandidateStatus.FAILED, CandidateStatus.SKIPPED, CandidateStatus.PENDING, CandidateStatus.PROCESSING]
  if (skipStatuses.includes(candidate.status)) return null
  const existing = force ? null : await currentScore(orgId, { candidateId })
  if (existing) {
    return {
      icpScore: existing.icpScore,
      overallScore: existing.overallScore,
      qualification: existing.qualification,
      breakdown: existing.scoreBreakdown as unknown as CriterionResult[],
      reasons: existing.reasons as unknown as string[],
      modelVersion: existing.modelVersion,
      icpProfileId: existing.icpProfileId,
    }
  }
  const result = evaluate({ ...candidateInput(candidate), ...active.config })
  await prisma.$transaction([
    prisma.leadScore.updateMany({
      where: { organizationId: orgId, candidateId, scoreStatus: ScoreStatus.CURRENT },
      data: { scoreStatus: ScoreStatus.STALE },
    }),
    prisma.leadScore.create({
      data: {
        organizationId: orgId,
        candidateId,
        icpProfileId: active.icpProfileId,
        source: opts.source ?? ScoreSource.CANDIDATE,
        modelVersion: SCORING_VERSION,
        icpScore: result.icpScore,
        overallScore: result.overallScore,
        qualification: result.qualification,
        scoreStatus: ScoreStatus.CURRENT,
        scoreBreakdown: result.breakdown as unknown as object,
        reasons: result.reasons as unknown as object,
      },
    }),
  ])
  await audit(orgId, force ? ScoringAuditAction.LEAD_RESCORED : ScoringAuditAction.LEAD_SCORED, opts.actor ?? null, { candidateId, icpProfileId: active.icpProfileId, overallScore: result.overallScore })
  return {
    icpScore: result.icpScore,
    overallScore: result.overallScore,
    qualification: result.qualification,
    breakdown: result.breakdown,
    reasons: result.reasons,
    modelVersion: SCORING_VERSION,
    icpProfileId: active.icpProfileId,
  }
}

export async function scoreLead(orgId: string, leadId: string, opts: ScoreOptions = {}, force = false): Promise<ScoredResult | null> {
  const [lead, active] = await Promise.all([
    prisma.lead.findFirst({
      where: { id: leadId, organizationId: orgId },
      include: {
        company: { select: { name: true, industry: true, employeeCount: true, country: true, city: true, description: true, domain: true } },
        contact: { select: { jobTitle: true, email: true } },
      },
    }),
    loadActiveScoring(orgId),
  ])
  if (!lead || !active) return null
  const existing = force ? null : await currentScore(orgId, { leadId })
  if (existing) {
    return {
      icpScore: existing.icpScore,
      overallScore: existing.overallScore,
      qualification: existing.qualification,
      breakdown: existing.scoreBreakdown as unknown as CriterionResult[],
      reasons: existing.reasons as unknown as string[],
      modelVersion: existing.modelVersion,
      icpProfileId: existing.icpProfileId,
    }
  }
  const result = evaluate({ ...leadInput(lead), ...active.config })
  await prisma.$transaction([
    prisma.leadScore.updateMany({
      where: { organizationId: orgId, leadId, scoreStatus: ScoreStatus.CURRENT },
      data: { scoreStatus: ScoreStatus.STALE },
    }),
    prisma.leadScore.create({
      data: {
        organizationId: orgId,
        leadId,
        icpProfileId: active.icpProfileId,
        source: opts.source ?? ScoreSource.CRM,
        modelVersion: SCORING_VERSION,
        icpScore: result.icpScore,
        overallScore: result.overallScore,
        qualification: result.qualification,
        scoreStatus: ScoreStatus.CURRENT,
        scoreBreakdown: result.breakdown as unknown as object,
        reasons: result.reasons as unknown as object,
      },
    }),
    // §51: mirror onto the indexed CRM columns for fast sort/filter.
    prisma.lead.update({ where: { id: leadId }, data: { score: result.overallScore, fitScore: result.icpScore } }),
  ])
  await audit(orgId, force ? ScoringAuditAction.LEAD_RESCORED : ScoringAuditAction.LEAD_SCORED, opts.actor ?? null, { leadId, icpProfileId: active.icpProfileId, overallScore: result.overallScore })
  return {
    icpScore: result.icpScore,
    overallScore: result.overallScore,
    qualification: result.qualification,
    breakdown: result.breakdown,
    reasons: result.reasons,
    modelVersion: SCORING_VERSION,
    icpProfileId: active.icpProfileId,
  }
}

// §64: ICP change invalidates existing scores (one cheap UPDATE), then a
// bulk rescore job re-validates them asynchronously.
export async function invalidateScoresForIcpChange(orgId: string, icpProfileId: string | null, actor?: { id: string; name: string } | null): Promise<void> {
  const where = icpProfileId
    ? { organizationId: orgId, icpProfileId, scoreStatus: ScoreStatus.CURRENT }
    : { organizationId: orgId, scoreStatus: ScoreStatus.CURRENT }
  await prisma.leadScore.updateMany({ where, data: { scoreStatus: ScoreStatus.STALE } })
  await audit(orgId, ScoringAuditAction.ICP_UPDATED, actor ?? null, { icpProfileId, stale: (await prisma.leadScore.count({ where })) })
}

export async function scoreHistory(orgId: string, leadId: string) {
  return prisma.leadScore.findMany({
    where: { organizationId: orgId, leadId },
    orderBy: { scoredAt: "desc" },
    select: { id: true, icpScore: true, overallScore: true, qualification: true, modelVersion: true, scoreStatus: true, scoredAt: true, icpProfileId: true },
  })
}

export async function latestLeadScore(orgId: string, leadId: string) {
  return currentScore(orgId, { leadId })
}

export async function latestCandidateScore(orgId: string, candidateId: string) {
  return currentScore(orgId, { candidateId })
}

// ── bulk scoring job (§47, §59-§61) ───────────────────────────────────────

export async function startBulkScoring(orgId: string, candidateIds: string[], actor?: { id: string; name: string } | null): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
  const active = await loadActiveScoring(orgId)
  if (!active) return { ok: false, error: "No active ICP profile configured" }
  if (candidateIds.length === 0) return { ok: false, error: "No candidates selected" }
  const job = await prisma.leadScoreJob.create({
    data: { organizationId: orgId, icpProfileId: active.icpProfileId, status: LeadScoreJobStatus.PENDING, total: candidateIds.length, candidateIds },
  })
  await audit(orgId, ScoringAuditAction.BULK_SCORING_STARTED, actor ?? null, { jobId: job.id, count: candidateIds.length })
  return { ok: true, jobId: job.id }
}

export async function runScoringJob(jobId: string): Promise<void> {
  const job = await prisma.leadScoreJob.findUnique({ where: { id: jobId } })
  if (!job || job.status !== LeadScoreJobStatus.PENDING) return
  const active = await loadActiveScoring(job.organizationId)
  const ids = (job.candidateIds as string[] | null) ?? []
  if (!active || ids.length === 0) {
    await prisma.leadScoreJob.update({ where: { id: jobId }, data: { status: LeadScoreJobStatus.FAILED, finishedAt: new Date() } })
    return
  }

  await prisma.leadScoreJob.update({ where: { id: jobId }, data: { status: LeadScoreJobStatus.RUNNING, startedAt: new Date() } })
  const BATCH = 200
  let scored = 0
  let failed = 0
  const counts = { hot: 0, good: 0, maybe: 0, low: 0 }

  try {
    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH)
      const candidates = await prisma.leadCandidate.findMany({
        where: { organizationId: job.organizationId, id: { in: slice } },
        select: { id: true, companyName: true, description: true, industry: true, country: true, city: true, contactJobTitle: true, email: true, companyDomain: true, dataQualityScore: true },
      })
      await Promise.all(
        candidates.map(async (candidate) => {
          const existing = await prisma.leadScore.findFirst({
            where: { organizationId: job.organizationId, candidateId: candidate.id, scoreStatus: ScoreStatus.CURRENT },
            select: { id: true },
          })
          if (existing) return
          const result = evaluate({ ...candidateInput(candidate), ...active.config })
          await prisma.leadScore.create({
            data: {
              organizationId: job.organizationId,
              candidateId: candidate.id,
              icpProfileId: active.icpProfileId,
              source: ScoreSource.CANDIDATE,
              modelVersion: SCORING_VERSION,
              icpScore: result.icpScore,
              overallScore: result.overallScore,
              qualification: result.qualification,
              scoreBreakdown: result.breakdown as unknown as object,
              reasons: result.reasons as unknown as object,
            },
          })
          scored++
          if (result.qualification === Qualification.HOT) counts.hot++
          else if (result.qualification === Qualification.GOOD) counts.good++
          else if (result.qualification === Qualification.MAYBE) counts.maybe++
          else counts.low++
        }),
      )
      const failedInSlice = slice.length - candidates.length
      failed += failedInSlice
      await prisma.leadScoreJob.update({
        where: { id: jobId },
        data: { processed: i + slice.length, scored, failed, hot: counts.hot, good: counts.good, maybe: counts.maybe, low: counts.low },
      })
    }
    await prisma.leadScoreJob.update({ where: { id: jobId }, data: { status: LeadScoreJobStatus.COMPLETED, finishedAt: new Date() } })
    await audit(job.organizationId, ScoringAuditAction.BULK_SCORING_COMPLETED, null, { jobId, scored, failed })
  } catch (e) {
    await prisma.leadScoreJob.update({ where: { id: jobId }, data: { status: LeadScoreJobStatus.FAILED, finishedAt: new Date() } })
    console.log(`scoring.job.failed jobId=${jobId} error=${e instanceof Error ? e.message : "unknown"}`)
  }
}

export async function rescoreStaleLeads(orgId: string, actor?: { id: string; name: string } | null): Promise<void> {
  const staleLeadIds = await prisma.leadScore.findMany({
    where: { organizationId: orgId, leadId: { not: null }, scoreStatus: ScoreStatus.STALE },
    select: { leadId: true },
    distinct: ["leadId"],
    take: 500,
  })
  for (const row of staleLeadIds) {
    if (row.leadId) await scoreLead(orgId, row.leadId, { actor }, true)
  }
}