// Entity resolution orchestration (TASK 009 §36-§43, §62, §73): blocking,
// incremental + batch deduplication with deterministic idempotent results.

import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import {
  DuplicateGroupStatus,
  EntityType,
  MatchStatus,
  MatchConfidence,
} from "@/generated/prisma/enums"
import {
  decideMatch,
  entityDecision,
  type CandidateIdentity,
} from "@/lib/lead-engine/resolution/match"
import {
  companyNamePrefix,
  emailDomain,
  isGenericEmailDomain,
  normalizeCompanyName,
  normalizeDomain,
  normalizeLinkedInUrl,
} from "@/lib/lead-engine/resolution/normalize"
import { normalizePhone } from "@/lib/lead-engine/extraction/normalize"
import { createResolutionGroup, pairIds } from "@/lib/lead-engine/resolution/groups"
import { assessQuality } from "@/lib/lead-engine/resolution/quality"

const BLOCK_TAKE = 50

export const CANDIDATE_SELECT = {
  id: true,
  companyName: true,
  companyDomain: true,
  websiteUrl: true,
  email: true,
  phone: true,
  phoneRaw: true,
  linkedinUrl: true,
  contactFullName: true,
  contactJobTitle: true,
  country: true,
  city: true,
  normalizedCompanyName: true,
  createdAt: true,
  rawPage: { select: { url: true, fetchedAt: true } },
} as const

export type CandidateRow = Prisma.LeadCandidateGetPayload<{ select: typeof CANDIDATE_SELECT }>

// ── Blocking (spec §37): bounded candidate buckets, no global O(n²) ───────

// Every strong identifier contributes one bucket key; a candidate is only
// ever compared with others sharing a key.
function blockingKeys(candidate: CandidateRow): string[] {
  const keys: string[] = []
  const domain = normalizeDomain(candidate.companyDomain ?? candidate.websiteUrl ?? "")
  if (domain) keys.push(`d:${domain}`)
  const emailDomainKey = candidate.email ? emailDomain(candidate.email) : null
  if (emailDomainKey && !isGenericEmailDomain(emailDomainKey)) keys.push(`ed:${emailDomainKey}`)
  if (candidate.email) keys.push(`e:${candidate.email.toLowerCase()}`)
  const phone = normalizePhone(candidate.phone ?? candidate.phoneRaw ?? "")
  if (phone) keys.push(`p:${phone}`)
  const linkedin = candidate.linkedinUrl ? normalizeLinkedInUrl(candidate.linkedinUrl) : null
  if (linkedin) keys.push(`l:${linkedin.slice("linkedin.com/".length)}`)
  const company = candidate.normalizedCompanyName ?? (candidate.companyName ? normalizeCompanyName(candidate.companyName) : "")
  if (company) keys.push(`n:${companyNamePrefix(company)}`)
  return [...new Set(keys)]
}

async function bucketCandidates(orgId: string, candidate: CandidateRow): Promise<CandidateRow[]> {
  const or: Prisma.LeadCandidateWhereInput[] = []
  for (const key of blockingKeys(candidate)) {
    const [prefix, value] = [key.slice(0, 2), key.slice(2)]
    if (prefix === "d:") or.push({ companyDomain: value })
    else if (prefix === "ed:") or.push({ email: { contains: `@${value}` } })
    else if (prefix === "e:") or.push({ email: value })
    else if (prefix === "p:") or.push({ OR: [{ phone: value }, { phoneRaw: value }] })
    else if (prefix === "l:") or.push({ linkedinUrl: { contains: value } })
    else if (prefix === "n:") or.push({ normalizedCompanyName: { startsWith: value } })
  }
  if (or.length === 0) return []
  return prisma.leadCandidate.findMany({
    where: { organizationId: orgId, id: { not: candidate.id }, OR: or },
    select: CANDIDATE_SELECT,
    take: BLOCK_TAKE,
  })
}

function loadCandidate(orgId: string, candidateId: string) {
  return prisma.leadCandidate.findFirst({
    where: { id: candidateId, { organizationId: orgId } },
    select: CANDIDATE_SELECT,
  })
}

// ── Pair comparison ───────────────────────────────────────────────────────

const toIdentity = (c: CandidateRow): CandidateIdentity => ({
  id: c.id,
  companyName: c.companyName,
  companyDomain: c.companyDomain,
  websiteUrl: c.websiteUrl,
  email: c.email,
  phone: c.phone ?? c.phoneRaw,
  linkedinUrl: c.linkedinUrl,
  contactFullName: c.contactFullName,
  contactJobTitle: c.contactJobTitle,
  country: c.country,
  city: c.city,
})

function comparePair(a: CandidateRow, b: CandidateRow) {
  const { entityType, match } = entityDecision(toIdentity(a), toIdentity(b))
  const decision = decideMatch(match.score)
  const status = (decision === "AUTO_MATCH" ? "AUTO_MATCH" : decision === "REVIEW" ? "REVIEW" : "NOT_MATCH") as MatchStatus
  return { entityType, score: match.score, reasons: match.reasons, decision, status }
}

function confidenceOf(score: number): MatchConfidence {
  if (score >= 90) return MatchConfidence.HIGH
  if (score >= 70) return MatchConfidence.MEDIUM
  return MatchConfidence.LOW
}

// ── Match record persistence (idempotency §42-§43, §70) ───────────────────

