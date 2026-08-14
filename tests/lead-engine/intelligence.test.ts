// TASK 021: lead intelligence profile tests (spec §55). Read/review profile
// composition: deterministic evidence, AI classification, account research,
// ICP context, hiring signals, reference resolution, tenant isolation, and
// the no-AI / no-write / no-rescore guarantees on load. Seeded directly via
// prisma — no network, no real AI providers.

import { afterAll, describe, expect, it } from "vitest"
import { prisma } from "@/lib/db"
import { createICP } from "@/lib/crm/icp"
import { createLead } from "@/lib/crm/leads"
import {
  getLeadIntelligence,
  resolveReferences,
} from "@/lib/lead-engine/intelligence/service"
import type {
  CompanyType,
  Currency,
  ICPCriteria,
  Signal,
} from "@/lib/crm/icp-shared"

const orgIds: string[] = []

const newOrg = async () => {
  const org = await prisma.organization.create({
    data: {
      name: `Intelligence Test Org ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    },
  })
  orgIds.push(org.id)
  return org
}

const newCompany = async (
  orgId: string,
  overrides: Record<string, unknown> = {},
) =>
  prisma.company.create({
    data: {
      organizationId: orgId,
      name: "Acme SaaS",
      normalizedName: "acme saas",
      website: "https://acme.example",
      domain: "acme.example",
      description: "B2B SaaS platform",
      industry: "SaaS",
      country: "India",
      state: "KA",
      city: "Bengaluru",
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
    excludeCompanyTypes: (patch.exclusions?.companyTypes ??
      []) as CompanyType[],
    excludeKeywords: patch.exclusions?.keywords ?? [],
    scoringKeywords: [],
    scoringJobTitles: [],
    scoringSeniorities: [],
    scoringDomains: [],
  })

const newLead = async (
  orgId: string,
  companyId: string,
  overrides: Record<string, unknown> = {},
) =>
  createLead(orgId, {
    companyId,
    source: "MANUAL",
    status: "NEW",
    ...overrides,
  })

// Full candidate chain (source → run → raw page → candidate) so provenance,
// extraction evidence and jobs can be seeded.
const newCandidate = async (
  orgId: string,
  data: { jobs?: unknown[]; fieldProvenance?: unknown[] },
) => {
  const source = await prisma.leadSource.create({
    data: {
      organizationId: orgId,
      name: "test-source",
      slug: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: "CUSTOM",
      config: {},
    },
  })
  const run = await prisma.scraperRun.create({
    data: { organizationId: orgId, sourceId: source.id },
  })
  const page = await prisma.rawPage.create({
    data: {
      organizationId: orgId,
      runId: run.id,
      sourceId: source.id,
      url: `https://${Math.random().toString(36).slice(2)}.example`,
    },
  })
  return prisma.leadCandidate.create({
    data: {
      organizationId: orgId,
      runId: run.id,
      sourceId: source.id,
      rawPageId: page.id,
      companyName: "Acme SaaS",
      jobs: (data.jobs ?? []) as unknown as object,
      fieldProvenance: (data.fieldProvenance ?? []) as unknown as object,
    },
  })
}

const addEnrichment = async (
  orgId: string,
  leadId: string,
  field: string,
  value: string,
  status: string = "CONFIRMED",
) => {
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
      status: status as never,
    },
  })
}

const seedClassification = async (
  orgId: string,
  leadId: string,
  icpId: string,
  overrides: Record<string, unknown> = {},
) =>
  prisma.leadClassification.create({
    data: {
      organizationId: orgId,
      leadId,
      icpId,
      classification: "HIGH_FIT",
      fitScore: 87,
      reasons: ["B2B SaaS fits"],
      concerns: [],
      matchedCriteria: ["Industry"],
      unmatchedCriteria: ["Region"],
      evidenceReferences: ["E1", "E3"],
      model: "test-model",
      ...overrides,
    },
  })

const seedResearch = async (
  orgId: string,
  companyId: string,
  overrides: Record<string, unknown> = {},
) =>
  prisma.accountResearch.create({
    data: {
      organizationId: orgId,
      companyId,
      companySummary: "Acme is a B2B SaaS company.",
      keyFacts: ["Company name is Acme SaaS"],
      relevantSignals: ["Hiring engineers"],
      researchInsights: ["Expanding sales team"],
      unknowns: ["Revenue unknown"],
      evidenceReferences: ["E1"],
      model: "test-model",
      ...overrides,
    },
  })

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
  await prisma.$disconnect()
})

