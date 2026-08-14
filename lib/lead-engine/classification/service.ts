// TASK 018: AI lead classification (spec §1-§45). Evaluates a lead against an
// ICP using existing evidence via AIProvider.generateStructured(). Purely
// interpretive: never writes into factual CRM fields and never mutates the
// deterministic scoring engine or its rows. One AI call per classification.

import { z } from "zod"
import { prisma } from "@/lib/db"
import { getICP } from "@/lib/crm/icp"
import { getLead } from "@/lib/crm/leads"
import { latestLeadScore } from "@/lib/lead-engine/scoring/service"
import { getAIProvider } from "@/lib/lead-engine/ai/registry"
import type { AIProvider } from "@/lib/lead-engine/ai/types"
import { humanize, rangeLabel, type ICPCriteria } from "@/lib/crm/icp-shared"
import type { FieldEvidence } from "@/lib/lead-engine/extraction/types"
import {
  ClassificationLabel,
  EnrichmentResultStatus,
} from "@/generated/prisma/enums"
import { CLASSIFICATION_SYSTEM_PROMPT } from "@/lib/lead-engine/classification/classification-prompt"

export const CLASSIFICATION_LABELS = [
  "HIGH_FIT",
  "MEDIUM_FIT",
  "LOW_FIT",
  "INSUFFICIENT_DATA",
] as const
export type ClassificationLabelName = (typeof CLASSIFICATION_LABELS)[number]

export class ClassificationError extends Error {
  readonly code: "LEAD_NOT_FOUND" | "ICP_NOT_FOUND" | "CLASSIFICATION_FAILED"

  constructor(
    code: "LEAD_NOT_FOUND" | "ICP_NOT_FOUND" | "CLASSIFICATION_FAILED",
    message: string,
  ) {
    super(message)
    this.name = "ClassificationError"
    this.code = code
  }
}

export interface LeadClassificationResult {
  leadId: string
  icpId: string
  classification: ClassificationLabelName
  fitScore: number
  reasons: string[]
  concerns: string[]
  matchedCriteria: string[]
  unmatchedCriteria: string[]
  evidenceReferences: string[]
  model: string
}

export type EvidenceSource =
  "COMPANY_PROFILE" | "CONTACT" | "ENRICHMENT" | "EXTRACTION"

export interface EvidenceItem {
  source: EvidenceSource
  text: string
}

const MAX_EVIDENCE_ITEMS = 16
const MAX_ENRICHMENT_EVIDENCE = 8
const MAX_EXTRACTION_EVIDENCE = 5
const MAX_DESCRIPTION_CHARS = 300

const referenceSchema = z
  .string()
  .trim()
  .regex(/^E\d+$/i, "Evidence references must look like E1, E2, ...")

export const classificationSchema = z.object({
  classification: z.enum(CLASSIFICATION_LABELS, {
    message:
      "classification must be HIGH_FIT, MEDIUM_FIT, LOW_FIT or INSUFFICIENT_DATA",
  }),
  fitScore: z
    .number({ message: "fitScore must be a number" })
    .refine((v) => v >= 0 && v <= 100, {
      message: "fitScore must be between 0 and 100",
    }),
  reasons: z
    .array(z.string().trim().min(1).max(300))
    .min(3, "Provide 3 to 7 reasons")
    .max(7, "Provide at most 7 reasons"),
  concerns: z
    .array(z.string().trim().min(1).max(300))
    .max(5, "Provide at most 5 concerns"),
  matchedCriteria: z.array(z.string().trim().min(1).max(200)).max(12),
  unmatchedCriteria: z.array(z.string().trim().min(1).max(200)).max(12),
  evidenceReferences: z.array(referenceSchema).max(25),
})

type ClassificationDto = z.infer<typeof classificationSchema>

// ── Evidence assembly (deterministic, tenant-scoped) ─────────────────────

