// TASK 020: Lead Finder tests (spec §49–§50). Service-level — no UI test
// framework exists to render React screens, so these exercise the exact
// server contract the page drives. Two page states:
//   1. Setup: org-scoped ICP/source loading + AI parse → criteria summary
//   2. Run: discovery lifecycle (demo source, no network), run-scoped
//      candidate listing, filters, pagination, add-to-CRM dedup and the
//      guarantee that the finder never triggers AI classification.
// Candidates are seeded under a real run/rawPage (same pattern as conversion
// tests) so runId-scoped queries are meaningful.

import { describe, expect, it, afterAll } from "vitest"
import { prisma } from "@/lib/db"
import { LeadSourceType, ScraperRunStatus, CandidateStatus, ScoreSource, Qualification } from "@/generated/prisma/enums"
import { createSource, listSources } from "@/lib/lead-engine/sources"
import { createRun, getRun } from "@/lib/lead-engine/runs"
import { executeRun } from "@/lib/lead-engine/worker"
import { listCandidates } from "@/lib/lead-engine/extraction/service"
import { bulkConvert } from "@/lib/lead-engine/conversion/service"
import { listICPs, createICP } from "@/lib/crm/icp"
import { parseIcpPrompt } from "@/lib/crm/icp-parse"
import { MockAIProvider } from "@/lib/lead-engine/ai/providers/mock"
import { candidateSignals, icpCriteriaLines } from "@/lib/lead-engine/finder"

const orgIds: string[] = []

async function newOrg() {
  const org = await prisma.organization.create({
    data: { name: `Lead Finder Test Org ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  })
  orgIds.push(org.id)
  return org
}

async function newUser(orgId: string) {
  return prisma.user.create({
    data: {
      email: `finder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
      passwordHash: "x",
      name: "Finder Tester",
      organizationId: orgId,
    },
  })
}

const demoSourceInput = (name: string) => ({
  name,
  description: "Demo source",
  type: LeadSourceType.CUSTOM,
  config: { maxResults: 12 },
  isActive: true,
})

const newSource = (orgId: string) =>
  prisma.leadSource.create({
    data: {
      organizationId: orgId,
      name: `Finder Source ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      slug: `finder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: LeadSourceType.CUSTOM,
      config: { maxResults: 12 },
      isActive: true,
    },
  })

const newRun = (orgId: string, sourceId: string) =>
  prisma.scraperRun.create({
    data: {
      organizationId: orgId,
      sourceId,
      status: ScraperRunStatus.COMPLETED,
      startedAt: new Date(),
      finishedAt: new Date(),
    },
  })

const newRawPage = (orgId: string, runId: string, sourceId: string, url: string) =>
  prisma.rawPage.create({
    data: {
      organizationId: orgId,
      runId,
      sourceId,
      url,
      statusCode: 200,
      html: `<html><body>${url}</body></html>`,
      textContent: url,
      fetchedAt: new Date(),
    },
  })

// Seed a completed run with `count` candidates, each scored. Returns run id.
async function seededRun(orgId: string, count: number) {
  const source = await newSource(orgId)
  const run = await newRun(orgId, source.id)
  for (let i = 0; i < count; i++) {
    const page = await newRawPage(orgId, run.id, source.id, `https://finder-${i}.com/team`)
    const candidate = await prisma.leadCandidate.create({
      data: {
        organizationId: orgId,
        runId: run.id,
        sourceId: source.id,
        rawPageId: page.id,
        status: CandidateStatus.EXTRACTED,
        companyName: `Finder Co ${i}`,
        normalizedCompanyName: `finder co ${i}`,
        companyDomain: `finder-${i}.com`,
        email: `contact${i}@finder-${i}.com`,
        contactFullName: `Contact ${i}`,
        jobs: [{ title: `Role ${i}` }],
      },
    })
    await prisma.leadScore.create({
      data: {
        organizationId: orgId,
        candidateId: candidate.id,
        source: ScoreSource.CANDIDATE,
        modelVersion: "test",
        icpScore: 60 + i,
        overallScore: 50 + i,
        qualification: i % 2 === 0 ? Qualification.HOT : Qualification.GOOD,
        scoreStatus: "CURRENT",
      scoreBreakdown: {},
      reasons: {},
      },
    })
  }
  return run
}

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
  await prisma.$disconnect()
})