describe("getLeadIntelligence", () => {
  it("returns null for a missing lead", async () => {
    const org = await newOrg()
    expect(await getLeadIntelligence(org.id, "missing-id")).toBeNull()
  })

  it("never returns another org's lead (tenant isolation)", async () => {
    const orgA = await newOrg()
    const orgB = await newOrg()
    const company = await newCompany(orgB.id)
    const lead = await newLead(orgB.id, company.id)
    expect(await getLeadIntelligence(orgA.id, lead.id)).toBeNull()
  })

  it("returns empty sections for a lead with no intelligence data", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id, {
      website: null,
      domain: null,
      description: null,
      industry: null,
      country: null,
      state: null,
      city: null,
    })
    const lead = await newLead(org.id, company.id)
    const result = await getLeadIntelligence(org.id, lead.id)
    expect(result).not.toBeNull()
    expect(result!.classification).toBeNull()
    expect(result!.research).toBeNull()
    expect(result!.icp).toBeNull()
    expect(result!.evidence).toEqual([
      { source: "COMPANY_PROFILE", text: "company name is Acme SaaS" },
    ])
    expect(result!.researchEvidence).toEqual([
      { source: "COMPANY_PROFILE", text: "company name is Acme SaaS" },
    ])
    expect(result!.hiringSignals).toEqual([])
    expect(result!.companyId).toBe(company.id)
  })

  it("loads the lead with zero side effects (no writes at all)", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id)
    const lead = await newLead(org.id, company.id)
    const counts = await Promise.all([
      prisma.leadScore.count({ where: { organizationId: org.id } }),
      prisma.leadClassification.count({ where: { organizationId: org.id } }),
      prisma.accountResearch.count({ where: { organizationId: org.id } }),
      prisma.activity.count({ where: { organizationId: org.id } }),
      prisma.enrichmentRequest.count({ where: { organizationId: org.id } }),
      prisma.communication.count({ where: { organizationId: org.id } }),
    ])
    await getLeadIntelligence(org.id, lead.id)
    const after = await Promise.all([
      prisma.leadScore.count({ where: { organizationId: org.id } }),
      prisma.leadClassification.count({ where: { organizationId: org.id } }),
      prisma.accountResearch.count({ where: { organizationId: org.id } }),
      prisma.activity.count({ where: { organizationId: org.id } }),
      prisma.enrichmentRequest.count({ where: { organizationId: org.id } }),
      prisma.communication.count({ where: { organizationId: org.id } }),
    ])
    expect(after).toEqual(counts)
  })

  it("builds COMPANY_PROFILE evidence from the company row in deterministic order", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id)
    const lead = await newLead(org.id, company.id)
    const { evidence } = (await getLeadIntelligence(org.id, lead.id))!
    expect(evidence[0]).toEqual({
      source: "COMPANY_PROFILE",
      text: "company name is Acme SaaS",
    })
    expect(
      evidence.some(
        (e) =>
          e.source === "COMPANY_PROFILE" && e.text.includes("industry is SaaS"),
      ),
    ).toBe(true)
    expect(
      evidence.some(
        (e) =>
          e.source === "COMPANY_PROFILE" &&
          e.text.includes("location is India, KA, Bengaluru"),
      ),
    ).toBe(true)
    const sources = evidence.map((e) => e.source)
    expect(sources).toEqual(
      [...sources].sort((a, b) => SOURCE_ORDER[a] - SOURCE_ORDER[b]),
    )
  })

  it("adds a CONTACT evidence item from the contact job title", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id)
    const contact = await prisma.contact.create({
      data: {
        organizationId: org.id,
        companyId: company.id,
        fullName: "Jane Doe",
        firstName: "Jane",
        lastName: "Doe",
        jobTitle: "Head of Sales",
      },
    })
    const lead = await newLead(org.id, company.id, { contactId: contact.id })
    const { evidence } = (await getLeadIntelligence(org.id, lead.id))!
    expect(
      evidence.some(
        (e) => e.source === "CONTACT" && e.text.includes("Head of Sales"),
      ),
    ).toBe(true)
  })

  it("includes only CONFIRMED enrichment results as evidence", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id)
    const lead = await newLead(org.id, company.id)
    await addEnrichment(org.id, lead.id, "technologies", "React")
    await addEnrichment(org.id, lead.id, "description", "stale", "STALE")
    await addEnrichment(org.id, lead.id, "revenue", "new", "NEW")
    const { evidence } = (await getLeadIntelligence(org.id, lead.id))!
    expect(
      evidence.some(
        (e) => e.source === "ENRICHMENT" && e.text.includes("React"),
      ),
    ).toBe(true)
    expect(evidence.some((e) => e.text.includes("stale"))).toBe(false)
    expect(evidence.some((e) => e.text.includes("new"))).toBe(false)
  })

  it("adds EXTRACTION evidence from the source candidate field provenance", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id)
    const lead = await newLead(org.id, company.id)
    const candidate = await newCandidate(org.id, {
      fieldProvenance: [
        {
          field: "companyName",
          value: "Acme SaaS",
          evidenceType: "JSON_LD",
          sourceUrl: "https://acme.example",
        },
      ],
    })
    await prisma.lead.update({
      where: { id: lead.id },
      data: { sourceCandidateId: candidate.id },
    })
    const { evidence } = (await getLeadIntelligence(org.id, lead.id))!
    expect(
      evidence.some(
        (e) =>
          e.source === "EXTRACTION" &&
          e.text.includes("companyName: Acme SaaS"),
      ),
    ).toBe(true)
  })

  it("caps evidence at the deterministic limit", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id)
    const lead = await newLead(org.id, company.id)
    for (let i = 0; i < 20; i += 1) {
      await addEnrichment(org.id, lead.id, `field-${i}`, `value-${i}`)
    }
    const { evidence } = (await getLeadIntelligence(org.id, lead.id))!
    expect(evidence.length).toBeLessThanOrEqual(16)
  })

  it("exposes the persisted AI classification with its timestamp", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id)
    const lead = await newLead(org.id, company.id)
    const icp = await newIcp(org.id)
    await seedClassification(org.id, lead.id, icp.id)
    const { classification } = (await getLeadIntelligence(org.id, lead.id))!
    expect(classification).not.toBeNull()
    expect(classification!.result.classification).toBe("HIGH_FIT")
    expect(classification!.result.fitScore).toBe(87)
    expect(classification!.result.reasons).toEqual(["B2B SaaS fits"])
    expect(classification!.result.matchedCriteria).toEqual(["Industry"])
    expect(classification!.result.evidenceReferences).toEqual(["E1", "E3"])
    expect(classification!.result.model).toBe("test-model")
    expect(classification!.updatedAt).toBeInstanceOf(Date)
  })

  it("does not leak another org's classification for the same lead", async () => {
    const orgA = await newOrg()
    const orgB = await newOrg()
    const company = await newCompany(orgA.id)
    const lead = await newLead(orgA.id, company.id)
    const icp = await newIcp(orgA.id)
    await seedClassification(orgB.id, lead.id, icp.id)
    const { classification } = (await getLeadIntelligence(orgA.id, lead.id))!
    expect(classification).toBeNull()
  })

  it("exposes the persisted account research with its timestamp", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id)
    const lead = await newLead(org.id, company.id)
    await seedResearch(org.id, company.id)
    const { research } = (await getLeadIntelligence(org.id, lead.id))!
    expect(research).not.toBeNull()
    expect(research!.companySummary).toContain("B2B SaaS")
    expect(research!.keyFacts).toEqual(["Company name is Acme SaaS"])
    expect(research!.relevantSignals).toEqual(["Hiring engineers"])
    expect(research!.evidenceReferences).toEqual(["E1"])
    expect(research!.model).toBe("test-model")
    expect(research!.updatedAt).toBeInstanceOf(Date)
  })

  it("does not leak another org's research for the same company", async () => {
    const orgA = await newOrg()
    const orgB = await newOrg()
    const company = await newCompany(orgA.id)
    const lead = await newLead(orgA.id, company.id)
    await seedResearch(orgB.id, company.id)
    const { research } = (await getLeadIntelligence(orgA.id, lead.id))!
    expect(research).toBeNull()
  })

  it("builds research evidence for reference resolution (company-scoped)", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id)
    const lead = await newLead(org.id, company.id)
    const candidate = await newCandidate(org.id, {
      fieldProvenance: [
        { field: "companyName", value: "Acme SaaS", evidenceType: "JSON_LD" },
      ],
    })
    await prisma.lead.update({
      where: { id: lead.id },
      data: { sourceCandidateId: candidate.id },
    })
    await prisma.company.update({
      where: { id: company.id },
      data: { sourceCandidateId: candidate.id },
    })
    const { researchEvidence } = (await getLeadIntelligence(org.id, lead.id))!
    expect(researchEvidence[0]).toEqual({
      source: "COMPANY_PROFILE",
      text: "company name is Acme SaaS",
    })
    expect(researchEvidence.some((e) => e.source === "EXTRACTION")).toBe(true)
  })

  it("returns the ICP used by the most recent score", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id)
    const lead = await newLead(org.id, company.id)
    const icp = await newIcp(org.id, {
      industries: ["SaaS"],
      signals: ["HIRING"],
    })
    await prisma.leadScore.create({
      data: {
        organizationId: org.id,
        leadId: lead.id,
        icpProfileId: icp.id,
        source: "CRM",
        modelVersion: "1",
        icpScore: 80,
        overallScore: 70,
        qualification: "GOOD",
        scoreStatus: "CURRENT",
        scoreBreakdown: [],
        reasons: [],
      },
    })
    const { icp: context } = (await getLeadIntelligence(org.id, lead.id))!
    expect(context).not.toBeNull()
    expect(context!.id).toBe(icp.id)
    expect(context!.name).toBe(icp.name)
    expect(context!.criteria.industries).toEqual(["SaaS"])
    expect(context!.criteria.signals).toEqual(["HIRING"])
  })

  it("returns no ICP when the lead was never scored", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id)
    const lead = await newLead(org.id, company.id)
    const { icp } = (await getLeadIntelligence(org.id, lead.id))!
    expect(icp).toBeNull()
  })

  it("returns no ICP when the score has no ICP profile attached", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id)
    const lead = await newLead(org.id, company.id)
    await prisma.leadScore.create({
      data: {
        organizationId: org.id,
        leadId: lead.id,
        source: "CRM",
        modelVersion: "1",
        icpScore: 50,
        overallScore: 40,
        qualification: "MAYBE",
        scoreStatus: "CURRENT",
        scoreBreakdown: [],
        reasons: [],
      },
    })
    const { icp } = (await getLeadIntelligence(org.id, lead.id))!
    expect(icp).toBeNull()
  })

  it("collects hiring signals from the source candidate's jobs", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id)
    const lead = await newLead(org.id, company.id)
    const candidate = await newCandidate(org.id, {
      jobs: [
        {
          title: "Sales Engineer",
          hiringOrganization: "Acme SaaS",
          location: "Bengaluru",
        },
        {
          title: "Account Executive",
          hiringOrganization: "Acme SaaS",
          location: "Remote",
        },
      ],
    })
    await prisma.lead.update({
      where: { id: lead.id },
      data: { sourceCandidateId: candidate.id },
    })
    const { hiringSignals } = (await getLeadIntelligence(org.id, lead.id))!
    expect(hiringSignals).toHaveLength(2)
    expect(hiringSignals[0].title).toBe("Sales Engineer")
  })

  it("returns no hiring signals without a source candidate", async () => {
    const org = await newOrg()
    const company = await newCompany(org.id)
    const lead = await newLead(org.id, company.id)
    const { hiringSignals } = (await getLeadIntelligence(org.id, lead.id))!
    expect(hiringSignals).toEqual([])
  })
})