export async function loadEvidence(
  orgId: string,
  leadId: string,
): Promise<EvidenceItem[]> {
  const items: EvidenceItem[] = []
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId: orgId },
    select: { companyId: true, contactId: true, sourceCandidateId: true },
  })
  if (!lead) return items

  const [company, contact, results, candidate] = await Promise.all([
    lead.companyId
      ? prisma.company.findFirst({
          where: { id: lead.companyId, organizationId: orgId },
        })
      : Promise.resolve(null),
    lead.contactId
      ? prisma.contact.findFirst({
          where: { id: lead.contactId, organizationId: orgId },
          select: { jobTitle: true },
        })
      : Promise.resolve(null),
    prisma.enrichmentResult.findMany({
      where: {
        organizationId: orgId,
        leadId,
        status: EnrichmentResultStatus.CONFIRMED,
      },
      orderBy: { observedAt: "desc" },
      take: MAX_ENRICHMENT_EVIDENCE,
    }),
    lead.sourceCandidateId
      ? prisma.leadCandidate.findFirst({
          where: { id: lead.sourceCandidateId, organizationId: orgId },
          select: { fieldProvenance: true },
        })
      : Promise.resolve(null),
  ])

  if (company) {
    if (company.name)
      items.push({
        source: "COMPANY_PROFILE",
        text: `company name is ${company.name}`,
      })
    if (company.website ?? company.domain) {
      items.push({
        source: "COMPANY_PROFILE",
        text: `website is ${company.website ?? company.domain}`,
      })
    }
    if (company.description) {
      items.push({
        source: "COMPANY_PROFILE",
        text: `description: ${company.description.slice(0, MAX_DESCRIPTION_CHARS)}`,
      })
    }
    if (company.industry)
      items.push({
        source: "COMPANY_PROFILE",
        text: `industry is ${company.industry}`,
      })
    if (company.employeeCount !== null && company.employeeCount !== undefined) {
      items.push({
        source: "COMPANY_PROFILE",
        text: `employee count is ${company.employeeCount}`,
      })
    } else if (company.employeeRange) {
      items.push({
        source: "COMPANY_PROFILE",
        text: `employee range is ${company.employeeRange}`,
      })
    }
    if (company.revenueRange)
      items.push({
        source: "COMPANY_PROFILE",
        text: `revenue range is ${company.revenueRange}`,
      })
    const location = [company.country, company.state, company.city]
      .filter(Boolean)
      .join(", ")
    if (location)
      items.push({ source: "COMPANY_PROFILE", text: `location is ${location}` })
  }

  if (contact?.jobTitle) {
    items.push({
      source: "CONTACT",
      text: `contact job title is ${contact.jobTitle}`,
    })
  }

  for (const r of results) {
    items.push({
      source: "ENRICHMENT",
      text: `enrichment found ${r.field}: ${r.value}${r.evidence ? ` (${r.evidence})` : ""}`,
    })
  }

  const provenance =
    (candidate?.fieldProvenance as unknown as FieldEvidence[] | null) ?? []
  for (const p of provenance.slice(0, MAX_EXTRACTION_EVIDENCE)) {
    items.push({
      source: "EXTRACTION",
      text: `extraction found ${p.field}: ${p.value}${p.sourceUrl ? ` at ${p.sourceUrl}` : ""} (${p.evidenceType})`,
    })
  }

  return items.slice(0, MAX_EVIDENCE_ITEMS)
}

// ── Prompt construction ──────────────────────────────────────────────────

function describeCriteria(criteria: ICPCriteria): string[] {
  const lines: string[] = []
  if (criteria.industries.length > 0)
    lines.push(`- Industries: ${criteria.industries.join(", ")}`)
  const locations = [
    ...criteria.countries,
    ...criteria.regions.map((r) => `${r} (region)`),
    ...criteria.cities.map((c) => `${c} (city)`),
  ]
  if (locations.length > 0) lines.push(`- Locations: ${locations.join(", ")}`)
  if (criteria.employeeRange)
    lines.push(`- Employee count: ${rangeLabel(criteria.employeeRange)}`)
  if (criteria.revenueRange) {
    lines.push(
      `- Revenue: ${rangeLabel(criteria.revenueRange)} ${criteria.revenueRange.currency ?? "USD"}`,
    )
  }
  if (criteria.technologies.length > 0)
    lines.push(`- Technologies: ${criteria.technologies.join(", ")}`)
  if (criteria.companyTypes.length > 0)
    lines.push(
      `- Company types: ${criteria.companyTypes.map(humanize).join(", ")}`,
    )
  if (criteria.signals.length > 0)
    lines.push(`- Signals: ${criteria.signals.map(humanize).join(", ")}`)
  if (criteria.companyAge)
    lines.push(`- Company age: ${rangeLabel(criteria.companyAge)} years`)
  const excluded: string[] = []
  if (criteria.exclusions.industries.length > 0)
    excluded.push(`industries ${criteria.exclusions.industries.join(", ")}`)
  if (criteria.exclusions.countries.length > 0)
    excluded.push(`locations ${criteria.exclusions.countries.join(", ")}`)
  if (criteria.exclusions.companyTypes.length > 0) {
    excluded.push(
      `company types ${criteria.exclusions.companyTypes.map(humanize).join(", ")}`,
    )
  }
  if (criteria.exclusions.keywords.length > 0)
    excluded.push(`keywords ${criteria.exclusions.keywords.join(", ")}`)
  if (excluded.length > 0) lines.push(`- EXCLUDE: ${excluded.join("; ")}`)
  return lines
}