describe("lead finder: server-side helpers", () => {
  it("renders hiring signals from job postings", () => {
    expect(candidateSignals([])).toEqual([])
    expect(candidateSignals([{ title: "Backend Engineer" }])).toEqual(["Hiring: 1 open role"])
    expect(candidateSignals([{ title: "A" }, { title: "B" }, { title: undefined }])).toEqual(["Hiring: 2 open roles"])
  })

  it("renders human criteria summary lines for the review panel", () => {
    const lines = icpCriteriaLines({
      industries: ["SaaS"],
      countries: ["India"],
      regions: [],
      cities: [],
      technologies: ["React", "AWS"],
      employeeRange: { min: 50, max: 500 },
      revenueRange: null,
      companyTypes: [],
      signals: [],
      companyAge: null,
      exclusions: { industries: [], countries: [], companyTypes: [], keywords: [] },
      scoring: {
        keywords: [],
        jobTitles: [],
        seniorities: [],
        domains: [],
        weights: { industry: 1, companySize: 1, location: 1, title: 1, keyword: 1, domain: 1, quality: 1 },
        thresholds: { hot: 80, good: 60, maybe: 40 },
        unknownCredit: 0.5,
      },
    })
    expect(lines).toContain("Industries: SaaS")
    expect(lines).toContain("Countries: India")
    expect(lines).toContain("Technologies: React, AWS")
    expect(lines).toContain("Employees: 50–500")
  })
})

describe("lead finder: setup state", () => {
  it("AI parses a natural-language description into criteria", async () => {
    const parsed = await parseIcpPrompt("SaaS companies in India with 50-500 employees using React and AWS", {
      aiProvider: new MockAIProvider(),
    })
    expect(parsed.criteria).toBeDefined()
    expect(parsed.warnings).toBeDefined()
  })

  it("loads only this organization's ICPs and sources", async () => {
    const orgA = (await newOrg()).id
    const orgB = (await newOrg()).id
    await createICP(orgA, (await newUser(orgA)).id, { name: "Org A ICP", ...(await icpDefaults()) })
    await createSource(orgA, (await newUser(orgA)).id, demoSourceInput("Active A"))
    await createSource(orgB, (await newUser(orgB)).id, demoSourceInput("Active B"))

    expect((await listICPs(orgA)).total).toBe(1)
    expect((await listICPs(orgB)).total).toBe(0)

    const aSources = (await listSources(orgA, { pageSize: 100 })).data.filter((s) => s.isActive)
    expect(aSources.map((s) => s.name)).toEqual(["Active A"])
    const bSources = (await listSources(orgB, { pageSize: 100 })).data.filter((s) => s.isActive)
    expect(bSources.map((s) => s.name)).toEqual(["Active B"])
  })
})

