// TASK 019: AI account research (spec §1-§51). Produces a concise structured
// research summary of an existing company from existing company data, evidence
// and deterministic signals via AIProvider.generateStructured(). Purely
// interpretive: never writes factual CRM fields, never touches LeadScore,
// classifications or signals. One AI call per research run. Latest result only
// (upsert on companyId).

import { z } from "zod"
import { prisma } from "@/lib/db"
import { getActiveICP } from "@/lib/crm/icp"
import { humanize, type ICPCriteria } from "@/lib/crm/icp-shared"
import { getOrgAIProvider } from "@/lib/lead-engine/ai/settings"
import type { AIProvider } from "@/lib/lead-engine/ai/types"
import type {
  FieldEvidence,
  JobPosting,
} from "@/lib/lead-engine/extraction/types"
import { EnrichmentResultStatus } from "@/generated/prisma/enums"
import { RESEARCH_SYSTEM_PROMPT } from "@/lib/lead-engine/research/research-prompt"

export class ResearchError extends Error {
  readonly code: "COMPANY_NOT_FOUND" | "RESEARCH_FAILED"

  constructor(code: "COMPANY_NOT_FOUND" | "RESEARCH_FAILED", message: string) {
    super(message)
    this.name = "ResearchError"
    this.code = code
  }
}

export interface AccountResearchResult {
  companyId: string
  companySummary: string
  keyFacts: string[]
  relevantSignals: string[]
  researchInsights: string[]
  unknowns: string[]
  evidenceReferences: string[]
  model: string
  updatedAt: Date
}

type ResearchEvidenceSource = "COMPANY_PROFILE" | "ENRICHMENT" | "EXTRACTION"

export interface ResearchEvidenceItem {
  source: ResearchEvidenceSource
  text: string
}

const MAX_EVIDENCE_ITEMS = 20
const MAX_ENRICHMENT_EVIDENCE = 8
const MAX_EXTRACTION_EVIDENCE = 5
const MAX_JOBS_LISTED = 6
const MAX_DESCRIPTION_CHARS = 300

const referenceSchema = z
  .string()
  .trim()
  .regex(/^E\d+$/i, "Evidence references must look like E1, E2, ...")

export const accountResearchSchema = z.object({
  companySummary: z
    .string()
    .trim()
    .min(1)
    .max(800, "companySummary must be at most 800 characters"),
  keyFacts: z
    .array(z.string().trim().min(1).max(200))
    .max(16, "Provide at most 16 key facts"),
  relevantSignals: z
    .array(z.string().trim().min(1).max(200))
    .max(10, "Provide at most 10 signals"),
  researchInsights: z
    .array(z.string().trim().min(1).max(300))
    .max(8, "Provide at most 8 insights"),
  unknowns: z
    .array(z.string().trim().min(1).max(200))
    .max(10, "Provide at most 10 unknowns"),
  evidenceReferences: z.array(referenceSchema).max(25),
})

type ResearchDto = z.infer<typeof accountResearchSchema>
type ResearchPayload = Omit<AccountResearchResult, "updatedAt">

// ── Evidence assembly (deterministic, tenant-scoped) ─────────────────────

function profileEvidence(company: {
  name: string
  website: string | null
  domain: string | null
  description: string | null
  industry: string | null
  employeeCount: number | null
  employeeRange: string | null
  revenueRange: string | null
  country: string | null
  state: string | null
  city: string | null
}): ResearchEvidenceItem[] {
  const items: ResearchEvidenceItem[] = []
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
  return items
}

function jobEvidence(jobs: JobPosting[]): ResearchEvidenceItem[] {
  const open = jobs.filter((j) => j.title || j.hiringOrganization || j.location)
  if (open.length === 0) return []
  const titles = open
    .slice(0, MAX_JOBS_LISTED)
    .map((j) => j.title ?? "position")
    .join(", ")
  const item: ResearchEvidenceItem = {
    source: "EXTRACTION",
    text: `careers page lists ${open.length} open position${open.length === 1 ? "" : "s"}: ${titles}`,
  }
  return [item]
}

