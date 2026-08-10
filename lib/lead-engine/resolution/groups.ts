// Duplicate group lifecycle (TASK 009 §22-§32, §53-§57): review groups,
// canonical selection, field merging with conflict records, audit events.
// Original candidates are never deleted or overwritten (§55).

import { prisma } from "@/lib/db"
import { Prisma } from "@/generated/prisma/client"
import {
  DuplicateGroupStatus,
  EntityType,
  MatchStatus,
  CandidateStatus,
  DuplicateAuditAction,
} from "@/generated/prisma/enums"
import { parsePagination } from "@/lib/crm/pagination"
import { sourceQuality } from "@/lib/lead-engine/resolution/quality"

export const { PENDING_REVIEW, CONFIRMED, REJECTED, AUTO_MERGED } = DuplicateGroupStatus

// ── Completeness (§26-§27) — canonical selection weights, centralized ─────

export const COMPLETENESS_WEIGHTS = {
  email: 20,
  phone: 10,
  linkedinUrl: 15,
  contactJobTitle: 10,
  companyDomain: 15,
  companyName: 10,
  location: 5,
  description: 5,
  sourceQuality: 10,
} as const

export interface CompletableCandidate {
  id: string
  email?: string | null
  phone?: string | null
  linkedinUrl?: string | null
  contactJobTitle?: string | null
  companyDomain?: string | null
  companyName?: string | null
  country?: string | null
  city?: string | null
  description?: string | null
  pageClassification?: string | null
  extractionConfidence?: number | null
  createdAt?: Date
  rawPage?: { fetchedAt?: Date | null } | null
}

// 0-100, pure measurement of data presence — NOT lead scoring (§27).
export function calculateCompleteness(candidate: CompletableCandidate): number {
  const base =
    (candidate.email ? COMPLETENESS_WEIGHTS.email : 0) +
    (candidate.phone ? COMPLETENESS_WEIGHTS.phone : 0) +
    (candidate.linkedinUrl ? COMPLETENESS_WEIGHTS.linkedinUrl : 0) +
    (candidate.contactJobTitle ? COMPLETENESS_WEIGHTS.contactJobTitle : 0) +
    (candidate.companyDomain ? COMPLETENESS_WEIGHTS.companyDomain : 0) +
    (candidate.companyName ? COMPLETENESS_WEIGHTS.companyName : 0) +
    (candidate.country || candidate.city ? COMPLETENESS_WEIGHTS.location : 0) +
    (candidate.description ? COMPLETENESS_WEIGHTS.description : 0)
  return Math.min(100, base + Math.round(COMPLETENESS_WEIGHTS.sourceQuality * sourceQuality(candidate.pageClassification)))
}

export function pickCanonical(candidates: CompletableCandidate[]): CompletableCandidate {
  return [...candidates].sort((a, b) => {
    const completeness = calculateCompleteness(b) - calculateCompleteness(a)
    if (completeness !== 0) return completeness
    const confidence = (b.extractionConfidence ?? 0) - (a.extractionConfidence ?? 0)
    if (confidence !== 0) return confidence
    return (a.rawPage?.fetchedAt ?? a.createdAt ?? new Date(0)).getTime() - (b.rawPage?.fetchedAt ?? b.createdAt ?? new Date(0)).getTime()
  })[0]
}

// ── Field merge (§29-§30) ──────────────────────────────────────────────────

const MERGE_FIELDS = [
  "companyName",
  "companyDomain",
  "websiteUrl",
  "description",
  "industry",
  "country",
  "region",
  "city",
  "contactFullName",
  "contactJobTitle",
  "email",
  "phoneRaw",
] as const

export interface MergeableCandidate {
  id: string
  companyName?: string | null
  companyDomain?: string | null
  websiteUrl?: string | null
  description?: string | null
  industry?: string | null
  country?: string | null
  region?: string | null
  city?: string | null
  contactFullName?: string | null
  contactJobTitle?: string | null
  email?: string | null
  phoneRaw?: string | null
}

export interface MergeOutcome {
  merged: Partial<Record<(typeof MERGE_FIELDS)[number], string>>
  conflicts: Array<{
    field: string
    values: Array<{ value: string; sourceCandidateId: string }>
  }>
}