describe("lead finder: run state", () => {
  it("creates a run in QUEUED and executes it to COMPLETED via the demo source", async () => {
    const orgId = (await newOrg()).id
    const source = await createSource(orgId, (await newUser(orgId)).id, demoSourceInput(`Queued ${Date.now()}`))
    const run = await createRun(orgId, "u", { sourceId: source.id, test: false })

    expect(run.status).toBe(ScraperRunStatus.QUEUED)
    await executeRun(run.id)
    const after = await getRun(orgId, run.id)
    expect(after?.status).toBe(ScraperRunStatus.COMPLETED)
    expect(after?._count.rawLeads).toBeGreaterThan(0)
    expect(after?._count.rawPages).toBeGreaterThanOrEqual(0)
  })

  it("returns a run not found in this organization as null", async () => {
    const orgA = (await newOrg()).id
    const orgB = (await newOrg()).id
    const run = await seededRun(orgA, 2)
    expect(await getRun(orgB, run.id)).toBeNull()
    expect(await getRun(orgA, run.id)).not.toBeNull()
  })

  it("keeps candidate rows scoped to the owning organization and run", async () => {
    const orgA = (await newOrg()).id
    const orgB = (await newOrg()).id
    const runA = await seededRun(orgA, 3)
    await seededRun(orgB, 5)

    expect(await listCandidates(orgB, { runId: runA.id, pageSize: "50" })).toMatchObject({ total: 0 })

    const own = await listCandidates(orgA, { runId: runA.id, pageSize: "50" })
    expect(own.total).toBe(3)
    expect(own.data.every((c) => c.runId === runA.id)).toBe(true)
  })

  it("lists run-scoped candidates with scores, filters, and pagination", async () => {
    const orgId = (await newOrg()).id
    const run = await seededRun(orgId, 8)

    const page1 = await listCandidates(orgId, { runId: run.id, page: "1", pageSize: "3" })
    expect(page1.total).toBe(8)
    expect(page1.data).toHaveLength(3)
    expect(page1.data[0].scores[0]).toMatchObject({ icpScore: expect.any(Number), overallScore: expect.any(Number) })

    const hot = await listCandidates(orgId, { runId: run.id, qualification: Qualification.HOT, pageSize: "50" })
    expect(hot.total).toBe(4)
    const hotList = await listCandidates(orgId, { runId: run.id, minIcpScore: "90", pageSize: "50" })
    expect(hotList.total).toBe(0)
  })

  it("supports search across the finder list", async () => {
    const orgId = (await newOrg()).id
    const run = await seededRun(orgId, 5)
    const found = await listCandidates(orgId, { runId: run.id, q: "finder co 3", pageSize: "50" })
    expect(found.total).toBe(1)
    expect(found.data[0].companyDomain).toBe("finder-3.com")
  })

  it("never classifies candidates during discovery or listing", async () => {
    const orgId = (await newOrg()).id
    const source = await createSource(orgId, (await newUser(orgId)).id, demoSourceInput(`NoClass ${Date.now()}`))
    const run = await createRun(orgId, "u", { sourceId: source.id, test: false })
    await executeRun(run.id)
    await seededRun(orgId, 2)
    await listCandidates(orgId, { runId: run.id, pageSize: "50" })
    expect(await prisma.leadClassification.count()).toBe(0)
  })

  it("adds selected candidates to the CRM once, with dedup on re-add", async () => {
    const orgId = (await newOrg()).id
    const user = (await newUser(orgId)).id
    const run = await seededRun(orgId, 4)
    const { data } = await listCandidates(orgId, { runId: run.id, pageSize: "4" })
    const ids = data.map((c) => c.id)
    expect(ids.length).toBe(4)

    const first = await bulkConvert(orgId, ids, user)
    expect(first.converted).toBe(ids.length)
    expect(first.alreadyConverted).toBe(0)

    const second = await bulkConvert(orgId, ids, user)
    expect(second.converted).toBe(0)
    expect(second.alreadyConverted).toBe(ids.length)
  })
})

async function icpDefaults() {
  return {
    industries: ["SaaS"],
    countries: ["India"],
    regions: [],
    cities: [],
    employeeMin: 50,
    employeeMax: 500,
    technologies: ["React", "AWS"],
    companyTypes: [],
    signals: [],
    excludeIndustries: [],
    excludeCountries: [],
    excludeCompanyTypes: [],
    excludeKeywords: [],
    scoringKeywords: [],
    scoringJobTitles: [],
    scoringSeniorities: [],
    scoringDomains: [],
  }
}