export async function loadEvidence(
  orgId: string,
  company: {
    id: string
    name: string
    website: string | null
    domain: string | null
    description: string | null
    industry: string | null
    employeeCount: number | null
    employeeRange: string | null
    revenueRange: string | null
    country: string | null
    state: string | null
    city: string | null
    sourceCandidateId: string | null
  },
): Promise<ResearchEvidenceItem[]> {
  const items: ResearchEvidenceItem[] = profileEvidence(company)
  const candidate = company.sourceCandidateId
    ? await prisma.leadCandidate.findFirst({
        where: { id: company.sourceCandidateId, organizationId: orgId },
      })
    : null

  // Company-level enrichment facts: confirmed results attached to this
  // company's leads (e.g. technology detection, descriptions).
  const enrichmentResults = await prisma.enrichmentResult.findMany({
    where: {
      organizationId: orgId,
      status: EnrichmentResultStatus.CONFIRMED,
      request: { lead: { companyId: company.id } },
    },
    orderBy: { observedAt: "desc" },
    take: MAX_ENRICHMENT_EVIDENCE,
  })

  const provenance =
    (candidate?.fieldProvenance as unknown as FieldEvidence[] | null) ?? []
  const jobs = (candidate?.jobs as unknown as JobPosting[] | null) ?? []

  for (const r of enrichmentResults) {
    items.push({
      source: "ENRICHMENT",
      text: `enrichment found ${r.field}: ${r.value}${r.evidence ? ` (${r.evidence})` : ""}`,
    })
  }
  for (const p of provenance.slice(0, MAX_EXTRACTION_EVIDENCE)) {
    items.push({
      source: "EXTRACTION",
      text: `extraction found ${p.field}: ${p.value}${p.sourceUrl ? ` at ${p.sourceUrl}` : ""} (${p.evidenceType})`,
    })
  }
  items.push(...jobEvidence(jobs))

  return items.slice(0, MAX_EVIDENCE_ITEMS)
}

// ── Context (informational only, never citable) ──────────────────────────

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
  if (criteria.employeeRange) {
    lines.push(
      `- Employee count: ${criteria.employeeRange.min ?? "?"} to ${criteria.employeeRange.max ?? "?"}`,
    )
  }
  if (criteria.technologies.length > 0)
    lines.push(`- Technologies: ${criteria.technologies.join(", ")}`)
  if (criteria.companyTypes.length > 0) {
    lines.push(
      `- Company types: ${criteria.companyTypes.map(humanize).join(", ")}`,
    )
  }
  if (criteria.signals.length > 0)
    lines.push(
      `- Signals of interest: ${criteria.signals.map(humanize).join(", ")}`,
    )
  return lines
}

async function loadContext(
  orgId: string,
  companyId: string,
): Promise<string[]> {
  const sections: string[] = []
  const icp = await getActiveICP(orgId)
  if (icp) {
    sections.push(
      `ACTIVE ICP CRITERIA (for relevance context only):\n${describeCriteria(icp.criteria).join("\n") || "- (no criteria)"}`,
    )
  }
  const classification = await prisma.leadClassification.findFirst({
    where: { organizationId: orgId, lead: { companyId } },
    orderBy: { updatedAt: "desc" },
  })
  if (classification) {
    sections.push(
      `LATEST AI CLASSIFICATION (informational only): ${classification.classification} (fit ${classification.fitScore}/100)`,
    )
  }
  return sections
}

// ── Prompt construction ──────────────────────────────────────────────────

function buildUserPrompt(
  companyName: string,
  items: ResearchEvidenceItem[],
  context: string[],
): string {
  const sections: string[] = []
  const evidence = items.map((item, i) => `E${i + 1}: ${item.text}`).join("\n")
  sections.push(`COMPANY: ${companyName}`)
  sections.push(
    `EVIDENCE (use these IDs when referencing evidence):\n${evidence}`,
  )
  if (context.length > 0) {
    sections.push(
      `CONTEXT (informational only, NOT evidence — do not reference it with an ID):\n${context.join("\n\n")}`,
    )
  }
  sections.push(
    "Research this account. Follow the rules in the system prompt exactly.",
  )
  return sections.join("\n\n")
}

// ── Normalization + persistence ──────────────────────────────────────────