// Canonical values come from the canonical candidate; empty fields are filled
// from other members; differing values are recorded as conflicts, not
// overwritten (§29).
export function mergeFields(canonical: MergeableCandidate, members: MergeableCandidate[], canonicalId: string): MergeOutcome {
  const merged: MergeOutcome["merged"] = {}
  const conflicts: MergeOutcome["conflicts"] = []

  for (const field of MERGE_FIELDS) {
    const canonicalValue = canonical[field]?.trim()
    if (canonicalValue) {
      merged[field] = canonicalValue
      const others = members.filter((m) => m.id !== canonicalId && m[field]?.trim() && m[field]!.trim() !== canonicalValue)
      if (others.length > 0) {
        conflicts.push({
          field,
          values: [
            { value: canonicalValue, sourceCandidateId: canonicalId },
            ...others.map((m) => ({ value: m[field]!.trim(), sourceCandidateId: m.id })),
          ],
        })
      }
      continue
    }
    const fill = members.find((m) => m[field]?.trim())
    if (fill?.[field]?.trim()) merged[field] = fill[field]!.trim()
  }

  return { merged, conflicts }
}

// ── Pair identity (§70) ────────────────────────────────────────────────────

export function pairIds(a: string, b: string): { candidateAId: string; candidateBId: string } {
  return a < b ? { candidateAId: a, candidateBId: b } : { candidateAId: b, candidateBId: a }
}

// ── Audit (§57) ────────────────────────────────────────────────────────────

export async function createAuditEvent(
  orgId: string,
  groupId: string,
  action: DuplicateAuditAction,
  actor?: { id?: string; name?: string },
  details?: unknown,
) {
  await prisma.duplicateAuditEvent.create({
    data: {
      organizationId: orgId,
      groupId,
      action,
      actorUserId: actor?.id,
      actorName: actor?.name,
      details: details as Prisma.InputJsonValue | undefined,
    },
  })
}

// ── Group creation (incremental engine entry) ─────────────────────────────

export interface GroupMemberInput {
  candidateId: string
  score?: number
  reasons?: string[]
}

export async function createResolutionGroup(
  orgId: string,
  entityType: EntityType,
  status: "PENDING_REVIEW" | "AUTO_MERGED",
  confidence: number,
  members: GroupMemberInput[],
) {
  const group = await prisma.$transaction(async (tx) => {
    const created = await tx.duplicateGroup.create({
      data: {
        organizationId: orgId,
        entityType,
        status,
        confidence,
        members: {
          create: members.map((m) => ({
            organizationId: orgId,
            candidateId: m.candidateId,
            matchScore: m.score,
            matchReasons: m.reasons as Prisma.InputJsonValue,
          })),
        },
      },
    })
    await tx.leadCandidate.updateMany({
      where: { organizationId: orgId, id: { in: members.map((m) => m.candidateId) }, status: CandidateStatus.EXTRACTED },
      data: { status: CandidateStatus.REVIEW },
    })
    return created
  })

  if (status === AUTO_MERGED) {
    await finalizeGroup(orgId, group.id, AUTO_MERGED)
  }

  return getDuplicateGroup(orgId, group.id)
}

// ── Finalize (confirm / auto-merge) ────────────────────────────────────────

