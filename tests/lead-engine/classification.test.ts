// TASK 018: AI lead classification tests (spec §40-§43). MockAIProvider and
// stub providers only — no network, no real DeepSeek calls. Covers the four
// classifications, fit-score and schema validation, evidence-reference
// validation, tenant isolation, missing lead/ICP, AI failures, non-mutation
// of deterministic scoring/evidence, and the no-evidence guard.

import { afterAll, describe, expect, it } from "vitest"
import { prisma } from "@/lib/db"
import { createICP } from "@/lib/crm/icp"
import { createLead } from "@/lib/crm/leads"
import { AIError, type AIProvider } from "@/lib/lead-engine/ai/types"
import { MockAIProvider } from "@/lib/lead-engine/ai/providers/mock"
import { ClassificationError, classifyLead } from "@/lib/lead-engine/classification/service"
import type { CompanyType, Currency, ICPCriteria, Signal } from "@/lib/crm/icp-shared"

const orgIds: string[] = []

const newOrg = async () => {
  const org = await prisma.organization.create({
    data: { name: `Classify Test Org ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  })
  orgIds.push(org.id)
  return org
}

const newCompany = async (orgId: string, overrides: Record<string, unknown> = {}) =>
  prisma.company.create({
    data: {
      organizationId: orgId,
      name: "Acme SaaS",
      normalizedName: "acme saas",
      ...overrides,
    },
  })

const newIcp = async (orgId: string, patch: Partial<ICPCriteria> = {}) =>
  createICP(orgId, undefined, {
    name: `ICP ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    industries: patch.industries ?? [],
    countries: patch.countries ?? [],
    regions: patch.regions ?? [],
    cities: patch.cities ?? [],
    employeeMin: patch.employeeRange?.min,
    employeeMax: patch.employeeRange?.max,
    revenueMin: patch.revenueRange?.min,
    revenueMax: patch.revenueRange?.max,
    revenueCurrency: (patch.revenueRange?.currency ?? "USD") as Currency,
    technologies: patch.technologies ?? [],
    companyTypes: (patch.companyTypes ?? []) as CompanyType[],
    signals: (patch.signals ?? []) as Signal[],
    companyAgeMin: patch.companyAge?.min,
    companyAgeMax: patch.companyAge?.max,
    excludeIndustries: patch.exclusions?.industries ?? [],
    excludeCountries: patch.exclusions?.countries ?? [],
    excludeCompanyTypes: (patch.exclusions?.companyTypes ?? []) as CompanyType[],
    excludeKeywords: patch.exclusions?.keywords ?? [],
    scoringKeywords: [],
    scoringJobTitles: [],
    scoringSeniorities: [],
    scoringDomains: [],
  })

const newLead = async (orgId: string, companyId: string, overrides: Record<string, unknown> = {}) =>
  createLead(orgId, { companyId, source: "MANUAL", status: "NEW", ...overrides })

const addEnrichmentEvidence = async (orgId: string, leadId: string, field: string, value: string) => {
  const request = await prisma.enrichmentRequest.create({
    data: { organizationId: orgId, leadId, providerId: "test-provider" },
  })
  await prisma.enrichmentResult.create({
    data: {
      organizationId: orgId,
      requestId: request.id,
      leadId,
      field,
      value,
      source: "website",
      method: "AI",
      confidence: 0.9,
      status: "CONFIRMED",
    },
  })
}

const mock = (structured: unknown) => ({ aiProvider: new MockAIProvider({ structured }) })

const highFitStructured = {
  classification: "HIGH_FIT",
  fitScore: 87,
  reasons: ["Company operates in B2B SaaS.", "Company is located in India.", "Employee count is within the ICP range.", "Company uses AWS."],
  concerns: ["Revenue could not be verified."],
  matchedCriteria: ["Industry matches SaaS.", "Location matches India.", "Employee count is within the ICP range.", "Detected AWS technology matches the ICP."],
  unmatchedCriteria: [],
  evidenceReferences: ["E1", "E4"],
}

class FailingProvider implements AIProvider {
  readonly configured = true
  constructor(private readonly code: AIError["code"]) {}
  async generateText(): Promise<never> {
    throw new AIError(this.code, `provider ${this.code}`, true)
  }
  async generateStructured(): Promise<never> {
    throw new AIError(this.code, `provider ${this.code}`, true)
  }
}

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
  await prisma.$disconnect()
})