function buildUserPrompt(
  criteria: ICPCriteria,
  items: EvidenceItem[],
  scoreContext: string | null,
): string {
  const sections: string[] = []
  sections.push(
    `ICP CRITERIA:\n${describeCriteria(criteria).join("\n") || "- (no criteria specified)"}`,
  )

  const evidence = items.map((item, i) => `E${i + 1}: ${item.text}`).join("\n")
  sections.push(
    `EVIDENCE (use these IDs when referencing evidence):\n${evidence}`,
  )

  if (scoreContext) {
    sections.push(
      `CONTEXT (informational only, NOT evidence — do not reference it with an ID):\n${scoreContext}`,
    )
  }

  sections.push(
    "Classify this lead against the ICP. Follow the rules in the system prompt exactly.",
  )
  return sections.join("\n\n")
}

// ── Normalization + persistence ──────────────────────────────────────────

function normalize(
  dto: ClassificationDto,
  leadId: string,
  icpId: string,
  model: string,
  validReferenceIds: Set<string>,
): LeadClassificationResult {
  const dedupe = (values: string[]) => [...new Set(values)]
  return {
    leadId,
    icpId,
    classification: dto.classification,
    fitScore: Math.min(100, Math.max(0, Math.round(dto.fitScore))),
    reasons: dedupe(dto.reasons),
    concerns: dedupe(dto.concerns),
    matchedCriteria: dedupe(dto.matchedCriteria),
    unmatchedCriteria: dedupe(dto.unmatchedCriteria),
    // Only references that match the evidence actually supplied survive;
    // model-generated identifiers are never trusted (spec §15).
    evidenceReferences: dedupe(
      dto.evidenceReferences.map((r) => r.toUpperCase()),
    ).filter((r) => validReferenceIds.has(r)),
    model,
  }
}

function insufficientResult(
  leadId: string,
  icpId: string,
): LeadClassificationResult {
  return {
    leadId,
    icpId,
    classification: "INSUFFICIENT_DATA",
    fitScore: 0,
    reasons: ["No usable evidence was found to classify this lead"],
    concerns: ["No usable evidence was found for this lead"],
    matchedCriteria: [],
    unmatchedCriteria: ["No ICP criteria could be evaluated"],
    evidenceReferences: [],
    model: "",
  }
}

// ── Public API ───────────────────────────────────────────────────────────

export async function classifyLead(
  orgId: string,
  leadId: string,
  icpId: string,
  options: { aiProvider?: AIProvider; model?: string } = {},
): Promise<LeadClassificationResult> {
  const [lead, icp, items] = await Promise.all([
    getLead(orgId, leadId),
    getICP(orgId, icpId),
    loadEvidence(orgId, leadId),
  ])
  if (!lead) throw new ClassificationError("LEAD_NOT_FOUND", "Lead not found")
  if (!icp) throw new ClassificationError("ICP_NOT_FOUND", "ICP not found")

  // No assessable evidence at all -> INSUFFICIENT_DATA without burning an AI
  // call (spec §25): prevents false confidence and costs.
  if (items.length === 0) {
    return persist(orgId, leadId, icpId, insufficientResult(leadId, icpId))
  }

  const latestScore = await latestLeadScore(orgId, leadId)
  const scoreContext = latestScore
    ? `deterministic score: icpScore ${latestScore.icpScore}, qualification ${latestScore.qualification}`
    : null

  const provider = options.aiProvider ?? getAIProvider()
  const model = options.model ?? process.env.AI_MODEL ?? "deepseek-chat"
  const dto = await provider.generateStructured(
    {
      systemPrompt: CLASSIFICATION_SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(icp.criteria, items, scoreContext),
      temperature: 0,
      maxTokens: 800,
      responseFormat: "json_object",
      model,
    },
    classificationSchema,
  )

  const validIds = new Set(items.map((_, i) => `E${i + 1}`))
  return persist(
    orgId,
    leadId,
    icpId,
    normalize(dto, leadId, icpId, model, validIds),
  )
}

async function persist(
  orgId: string,
  leadId: string,
  icpId: string,
  result: LeadClassificationResult,
) {
  const data = {
    organizationId: orgId,
    leadId,
    icpId,
    classification: result.classification as ClassificationLabel,
    fitScore: result.fitScore,
    reasons: result.reasons as unknown as object,
    concerns: result.concerns as unknown as object,
    matchedCriteria: result.matchedCriteria as unknown as object,
    unmatchedCriteria: result.unmatchedCriteria as unknown as object,
    evidenceReferences: result.evidenceReferences as unknown as object,
    model: result.model,
  }
  await prisma.leadClassification.upsert({
    where: {
      organizationId_leadId_icpId: { organizationId: orgId, leadId, icpId },
    },
    create: data,
    update: data,
  })
  return result
}
