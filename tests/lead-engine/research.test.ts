// TASK 019: AI account research tests (spec §36-§41). Real database,
// MockAIProvider / stub providers only — no network, no real DeepSeek calls.
// Covers the research flow, evidence-reference validation, tenant isolation,
// AI failures, empty data, re-run refresh and regressions (signals, LeadScore,
// AI classification and factual company fields are never modified).

import { afterAll, describe, expect, it } from "vitest"
import { prisma } from "@/lib/db"
import { AIError, type AIProvider } from "@/lib/lead-engine/ai/types"
import { MockAIProvider } from "@/lib/lead-engine/ai/providers/mock"
import { ResearchError, researchAccount, getAccountResearch } from "@/lib/lead-engine/research/service"
import {
  CandidateStatus,
  ClassificationLabel,
  EnrichmentResultStatus,
  LeadSourceType,
  Qualification,
  ScraperRunStatus,
  ScoreSource,
  ScoreStatus,
} from "@/generated/prisma/enums"

const cleanupIds: string[] = []

async function freshOrg(): Promise<string> {
  const org = await prisma.organization.create({
    data: { name: `ResearchOrg-${Date.now()}-${Math.round(Math.random() * 1e9)}` },
  })
  cleanupIds.push(org.id)
  return org.id
}

async function freshCompany(orgId: string, overrides: Record<string, unknown> = {}) {
  return prisma.company.create({
    data: {
      organizationId: orgId,
      name: "Acme Software",
      normalizedName: "acme software",
      ...overrides,
    },
  })
}

async function newSource(orgId: string) {
  return prisma.leadSource.create({
    data: {
      name: `Res Source ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      slug: `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: LeadSourceType.CUSTOM,
      organizationId: orgId,
      config: {},
    },
  })
}