// Shared transactional body for USER_CONFIRMED_DUPLICATE and AUTO_MERGED:
// picks the canonical candidate, merges fields, records conflicts, marks
// members, writes audit events (§71).
async function finalizeGroup(
  orgId: string,
  groupId: string,
  targetStatus: "CONFIRMED" | "AUTO_MERGED",
  actor?: { id?: string; name?: string },
) {
  return prisma.$transaction(async (tx) => {
    const group = await tx.duplicateGroup.findFirst({
      where: { id: groupId, organizationId: orgId },
      select: { id: true, status: true, entityType: true },
    })
    if (!group) throw new Error("Duplicate group not found")
    if (group.status !== PENDING_REVIEW && group.status !== AUTO_MERGED) {
      throw new Error("Group is not pending review")
    }

    const members = await tx.duplicateGroupMember.findMany({
      where: { duplicateGroupId: groupId },
      include: { candidate: { select: { ...CANDIDATE_MERGE_SELECT, rawPage: { select: { fetchedAt: true } }, status: true } } },
    })
    const candidates = members.map((m) => m.candidate)
    const canonical = pickCanonical(candidates)
    const { merged, conflicts } = mergeFields(canonical, candidates, canonical.id)

    await tx.duplicateGroup.update({
      where: { id: groupId },
      data: {
        status: targetStatus,
        canonicalCandidateId: canonical.id,
        mergedData: merged as unknown as Prisma.InputJsonValue,
        conflicts: (conflicts.length > 0 ? conflicts : Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
      },
    })

    for (const member of members) {
      const duplicate = member.candidate.id !== canonical.id
      await tx.leadCandidate.update({
        where: { id: member.candidate.id },
        data: { status: duplicate ? CandidateStatus.DUPLICATE : CandidateStatus.READY },
      })
    }

    const entityMatchIds = members
      .flatMap((a) =>
        members
          .filter((b) => b.candidate.id !== a.candidate.id)
          .map((b) => pairIds(a.candidate.id, b.candidate.id)),
      )
      .map((p) => ({ ...p, organizationId: orgId }))
    if (entityMatchIds.length > 0) {
      const or: Prisma.EntityMatchWhereInput[] = entityMatchIds.map((p) => ({
        organizationId: p.organizationId,
        candidateAId: p.candidateAId,
        candidateBId: p.candidateBId,
      }))
      await tx.entityMatch.updateMany({ where: { OR: or }, data: { status: MatchStatus.AUTO_MATCH } })
    }

    await tx.duplicateAuditEvent.create({
      data: {
        organizationId: orgId,
        groupId,
        action: targetStatus === AUTO_MERGED ? DuplicateAuditAction.AUTO_MERGED : DuplicateAuditAction.USER_CONFIRMED_DUPLICATE,
        actorUserId: actor?.id,
        actorName: actor?.name,
        details: {
          canonicalCandidateId: canonical.id,
          mergedFields: Object.keys(merged).length,
          conflicts: conflicts.length,
        },
      },
    })
    if (targetStatus === CONFIRMED) {
      await tx.duplicateAuditEvent.create({
        data: {
          organizationId: orgId,
          groupId,
          action: DuplicateAuditAction.CANONICAL_SELECTED,
          actorUserId: actor?.id,
          actorName: actor?.name,
          details: { canonicalCandidateId: canonical.id, completeness: calculateCompleteness(canonical) },
        },
      })
    }

    return getDuplicateGroup(orgId, groupId)
  })
}

const CANDIDATE_MERGE_SELECT = {
  id: true,
  companyName: true,
  companyDomain: true,
  websiteUrl: true,
  description: true,
  industry: true,
  country: true,
  region: true,
  city: true,
  contactFullName: true,
  contactJobTitle: true,
  email: true,
  phoneRaw: true,
  pageClassification: true,
  extractionConfidence: true,
  createdAt: true,
} as const

// ── User actions (§53-§54, §56) ────────────────────────────────────────────

export async function confirmDuplicateGroup(orgId: string, groupId: string, actor: { id?: string; name?: string }) {
  const result = await finalizeGroup(orgId, groupId, CONFIRMED, actor)
  return { ok: true as const, group: result }
}

// Rejected pairs must not re-appear (§56): mark the group REJECTED and all
// pairwise matches NOT_MATCH so future runs skip the comparison (§21).
export async function rejectDuplicateGroup(orgId: string, groupId: string, actor: { id?: string; name?: string }) {
  return prisma.$transaction(async (tx) => {
    const group = await tx.duplicateGroup.findFirst({ where: { id: groupId, organizationId: orgId } })
    if (!group) throw new Error("Duplicate group not found")
    const updated = await tx.duplicateGroup.updateMany({
      where: { id: groupId, organizationId: orgId, status: PENDING_REVIEW },
      data: { status: REJECTED },
    })
    if (updated.count === 0) throw new Error("Group is not pending review")

    const members = await tx.duplicateGroupMember.findMany({
      where: { duplicateGroupId: groupId },
      select: { candidateId: true },
    })
    await tx.leadCandidate.updateMany({
      where: { organizationId: orgId, id: { in: members.map((m) => m.candidateId) }, status: CandidateStatus.REVIEW },
      data: { status: CandidateStatus.EXTRACTED },
    })

    const pairs = []
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        pairs.push(pairIds(members[i].candidateId, members[j].candidateId))
      }
    }
    if (pairs.length > 0) {
      await tx.entityMatch.updateMany({
        where: {
          organizationId: orgId,
          OR: pairs.map((p) => ({ candidateAId: p.candidateAId, candidateBId: p.candidateBId })),
        },
        data: { status: MatchStatus.NOT_MATCH },
      })
    }

    await tx.duplicateAuditEvent.create({
      data: {
        organizationId: orgId,
        groupId,
        action: DuplicateAuditAction.USER_REJECTED_DUPLICATE,
        actorUserId: actor.id,
        actorName: actor.name,
        details: { candidateIds: members.map((m) => m.candidateId) },
      },
    })
  })
}