function existingMatch(orgId: string, a: string, b: string) {
  const { candidateAId, candidateBId } = pairIds(a, b)
  return prisma.entityMatch.findUnique({
    where: { organizationId_candidateAId_candidateBId: { organizationId: orgId, candidateAId, candidateBId } },
  })
}

async function saveMatch(
  orgId: string,
  a: string,
  b: string,
  entityType: EntityType,
  score: number,
  reasons: string[],
  status: MatchStatus,
) {
  const { candidateAId, candidateBId } = pairIds(a, b)
  await prisma.entityMatch.upsert({
    where: { organizationId_candidateAId_candidateBId: { organizationId: orgId, candidateAId, candidateBId } },
    update: { score, confidence: confidenceOf(score), reasons: reasons as Prisma.InputJsonValue, status, entityType },
    create: {
      organizationId: orgId,
      entityType,
      candidateAId,
      candidateBId,
      score,
      confidence: confidenceOf(score),
      reasons: reasons as Prisma.InputJsonValue,
      status,
    },
  })
}

// ── Incremental resolution (§40): one new candidate ───────────────────────

export interface ResolutionSummary {
  processed: number
  compared: number
  autoMatches: number
  reviewMatches: number
  nonMatches: number
}

const EMPTY_SUMMARY: ResolutionSummary = { processed: 0, compared: 0, autoMatches: 0, reviewMatches: 0, nonMatches: 0 }

async function groupExistsForPair(orgId: string, aId: string, bId: string, statuses: DuplicateGroupStatus[]) {
  return prisma.duplicateGroup.findFirst({
    where: {
      organizationId: orgId,
      status: { in: statuses },
      members: { every: { candidateId: { in: [aId, bId] } } },
    },
    select: { id: true },
  })
}

export async function resolveCandidate(orgId: string, candidateId: string): Promise<ResolutionSummary> {
  const candidate = await loadCandidate(orgId, candidateId)
  if (!candidate) return { ...EMPTY_SUMMARY }
  const bucket = await bucketCandidates(orgId, candidate)
  const summary: ResolutionSummary = { ...EMPTY_SUMMARY, processed: 1 }

  for (const other of bucket) {
    if (await existingMatch(orgId, candidateId, other.id)) continue
    summary.compared++
    const outcome = comparePair(candidate, other)
    await saveMatch(orgId, candidateId, other.id, outcome.entityType, outcome.score, outcome.reasons, outcome.status)

    if (outcome.decision === "AUTO_MATCH") {
      if (!(await groupExistsForPair(orgId, candidateId, other.id, [DuplicateGroupStatus.PENDING_REVIEW, DuplicateGroupStatus.AUTO_MERGED, DuplicateGroupStatus.CONFIRMED]))) {
        await createResolutionGroup(orgId, outcome.entityType, DuplicateGroupStatus.AUTO_MERGED, outcome.score, [
          { candidateId, score: outcome.score, reasons: outcome.reasons },
          { candidateId: other.id, score: outcome.score, reasons: outcome.reasons },
        ])
      }
      summary.autoMatches++
    } else if (outcome.decision === "REVIEW") {
      if (!(await groupExistsForPair(orgId, candidateId, other.id, [DuplicateGroupStatus.PENDING_REVIEW]))) {
        await createResolutionGroup(orgId, outcome.entityType, DuplicateGroupStatus.PENDING_REVIEW, outcome.score, [
          { candidateId, score: outcome.score, reasons: outcome.reasons },
          { candidateId: other.id, score: outcome.score, reasons: outcome.reasons },
        ])
      }
      summary.reviewMatches++
    } else {
      summary.nonMatches++
    }
  }
  return summary
}

// ── Batch resolution (§41): a completed extraction run ────────────────────

export async function deduplicateRun(orgId: string, runId: string): Promise<ResolutionSummary> {
  const candidates = await prisma.leadCandidate.findMany({
    where: { organizationId: orgId, runId },
    select: { id: true },
  })
  const summary: ResolutionSummary = { ...EMPTY_SUMMARY }
  for (const candidate of candidates) {
    const per = await resolveCandidate(orgId, candidate.id)
    summary.processed += per.processed
    summary.compared += per.compared
    summary.autoMatches += per.autoMatches
    summary.reviewMatches += per.reviewMatches
    summary.nonMatches += per.nonMatches
  }
  return summary
}

// ── Quality + identity backfill (TASK 009 §44-§50; pre-existing candidates) ─

export function qualityFields(candidate: {
  companyName?: string | null
  companyDomain?: string | null
  websiteUrl?: string | null
  contactFullName?: string | null
  email?: string | null
  phone?: string | null
  linkedinUrl?: string | null
  extractionConfidence?: number | null
  pageClassification?: string | null
  fieldProvenance?: unknown
}) {
  const assessment = assessQuality({
    companyName: candidate.companyName,
    companyDomain: candidate.companyDomain,
    websiteUrl: candidate.websiteUrl,
    contactFullName: candidate.contactFullName,
    email: candidate.email,
    phone: candidate.phone,
    linkedinUrl: candidate.linkedinUrl,
    extractionConfidence: candidate.extractionConfidence,
    pageClassification: candidate.pageClassification,
    hasEvidence: Boolean(candidate.fieldProvenance && Object.keys(candidate.fieldProvenance as Record<string, unknown>).length > 0),
  })
  return {
    dataQualityScore: assessment.score,
    qualityFlags: assessment.flags as unknown as Prisma.InputJsonValue,
    qualityExplanation: assessment.weights as unknown as Prisma.InputJsonValue,
  }
}