function normalize(
  dto: ResearchDto,
  companyId: string,
  model: string,
  validReferenceIds: Set<string>,
): ResearchPayload {
  const dedupe = (values: string[]) => [...new Set(values)]
  return {
    companyId,
    companySummary: dto.companySummary.trim(),
    keyFacts: dedupe(dto.keyFacts),
    relevantSignals: dedupe(dto.relevantSignals),
    researchInsights: dedupe(dto.researchInsights),
    unknowns: dedupe(dto.unknowns),
    // Only references that match the evidence actually supplied survive;
    // model-generated identifiers are never trusted (spec §9).
    evidenceReferences: dedupe(
      dto.evidenceReferences.map((r) => r.toUpperCase()),
    ).filter((r) => validReferenceIds.has(r)),
    model,
  }
}

function insufficientResult(
  companyId: string,
  companyName: string,
): ResearchPayload {
  return {
    companyId,
    companySummary: `Very little information is available about ${companyName}. Only the company name is known; nothing else could be verified.`,
    keyFacts: [`Company name is ${companyName}`],
    relevantSignals: [],
    researchInsights: [],
    unknowns: [
      "Industry could not be verified",
      "Location could not be verified",
      "Employee count could not be verified",
      "Revenue could not be verified",
      "Technology stack could not be verified",
      "Funding information is not available",
    ],
    evidenceReferences: [],
    model: "",
  }
}

// ── Public API ───────────────────────────────────────────────────────────

export async function loadResearchEvidence(
  orgId: string,
  companyId: string,
): Promise<ResearchEvidenceItem[]> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: orgId },
    select: {
      id: true,
      name: true,
      website: true,
      domain: true,
      description: true,
      industry: true,
      employeeCount: true,
      employeeRange: true,
      revenueRange: true,
      country: true,
      state: true,
      city: true,
      sourceCandidateId: true,
    },
  })
  if (!company) return []
  return loadEvidence(orgId, company)
}

export async function researchAccount(
  orgId: string,
  companyId: string,
  options: { aiProvider?: AIProvider; model?: string } = {},
): Promise<AccountResearchResult> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: orgId },
  })
  if (!company)
    throw new ResearchError("COMPANY_NOT_FOUND", "Company not found")

  const items = await loadEvidence(orgId, company)

  // No usable evidence beyond the bare company name -> minimal result without
  // burning an AI call (spec §35): never fabricate a research summary from
  // nothing.
  if (items.length <= 1) {
    return persist(
      orgId,
      companyId,
      insufficientResult(companyId, company.name),
    )
  }

  const context = await loadContext(orgId, companyId)
  const { provider, model } = options.aiProvider
    ? { provider: options.aiProvider, model: options.model ?? process.env.AI_MODEL ?? "deepseek-chat" }
    : await getOrgAIProvider(orgId)
  const dto = await provider.generateStructured(
    {
      systemPrompt: RESEARCH_SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(company.name, items, context),
      temperature: 0,
      maxTokens: 1000,
      responseFormat: "json_object",
      model,
    },
    accountResearchSchema,
  )

  const validIds = new Set(items.map((_, i) => `E${i + 1}`))
  return persist(orgId, companyId, normalize(dto, companyId, model, validIds))
}

export async function getAccountResearch(
  orgId: string,
  companyId: string,
): Promise<AccountResearchResult | null> {
  const row = await prisma.accountResearch.findFirst({
    where: { organizationId: orgId, companyId },
  })
  if (!row) return null
  return {
    companyId: row.companyId,
    companySummary: row.companySummary,
    keyFacts: row.keyFacts as unknown as string[],
    relevantSignals: row.relevantSignals as unknown as string[],
    researchInsights: row.researchInsights as unknown as string[],
    unknowns: row.unknowns as unknown as string[],
    evidenceReferences: row.evidenceReferences as unknown as string[],
    model: row.model,
    updatedAt: row.updatedAt,
  }
}

async function persist(
  orgId: string,
  companyId: string,
  result: ResearchPayload,
): Promise<AccountResearchResult> {
  const data = {
    organizationId: orgId,
    companyId,
    companySummary: result.companySummary,
    keyFacts: result.keyFacts as unknown as object,
    relevantSignals: result.relevantSignals as unknown as object,
    researchInsights: result.researchInsights as unknown as object,
    unknowns: result.unknowns as unknown as object,
    evidenceReferences: result.evidenceReferences as unknown as object,
    model: result.model,
  }
  const row = await prisma.accountResearch.upsert({
    where: { companyId },
    create: data,
    update: data,
  })
  return { ...result, updatedAt: row.updatedAt }
}