// ── Read paths ─────────────────────────────────────────────────────────────

const GROUP_INCLUDE = {
  members: {
    include: {
      candidate: {
        select: {
          id: true,
          status: true,
          companyName: true,
          companyDomain: true,
          websiteUrl: true,
          email: true,
          phoneRaw: true,
          linkedinUrl: true,
          contactFullName: true,
          contactJobTitle: true,
          pageClassification: true,
          extractionConfidence: true,
          createdAt: true,
          rawPage: { select: { id: true, url: true, fetchedAt: true } },
        },
      },
    },
  },
  auditEvents: { orderBy: { createdAt: "asc" as const } },
  canonicalCandidate: { select: { id: true, companyName: true, contactFullName: true, email: true, status: true } },
} as const

export interface DuplicateGroupFilters {
  page?: number | string | string[]
  pageSize?: number | string | string[]
  status?: string
  entityType?: string
}

export async function listDuplicateGroups(orgId: string, filters: DuplicateGroupFilters = {}) {
  const { page, pageSize } = parsePagination(filters)
  const where: Prisma.DuplicateGroupWhereInput = { { organizationId: orgId } }
  if (filters.status) where.status = filters.status as DuplicateGroupStatus
  if (filters.entityType) where.entityType = filters.entityType as EntityType
  const [total, data] = await Promise.all([
    prisma.duplicateGroup.count({ where }),
    prisma.duplicateGroup.findMany({ where, include: GROUP_INCLUDE, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ])
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function getDuplicateGroup(orgId: string, id: string) {
  return prisma.duplicateGroup.findFirst({ where: { id, { organizationId: orgId } }, include: GROUP_INCLUDE })
}

// ── Observability stats for the review dashboard (§73-§74) ────────────────

export async function resolutionStats(orgId: string) {
  const [totalCandidates, qualityBuckets, groups] = await Promise.all([
    prisma.leadCandidate.count({ where: { organizationId: orgId } }),
    prisma.leadCandidate.aggregate({
      where: { organizationId: orgId, dataQualityScore: { not: null } },
      _avg: { dataQualityScore: true },
    }),
    prisma.duplicateGroup.groupBy({
      by: ["status"],
      where: { organizationId: orgId },
      _count: { id: true },
    }),
  ])

  const high = await prisma.leadCandidate.count({
    where: { organizationId: orgId, dataQualityScore: { gte: 70 } },
  })
  const medium = await prisma.leadCandidate.count({
    where: { organizationId: orgId, dataQualityScore: { gte: 40, lt: 70 } },
  })
  const low = await prisma.leadCandidate.count({
    where: { organizationId: orgId, dataQualityScore: { lt: 40 } },
  })

  const byStatus = Object.fromEntries(groups.map((g) => [g.status, g._count.id]))
  return {
    totalCandidates,
    averageQuality: Math.round((qualityBuckets._avg.dataQualityScore ?? 0) * 10) / 10,
    highQuality: high,
    mediumQuality: medium,
    lowQuality: low,
    potentialDuplicates: byStatus[PENDING_REVIEW] ?? 0,
    autoResolved: byStatus[AUTO_MERGED] ?? 0,
    confirmed: byStatus[CONFIRMED] ?? 0,
    rejected: byStatus[REJECTED] ?? 0,
  }
}

