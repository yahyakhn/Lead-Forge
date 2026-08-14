// TASK 021: Lead intelligence profile (spec §1-§63). Read/review composition
// of existing intelligence for one lead: deterministic evidence, AI
// classification, account research, ICP context and observed hiring signals.
// Presentation layer only — pure reads, no AI calls, no writes, no
// rescoring/classification/research side effects.

import { prisma } from "@/lib/db"
import { getICP } from "@/lib/crm/icp"
import type { ICPCriteria } from "@/lib/crm/icp-shared"
import {
  getAccountResearch,
  loadResearchEvidence,
} from "@/lib/lead-engine/research/service"
import type {
  AccountResearchResult,
  ResearchEvidenceItem,
} from "@/lib/lead-engine/research/service"
import {
  loadEvidence,
  type EvidenceItem,
} from "@/lib/lead-engine/classification/service"
import type { LeadClassificationResult } from "@/lib/lead-engine/classification/service"
import type { JobPosting } from "@/lib/lead-engine/extraction/types"

export interface ClassificationView {
  result: LeadClassificationResult
  updatedAt: Date
}

export interface LeadIntelligence {
  leadId: string
  companyId: string | null
  icp: {
    id: string
    name: string
    description: string | null
    criteria: ICPCriteria
  } | null
  classification: ClassificationView | null
  research: AccountResearchResult | null
  evidence: EvidenceItem[]
  researchEvidence: ResearchEvidenceItem[]
  hiringSignals: JobPosting[]
}

export async function getLeadIntelligence(
  orgId: string,
  leadId: string,
): Promise<LeadIntelligence | null> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId: orgId },
    select: { id: true, companyId: true, sourceCandidateId: true },
  })
  if (!lead) return null

  const [row, research, evidence, score, candidate, researchEvidence] =
    await Promise.all([
      prisma.leadClassification.findFirst({
        where: { organizationId: orgId, leadId },
        orderBy: { updatedAt: "desc" },
      }),
      lead.companyId
        ? getAccountResearch(orgId, lead.companyId)
        : Promise.resolve(null),
      loadEvidence(orgId, leadId),
      prisma.leadScore.findFirst({
        where: { organizationId: orgId, leadId },
        orderBy: { scoredAt: "desc" },
        select: { icpProfileId: true },
      }),
      lead.sourceCandidateId
        ? prisma.leadCandidate.findFirst({
            where: { id: lead.sourceCandidateId, organizationId: orgId },
            select: { jobs: true },
          })
        : Promise.resolve(null),
      lead.companyId
        ? loadResearchEvidence(orgId, lead.companyId)
        : Promise.resolve([]),
    ])

  const icp = score?.icpProfileId
    ? await getICP(orgId, score.icpProfileId)
    : null

  return {
    leadId: lead.id,
    companyId: lead.companyId,
    icp: icp
      ? {
          id: icp.id,
          name: icp.name,
          description: icp.description,
          criteria: icp.criteria,
        }
      : null,
    classification: row
      ? {
          updatedAt: row.updatedAt,
          result: {
            leadId: row.leadId,
            icpId: row.icpId,
            classification: row.classification,
            fitScore: row.fitScore,
            reasons: (row.reasons as unknown as string[]) ?? [],
            concerns: (row.concerns as unknown as string[]) ?? [],
            matchedCriteria: (row.matchedCriteria as unknown as string[]) ?? [],
            unmatchedCriteria:
              (row.unmatchedCriteria as unknown as string[]) ?? [],
            evidenceReferences:
              (row.evidenceReferences as unknown as string[]) ?? [],
            model: row.model,
          },
        }
      : null,
    research,
    evidence,
    researchEvidence,
    hiringSignals: (candidate?.jobs as unknown as JobPosting[] | null) ?? [],
  }
}

// Resolve "E<n>" references against an evidence list. Malformed or
// out-of-range references resolve to `item: null` — rendered as unavailable,
// never trusted (spec §19, §35).
export interface ResolvedReference<T> {
  ref: string
  item: T | null
}

export function resolveReferences<T extends { text: string }>(
  refs: string[],
  items: T[],
): ResolvedReference<T>[] {
  const normalized = refs.map((raw) => {
    const match = /^E(\d+)$/i.exec(raw.trim())
    return match ? `E${match[1].toUpperCase()}` : raw.trim()
  })
  return [...new Set(normalized)].map((ref) => {
    const match = /^E(\d+)$/.exec(ref)
    if (!match) return { ref, item: null }
    const index = Number(match[1]) - 1
    return { ref, item: items[index] ?? null }
  })
}