describe("resolveReferences", () => {
  const items = [{ text: "one" }, { text: "two" }, { text: "three" }]

  it("resolves in-range references to their evidence", () => {
    const refs = resolveReferences(["E1", "E3"], items)
    expect(refs).toEqual([
      { ref: "E1", item: { text: "one" } },
      { ref: "E3", item: { text: "three" } },
    ])
  })

  it("marks out-of-range references as unavailable", () => {
    const refs = resolveReferences(["E0", "E9"], items)
    expect(refs).toEqual([
      { ref: "E0", item: null },
      { ref: "E9", item: null },
    ])
  })

  it("marks malformed references as unavailable", () => {
    const refs = resolveReferences(["E", "e-1", "bogus"], items)
    expect(refs.every((r) => r.item === null)).toBe(true)
  })

  it("normalizes reference casing and dedupes", () => {
    const refs = resolveReferences(["e2", "E2"], items)
    expect(refs).toEqual([{ ref: "E2", item: { text: "two" } }])
  })

  it("returns no references for an empty input", () => {
    expect(resolveReferences([], items)).toEqual([])
  })
})

const SOURCE_ORDER: Record<string, number> = {
  COMPANY_PROFILE: 0,
  CONTACT: 1,
  ENRICHMENT: 2,
  EXTRACTION: 3,
}