async function newCandidate(orgId: string, overrides: Record<string, unknown> = {}) {
  const source = await newSource(orgId)
  const run = await prisma.scraperRun.create({
    data: { organizationId: orgId, sourceId: source.id, status: ScraperRunStatus.COMPLETED },
  })
  const page = await prisma.rawPage.create({
    data: {
      organizationId: orgId,
      runId: run.id,
      sourceId: source.id,
      url: `https://acme.example/careers-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
      html: "<html><body>careers</body></html>",
      textContent: "careers",
      fetchedAt: new Date(),
    },
  })
  return prisma.leadCandidate.create({
    data: {
      organizationId: orgId,
      runId: run.id,
      sourceId: source.id,
      rawPageId: page.id,
      status: CandidateStatus.EXTRACTED,
      companyName: "Acme Software",
      normalizedCompanyName: "acme software",
      ...overrides,
    },
  })
}

async function addConfirmedEnrichment(orgId: string, companyId: string, field: string, value: string, observedAt: Date) {
  const lead = await prisma.lead.create({ data: { organizationId: orgId, companyId, title: "Founder", status: "NEW" } })
  const request = await prisma.enrichmentRequest.create({
    data: { organizationId: orgId, leadId: lead.id, providerId: "test-provider" },
  })
  return prisma.enrichmentResult.create({
    data: {
      organizationId: orgId,
      requestId: request.id,
      leadId: lead.id,
      field,
      value,
      source: "website",
      method: "AI",
      confidence: 0.9,
      status: EnrichmentResultStatus.CONFIRMED,
      observedAt,
    },
  })
}

const withMock = (structured: unknown) => ({ aiProvider: new MockAIProvider({ structured }) })

class FailingProvider implements AIProvider {
  readonly configured = true
  constructor(private readonly failureCode: AIError["code"]) {}
  async generateText(): Promise<never> {
    throw new AIError(this.failureCode, `provider ${this.failureCode}`, true)
  }
  async generateStructured(): Promise<never> {
    throw new AIError(this.failureCode, `provider ${this.failureCode}`, true)
  }
}

async function acmeFixture() {
  const orgId = await freshOrg()
  const company = await freshCompany(orgId, { industry: "SaaS", employeeCount: 250, country: "India", city: "Bangalore" })
  const candidate = await newCandidate(orgId, {
    fieldProvenance: [
      { field: "technologies", value: "AWS", sourceUrl: "https://acme.example/", evidenceType: "META" },
      { field: "location", value: "Bangalore, India", sourceUrl: "https://acme.example/contact", evidenceType: "VISIBLE_TEXT" },
      { field: "description", value: "SaaS platform for teams", sourceUrl: "https://acme.example/", evidenceType: "VISIBLE_TEXT" },
    ],
    jobs: [
      { title: "Senior Engineer", location: "Bangalore" },
      { title: "Sales Manager", hiringOrganization: "Acme Software" },
    ],
  })
  await prisma.company.update({ where: { id: company.id }, data: { sourceCandidateId: candidate.id } })
  const now = Date.now()
  await addConfirmedEnrichment(orgId, company.id, "employeeRange", "201-500", new Date(now - 120_000))
  await addConfirmedEnrichment(orgId, company.id, "technologies", "React", new Date(now - 60_000))
  return { orgId, company, candidate }
}

const fixtureResearch = {
  companySummary:
    "Acme Software is an India-based SaaS company with approximately 250 employees. Available evidence indicates use of AWS and React.",
  keyFacts: ["Industry is SaaS", "Location is India", "Approximately 250 employees", "Uses AWS and React"],
  relevantSignals: ["Hiring: 2 open positions listed on the careers page"],
  researchInsights: [
    "Use of AWS and React suggests a cloud-based web product (interpretation).",
    "Open engineering and sales roles suggest the company is scaling its team (interpretation).",
  ],
  unknowns: ["Revenue is not available", "Funding information is not available"],
  evidenceReferences: ["E1", "E3", "E7"],
}

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: cleanupIds } } })
  await prisma.$disconnect()
})

describe("researchAccount", () => {
  it("researches a company and persists the latest result", async () => {
    const { orgId, company } = await acmeFixture()

    const result = await researchAccount(orgId, company.id, withMock(fixtureResearch))

    expect(result.companySummary).toContain("Acme Software")
    expect(result.keyFacts.length).toBeGreaterThan(0)
    expect(result.unknowns.length).toBeGreaterThan(0)
    expect(result.evidenceReferences).toEqual(["E1", "E3", "E7"])
    expect(result.model).toBe("deepseek-chat")

    const persisted = await getAccountResearch(orgId, company.id)
    expect(persisted?.companySummary).toBe(fixtureResearch.companySummary)
    expect(persisted?.evidenceReferences).toEqual(["E1", "E3", "E7"])
  })

  it("keeps valid evidence references and drops invalid or fabricated ones", async () => {
    const { orgId, company } = await acmeFixture()

    const result = await researchAccount(
      orgId,
      company.id,
      withMock({ ...fixtureResearch, evidenceReferences: ["e3", "E99", "E7"] }),
    )

    expect(result.evidenceReferences).toEqual(["E3", "E7"])
    const persisted = await getAccountResearch(orgId, company.id)
    expect(persisted?.evidenceReferences).toEqual(["E3", "E7"])
    expect(persisted?.evidenceReferences.every((r) => /^E\d+$/.test(r))).toBe(true)
  })

  it("reports signals from existing job evidence", async () => {
    const { orgId, company } = await acmeFixture()

    const result = await researchAccount(orgId, company.id, withMock(fixtureResearch))

    expect(result.relevantSignals.length).toBeGreaterThan(0)
    expect(result.relevantSignals.some((s) => /hiring/i.test(s))).toBe(true)
  })

  it("does not create or modify signal records or factual company fields", async () => {
    const { orgId, company, candidate } = await acmeFixture()

    await researchAccount(orgId, company.id, withMock(fixtureResearch))

    const after = await prisma.company.findUniqueOrThrow({ where: { id: company.id } })
    expect(after.industry).toBe("SaaS")
    expect(after.employeeCount).toBe(250)
    expect(after.country).toBe("India")
    expect(after.city).toBe("Bangalore")
    const candidateAfter = await prisma.leadCandidate.findUniqueOrThrow({ where: { id: candidate.id } })
    expect(candidateAfter.jobs).toEqual(candidate.jobs)
    expect(candidateAfter.fieldProvenance).toEqual(candidate.fieldProvenance)
  })

  it("returns a minimal result with unknowns for a company with no data", async () => {
    const orgId = await freshOrg()
    const company = await freshCompany(orgId, { name: "Mystery Co", normalizedName: "mystery co" })

    const result = await researchAccount(orgId, company.id, { aiProvider: new FailingProvider("AI_TIMEOUT") })

    expect(result.companySummary).toMatch(/little information/i)
    expect(result.unknowns.length).toBeGreaterThan(0)
    expect(result.unknowns.some((u) => /revenue/i.test(u))).toBe(true)
    expect(result.evidenceReferences).toEqual([])
    expect(await getAccountResearch(orgId, company.id)).not.toBeNull()
  })

  it("still reports unknowns when evidence is sparse", async () => {
    const orgId = await freshOrg()
    const company = await freshCompany(orgId, { industry: "SaaS" })

    const result = await researchAccount(
      orgId,
      company.id,
      withMock({ ...fixtureResearch, companySummary: "Acme Software operates in SaaS." }),
    )

    expect(result.unknowns.length).toBeGreaterThan(0)
    expect(result.keyFacts.some((f) => /saas/i.test(f))).toBe(true)
  })

  it("propagates AI provider failures and persists nothing", async () => {
    const { orgId, company } = await acmeFixture()

    await expect(
      researchAccount(orgId, company.id, { aiProvider: new FailingProvider("AI_PROVIDER_ERROR") }),
    ).rejects.toMatchObject({ name: "AIError", code: "AI_PROVIDER_ERROR" })
    expect(await getAccountResearch(orgId, company.id)).toBeNull()
  })

  it("propagates AI timeouts", async () => {
    const { orgId, company } = await acmeFixture()

    await expect(
      researchAccount(orgId, company.id, { aiProvider: new FailingProvider("AI_TIMEOUT") }),
    ).rejects.toMatchObject({ name: "AIError", code: "AI_TIMEOUT" })
  })

  it("propagates invalid AI responses as AIError", async () => {
    const { orgId, company } = await acmeFixture()

    await expect(researchAccount(orgId, company.id, withMock("not json at all"))).rejects.toBeInstanceOf(AIError)
  })

  it("propagates schema validation failures", async () => {
    const { orgId, company } = await acmeFixture()

    await expect(researchAccount(orgId, company.id, withMock({ keyFacts: ["x"] }))).rejects.toMatchObject({
      name: "AIError",
      code: "AI_SCHEMA_VALIDATION_ERROR",
    })
  })

  it("enforces organization isolation", async () => {
    const { orgId, company } = await acmeFixture()
    const otherOrg = await freshOrg()

    await expect(researchAccount(otherOrg, company.id, withMock(fixtureResearch))).rejects.toBeInstanceOf(ResearchError)
    await expect(researchAccount(otherOrg, company.id, withMock(fixtureResearch))).rejects.toMatchObject({
      name: "ResearchError",
      code: "COMPANY_NOT_FOUND",
    })
    expect(await getAccountResearch(otherOrg, company.id)).toBeNull()
    expect(await getAccountResearch(orgId, company.id)).toBeNull()
  })

  it("does not modify existing AI lead classifications or LeadScores", async () => {
    const { orgId, company } = await acmeFixture()
    const lead = await prisma.lead.create({
      data: { organizationId: orgId, companyId: company.id, title: "Founder", status: "NEW" },
    })
    const classification = await prisma.leadClassification.create({
      data: {
        organizationId: orgId,
        leadId: lead.id,
        icpId: (
          await prisma.iCPProfile.create({
            data: { organizationId: orgId, name: "Res ICP", criteria: { industries: ["SaaS"] } },
          })
        ).id,
        classification: ClassificationLabel.HIGH_FIT,
        fitScore: 82,
        reasons: ["Industry matches.", "Location matches.", "Size matches."],
        concerns: [],
        matchedCriteria: [],
        unmatchedCriteria: [],
        evidenceReferences: [],
        model: "mock",
      },
    })
    const score = await prisma.leadScore.create({
      data: {
        organizationId: orgId,
        leadId: lead.id,
        source: ScoreSource.CRM,
        modelVersion: "v1",
        icpScore: 80,
        overallScore: 75,
        qualification: Qualification.GOOD,
        scoreStatus: ScoreStatus.CURRENT,
        scoreBreakdown: {},
        reasons: [],
      },
    })

    await researchAccount(orgId, company.id, withMock(fixtureResearch))

    const classificationAfter = await prisma.leadClassification.findUniqueOrThrow({ where: { id: classification.id } })
    expect(classificationAfter.classification).toBe(ClassificationLabel.HIGH_FIT)
    expect(classificationAfter.fitScore).toBe(82)
    expect(classificationAfter.reasons).toEqual(classification.reasons)
    const scoreAfter = await prisma.leadScore.findUniqueOrThrow({ where: { id: score.id } })
    expect(scoreAfter.icpScore).toBe(80)
    expect(scoreAfter.overallScore).toBe(75)
    expect(scoreAfter.scoreStatus).toBe(ScoreStatus.CURRENT)
  })

  it("re-running research updates the latest result in place", async () => {
    const { orgId, company } = await acmeFixture()

    await researchAccount(orgId, company.id, withMock(fixtureResearch))
    await researchAccount(
      orgId,
      company.id,
      withMock({
        ...fixtureResearch,
        companySummary: "Acme Software is an India-based SaaS company (revised).",
        evidenceReferences: ["E1"],
      }),
    )

    const rows = await prisma.accountResearch.findMany({ where: { companyId: company.id } })
    expect(rows.length).toBe(1)
    const persisted = await getAccountResearch(orgId, company.id)
    expect(persisted?.companySummary).toContain("(revised)")
    expect(persisted?.evidenceReferences).toEqual(["E1"])
  })

  it("rejects its own context when classification exists but must not rewrite it", async () => {
    const { orgId, company } = await acmeFixture()
    const lead = await prisma.lead.create({
      data: { organizationId: orgId, companyId: company.id, title: "Founder", status: "NEW" },
    })

    await researchAccount(orgId, company.id, withMock(fixtureResearch))

    expect(await prisma.leadClassification.count({ where: { leadId: lead.id } })).toBe(0)
  })
})