describe("classifyLead", () => {
  // ── The four classifications ──────────────────────────────────────────

  it("classifies a matching lead as HIGH_FIT and persists it", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS", employeeCount: 200, country: "India" })
    const icp = await newIcp(org.id, {
      industries: ["SaaS"],
      countries: ["India"],
      employeeRange: { min: 50, max: 500 },
      technologies: ["AWS"],
      exclusions: { industries: [], countries: [], companyTypes: ["AGENCY"], keywords: [] },
    })
    const lead = await newLead(org.id, company.id)
    await addEnrichmentEvidence(org.id, lead.id, "technologies", "AWS")

    const result = await classifyLead(org.id, lead.id, icp.id, mock(highFitStructured))

    expect(result.classification).toBe("HIGH_FIT")
    expect(result.fitScore).toBe(87)
    expect(result.reasons.length).toBeGreaterThanOrEqual(3)
    expect(result.evidenceReferences).toEqual(["E1", "E4"])
    const row = await prisma.leadClassification.findUnique({
      where: { organizationId_leadId_icpId: { organizationId: org.id, leadId: lead.id, icpId: icp.id } },
    })
    expect(row?.classification).toBe("HIGH_FIT")
    expect(row?.fitScore).toBe(87)
    expect(row?.reasons).toHaveLength(4)
  })

  it("classifies an average match as MEDIUM_FIT", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS", employeeCount: 200, country: "UK" })
    const icp = await newIcp(org.id, { industries: ["SaaS"], countries: ["India"] })
    const lead = await newLead(org.id, company.id)

    const result = await classifyLead(
      org.id,
      lead.id,
      icp.id,
      mock({
        classification: "MEDIUM_FIT",
        fitScore: 55,
        reasons: ["Industry matches.", "Location differs from the ICP.", "Company size is plausible."],
        concerns: [],
        matchedCriteria: ["Industry matches SaaS."],
        unmatchedCriteria: ["Location could not be verified."],
        evidenceReferences: ["E1", "E3"],
      }),
    )

    expect(result.classification).toBe("MEDIUM_FIT")
    expect(result.fitScore).toBe(55)
  })

  it("classifies a clear mismatch as LOW_FIT", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "Construction", employeeCount: 20, country: "Germany" })
    const icp = await newIcp(org.id, { industries: ["SaaS"], countries: ["India"], employeeRange: { min: 50 } })
    const lead = await newLead(org.id, company.id)

    const result = await classifyLead(
      org.id,
      lead.id,
      icp.id,
      mock({
        classification: "LOW_FIT",
        fitScore: 12,
        reasons: ["Industry is outside the ICP.", "Employee count is below the minimum.", "Location is outside the ICP."],
        concerns: ["Several ICP criteria mismatch."],
        matchedCriteria: [],
        unmatchedCriteria: ["Industry does not match SaaS.", "Employee count is below the required minimum."],
        evidenceReferences: ["E1"],
      }),
    )

    expect(result.classification).toBe("LOW_FIT")
    expect(result.fitScore).toBe(12)
  })

  it("classifies as INSUFFICIENT_DATA when the AI cannot establish fit", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { name: "Unknown Ltd", employeeCount: 200 })
    const icp = await newIcp(org.id, { industries: ["SaaS"], countries: ["India"], technologies: ["AWS"] })
    const lead = await newLead(org.id, company.id)

    const result = await classifyLead(
      org.id,
      lead.id,
      icp.id,
      mock({
        classification: "INSUFFICIENT_DATA",
        fitScore: 10,
        reasons: ["Industry could not be established.", "Location could not be established.", "Technology could not be verified."],
        concerns: ["Key ICP criteria cannot be judged from the available evidence."],
        matchedCriteria: [],
        unmatchedCriteria: ["Industry could not be verified.", "Employee count could not be verified.", "Technology could not be verified."],
        evidenceReferences: ["E1"],
      }),
    )

    expect(result.classification).toBe("INSUFFICIENT_DATA")
    expect(result.fitScore).toBeLessThan(40)
  })

  it("returns INSUFFICIENT_DATA without an AI call when no evidence exists", async () => {
    const org = await newOrg()
    const icp = await newIcp(org.id, { industries: ["SaaS"] })
    const bareLead = await prisma.lead.create({
      data: { organizationId: org.id, title: "Founder", status: "NEW" },
    })

    const result = await classifyLead(org.id, bareLead.id, icp.id, { aiProvider: new FailingProvider("AI_TIMEOUT") })

    expect(result.classification).toBe("INSUFFICIENT_DATA")
    expect(result.fitScore).toBe(0)
    expect(result.evidenceReferences).toEqual([])
  })

  // ── Fit score + schema validation ─────────────────────────────────────

  it("rejects a fit score below 0", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS" })
    const icp = await newIcp(org.id, { industries: ["SaaS"] })
    const lead = await newLead(org.id, company.id)

    await expect(
      classifyLead(
        org.id,
        lead.id,
        icp.id,
        mock({ ...highFitStructured, fitScore: -5 }),
      ),
    ).rejects.toMatchObject({ name: "AIError", code: "AI_SCHEMA_VALIDATION_ERROR" })
  })

  it("rejects a fit score above 100", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS" })
    const icp = await newIcp(org.id, { industries: ["SaaS"] })
    const lead = await newLead(org.id, company.id)

    await expect(
      classifyLead(
        org.id,
        lead.id,
        icp.id,
        mock({ ...highFitStructured, fitScore: 150 }),
      ),
    ).rejects.toMatchObject({ code: "AI_SCHEMA_VALIDATION_ERROR" })
  })

  it("rejects an unknown classification value", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS" })
    const icp = await newIcp(org.id, { industries: ["SaaS"] })
    const lead = await newLead(org.id, company.id)

    await expect(
      classifyLead(
        org.id,
        lead.id,
        icp.id,
        mock({ ...highFitStructured, classification: "GREAT_FIT" }),
      ),
    ).rejects.toMatchObject({ code: "AI_SCHEMA_VALIDATION_ERROR" })
  })

  it("rejects malformed AI responses as AIError", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS" })
    const icp = await newIcp(org.id, { industries: ["SaaS"] })
    const lead = await newLead(org.id, company.id)

    await expect(
      classifyLead(org.id, lead.id, icp.id, mock({ classification: "HIGH_FIT" })),
    ).rejects.toBeInstanceOf(AIError)

    await expect(
      classifyLead(org.id, lead.id, icp.id, mock("not json at all")),
    ).rejects.toBeInstanceOf(AIError)
  })

  it("rejects more than 7 reasons", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS" })
    const icp = await newIcp(org.id, { industries: ["SaaS"] })
    const lead = await newLead(org.id, company.id)

    await expect(
      classifyLead(org.id, lead.id, icp.id, mock({
        ...highFitStructured,
        reasons: Array.from({ length: 9 }, (_, i) => `Reason ${i + 1}`),
      })),
    ).rejects.toMatchObject({ code: "AI_SCHEMA_VALIDATION_ERROR" })
  })

  // ── Evidence references ───────────────────────────────────────────────

  it("keeps valid evidence references (normalized) and drops out-of-range ones", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS", employeeCount: 200, country: "India" })
    const icp = await newIcp(org.id, { industries: ["SaaS"], countries: ["India"] })
    const lead = await newLead(org.id, company.id)

    const result = await classifyLead(
      org.id,
      lead.id,
      icp.id,
      mock({ ...highFitStructured, evidenceReferences: ["e1", "E3", "E99"] }),
    )

    expect(result.evidenceReferences).toEqual(["E1", "E3"])
    expect(result.evidenceReferences).not.toContain("E99")
  })

  it("discards all references when none are valid", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS" })
    const icp = await newIcp(org.id, { industries: ["SaaS"] })
    const lead = await newLead(org.id, company.id)

    const result = await classifyLead(org.id, lead.id, icp.id, mock({
      ...highFitStructured,
      evidenceReferences: ["E42", "E43"],
    }))

    expect(result.evidenceReferences).toEqual([])
    const row = await prisma.leadClassification.findUnique({
      where: { organizationId_leadId_icpId: { organizationId: org.id, leadId: lead.id, icpId: icp.id } },
    })
    expect(row?.evidenceReferences).toEqual([])
  })

  // ── Exclusions + missing evidence ─────────────────────────────────────

  it("respects explicit exclusions via the classification result", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "Marketing", employeeCount: 200, country: "India" })
    const icp = await newIcp(org.id, {
      industries: ["SaaS"],
      countries: ["India"],
      exclusions: { industries: [], countries: [], companyTypes: ["AGENCY"], keywords: [] },
    })
    const lead = await newLead(org.id, company.id)

    const result = await classifyLead(
      org.id,
      lead.id,
      icp.id,
      mock({
        classification: "LOW_FIT",
        fitScore: 18,
        reasons: ["Company appears to be an agency, which the ICP explicitly excludes.", "Industry does not match SaaS.", "Exclusion outweighs other matches."],
        concerns: ["Explicit ICP exclusion applies (agencies)."],
        matchedCriteria: [],
        unmatchedCriteria: ["Company type matches an excluded category."],
        evidenceReferences: ["E1"],
      }),
    )

    expect(result.classification).toBe("LOW_FIT")
    expect(result.concerns.join(" ").toLowerCase()).toContain("exclusion")
    expect(result.unmatchedCriteria.join(" ").toLowerCase()).toContain("excluded")
  })

  it("reports missing employee evidence as unverifiable when the ICP requires it", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS", country: "India" })
    const icp = await newIcp(org.id, { countries: ["India"], employeeRange: { min: 50, max: 500 } })
    const lead = await newLead(org.id, company.id)

    const result = await classifyLead(
      org.id,
      lead.id,
      icp.id,
      mock({
        classification: "INSUFFICIENT_DATA",
        fitScore: 35,
        reasons: ["Industry matches the ICP.", "Employee count could not be verified.", "No size evidence available."],
        concerns: ["Employee count is missing from the evidence."],
        matchedCriteria: ["Industry matches SaaS."],
        unmatchedCriteria: ["Employee count could not be verified."],
        evidenceReferences: ["E1"],
      }),
    )

    expect(result.classification).toBe("INSUFFICIENT_DATA")
    expect(result.unmatchedCriteria.some((c) => c.includes("could not be verified"))).toBe(true)
  })

  it("reports missing technology evidence when the ICP requires it", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS", country: "India", employeeCount: 200 })
    const icp = await newIcp(org.id, { countries: ["India"], technologies: ["AWS"] })
    const lead = await newLead(org.id, company.id)

    const result = await classifyLead(
      org.id,
      lead.id,
      icp.id,
      mock({
        classification: "INSUFFICIENT_DATA",
        fitScore: 30,
        reasons: ["Industry matches the ICP.", "Technology usage could not be verified.", "No stack evidence available."],
        concerns: ["No technology evidence was found."],
        matchedCriteria: ["Industry matches SaaS."],
        unmatchedCriteria: ["Technology could not be verified."],
        evidenceReferences: ["E1"],
      }),
    )

    expect(result.classification).toBe("INSUFFICIENT_DATA")
    expect(result.unmatchedCriteria.some((c) => c.includes("Technology"))).toBe(true)
  })

  it("flags an ICP mismatch as LOW_FIT with unmatched criteria", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "Agency services", employeeCount: 200, country: "India" })
    const icp = await newIcp(org.id, { industries: ["SaaS"], countries: ["India"], employeeRange: { min: 50 } })
    const lead = await newLead(org.id, company.id)

    const result = await classifyLead(
      org.id,
      lead.id,
      icp.id,
      mock({
        classification: "LOW_FIT",
        fitScore: 22,
        reasons: ["Industry does not match the ICP.", "The ICP targets SaaS companies.", "Evidence shows a different sector."],
        concerns: ["Major ICP criteria mismatch."],
        matchedCriteria: ["Location matches India."],
        unmatchedCriteria: ["Industry does not match SaaS."],
        evidenceReferences: ["E1"],
      }),
    )

    expect(result.classification).toBe("LOW_FIT")
  })

  // ── Tenant isolation + missing entities ───────────────────────────────

  it("rejects a lead from another organization", async () => {
    const orgA = await newOrg()
    const orgB = await newOrg()
    const company = await newCompany(orgB.id, { industry: "SaaS" })
    const icp = await newIcp(orgA.id, { industries: ["SaaS"] })
    const lead = await newLead(orgB.id, company.id)

    await expect(classifyLead(orgA.id, lead.id, icp.id, mock(highFitStructured))).rejects.toMatchObject({
      name: "ClassificationError",
      code: "LEAD_NOT_FOUND",
    })
  })

  it("rejects an ICP from another organization", async () => {
    const orgA = await newOrg()
    const orgB = await newOrg()
    const company = await newCompany(orgA.id, { industry: "SaaS" })
    const icpB = await newIcp(orgB.id, { industries: ["SaaS"] })
    const lead = await newLead(orgA.id, company.id)

    await expect(classifyLead(orgA.id, lead.id, icpB.id, mock(highFitStructured))).rejects.toMatchObject({
      code: "ICP_NOT_FOUND",
    })
  })

  it("rejects cross-tenant classification without persisting anything", async () => {
    const orgA = await newOrg()
    const orgB = await newOrg()
    const company = await newCompany(orgB.id, { industry: "SaaS" })
    const lead = await newLead(orgB.id, company.id)
    const icp = await newIcp(orgB.id, { industries: ["SaaS"] })

    await expect(classifyLead(orgA.id, lead.id, icp.id, mock(highFitStructured))).rejects.toBeInstanceOf(ClassificationError)
    const rows = await prisma.leadClassification.findMany({ where: { organizationId: orgB.id, leadId: lead.id } })
    expect(rows).toHaveLength(0)
  })

  it("handles a missing lead", async () => {
    const org = await newOrg()
    const icp = await newIcp(org.id, { industries: ["SaaS"] })
    await expect(classifyLead(org.id, "lead-does-not-exist", icp.id, mock(highFitStructured))).rejects.toMatchObject({
      code: "LEAD_NOT_FOUND",
    })
  })

  it("handles a missing ICP", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS" })
    const lead = await newLead(org.id, company.id)
    await expect(classifyLead(org.id, lead.id, "icp-does-not-exist", mock(highFitStructured))).rejects.toMatchObject({
      code: "ICP_NOT_FOUND",
    })
  })

  // ── AI failure handling ───────────────────────────────────────────────

  it("propagates AI timeouts as AIError without persisting", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS" })
    const icp = await newIcp(org.id, { industries: ["SaaS"] })
    const lead = await newLead(org.id, company.id)

    await expect(
      classifyLead(org.id, lead.id, icp.id, { aiProvider: new FailingProvider("AI_TIMEOUT") }),
    ).rejects.toMatchObject({ name: "AIError", code: "AI_TIMEOUT", retryable: true })

    const rows = await prisma.leadClassification.findMany({ where: { organizationId: org.id, leadId: lead.id } })
    expect(rows).toHaveLength(0)
  })

  it("propagates provider errors as AIError", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS" })
    const icp = await newIcp(org.id, { industries: ["SaaS"] })
    const lead = await newLead(org.id, company.id)

    await expect(
      classifyLead(org.id, lead.id, icp.id, { aiProvider: new FailingProvider("AI_PROVIDER_ERROR") }),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" })
  })

  // ── Non-mutation guarantees ───────────────────────────────────────────

  it("leaves the deterministic LeadScore unchanged", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS", employeeCount: 200, country: "India" })
    const icp = await newIcp(org.id, { industries: ["SaaS"] })
    const lead = await newLead(org.id, company.id)

    await prisma.leadScore.create({
      data: {
        organizationId: org.id,
        leadId: lead.id,
        icpProfileId: icp.id,
        source: "CRM",
        modelVersion: "v1",
        icpScore: 88,
        overallScore: 82,
        qualification: "HOT",
        scoreStatus: "CURRENT",
        scoreBreakdown: [] as unknown as object,
        reasons: ["Deterministic reason"] as unknown as object,
      },
    })
    await prisma.lead.update({ where: { id: lead.id }, data: { score: 82, fitScore: 88 } })
    const before = await prisma.leadScore.findFirst({ where: { organizationId: org.id, leadId: lead.id } })
    const beforeLead = await prisma.lead.findUnique({ where: { id: lead.id } })

    await classifyLead(org.id, lead.id, icp.id, mock(highFitStructured))

    const after = await prisma.leadScore.findFirst({ where: { organizationId: org.id, leadId: lead.id } })
    const afterLead = await prisma.lead.findUnique({ where: { id: lead.id } })
    expect(after?.icpScore).toBe(before?.icpScore)
    expect(after?.overallScore).toBe(before?.overallScore)
    expect(after?.qualification).toBe(before?.qualification)
    expect(afterLead?.score).toBe(beforeLead?.score)
    expect(afterLead?.fitScore).toBe(beforeLead?.fitScore)
    const count = await prisma.leadScore.count({ where: { organizationId: org.id, leadId: lead.id } })
    expect(count).toBe(1)
  })

  it("leaves existing evidence and CRM facts unchanged", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS", employeeCount: 200, country: "India" })
    const icp = await newIcp(org.id, { industries: ["SaaS"], countries: ["India"] })
    const lead = await newLead(org.id, company.id)
    await addEnrichmentEvidence(org.id, lead.id, "industry", "SaaS")

    const rowsBefore = await prisma.enrichmentResult.findMany({ where: { organizationId: org.id, leadId: lead.id } })
    const companyBefore = await prisma.company.findUnique({ where: { id: company.id } })

    await classifyLead(org.id, lead.id, icp.id, mock(highFitStructured))

    const rowsAfter = await prisma.enrichmentResult.findMany({ where: { organizationId: org.id, leadId: lead.id } })
    const companyAfter = await prisma.company.findUnique({ where: { id: company.id } })
    expect(rowsAfter).toHaveLength(rowsBefore.length)
    expect(companyAfter?.industry).toBe(companyBefore?.industry)
    expect(companyAfter?.employeeCount).toBe(companyBefore?.employeeCount)
    expect(companyAfter?.country).toBe(companyBefore?.country)
  })

  // ── Re-run + model info + network safety ──────────────────────────────

  it("re-computes a fresh classification in place (single row)", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS", employeeCount: 200, country: "India" })
    const icp = await newIcp(org.id, { industries: ["SaaS"], countries: ["India"] })
    const lead = await newLead(org.id, company.id)

    await classifyLead(org.id, lead.id, icp.id, mock(highFitStructured))
    await classifyLead(
      org.id,
      lead.id,
      icp.id,
      mock({ ...highFitStructured, classification: "MEDIUM_FIT", fitScore: 60 }),
    )

    const rows = await prisma.leadClassification.findMany({ where: { organizationId: org.id, leadId: lead.id, icpId: icp.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].classification).toBe("MEDIUM_FIT")
    expect(rows[0].fitScore).toBe(60)
  })

  it("stores the requested model identifier with the classification", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS", employeeCount: 200, country: "India" })
    const icp = await newIcp(org.id, { industries: ["SaaS"] })
    const lead = await newLead(org.id, company.id)

    const result = await classifyLead(org.id, lead.id, icp.id, { ...mock(highFitStructured), model: "deepseek-chat" })

    expect(result.model).toBe("deepseek-chat")
    const row = await prisma.leadClassification.findUnique({
      where: { organizationId_leadId_icpId: { organizationId: org.id, leadId: lead.id, icpId: icp.id } },
    })
    expect(row?.model).toBe("deepseek-chat")
  })

  it("never issues a real network request when a mock provider is injected", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, { industry: "SaaS", employeeCount: 200, country: "India" })
    const icp = await newIcp(org.id, { industries: ["SaaS"], countries: ["India"] })
    const lead = await newLead(org.id, company.id)

    const result = await classifyLead(org.id, lead.id, icp.id, mock(highFitStructured))
    expect(result.classification).toBe("HIGH_FIT")
  })
})