import { describe, expect, it, afterAll } from "vitest"
import { prisma } from "@/lib/db"
import { LeadSourceType, ScraperRunStatus, ScraperRunEventLevel, SourceCapability } from "@/generated/prisma/enums"
import { demoAdapter } from "@/lib/lead-engine/adapters/demo"
import { getSourceAdapter, getAdapterForType, listSourceAdapters, registerSourceAdapter } from "@/lib/lead-engine/registry"
import { demoConfigSchema } from "@/lib/lead-engine/adapters/demo"
import { createSource, getSource, listSources, updateSource, deleteSource, validateSourceConfig } from "@/lib/lead-engine/sources"
import { createRun, getRun, cancelRun, listRawLeads, listRunEvents } from "@/lib/lead-engine/runs"
import { executeRun } from "@/lib/lead-engine/worker"

const orgIds: string[] = []
const newOrg = async () => {
  const org = await prisma.organization.create({
    data: { name: `Scraper Test Org ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  })
  orgIds.push(org.id)
  return org
}

const newUser = async (orgId: string) =>
  prisma.user.create({
    data: {
      email: `scraper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
      passwordHash: "x",
      name: "Scraper Tester",
      organizationId: orgId,
    },
  })

const demoSourceInput = {
  name: `Demo ${Date.now()}`,
  type: LeadSourceType.CUSTOM,
  description: "test",
  config: { maxResults: 5 },
  isActive: true,
}

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
  await prisma.$disconnect()
})

describe("source registry", () => {
  it("registers and retrieves the demo adapter", () => {
    expect(getSourceAdapter("demo")).toBe(demoAdapter)
    expect(getSourceAdapter("nope")).toBeUndefined()
    expect(getAdapterForType(LeadSourceType.WEB_SEARCH)).toBeUndefined()
    expect(listSourceAdapters()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "demo",
          name: "Demo Source",
          type: LeadSourceType.CUSTOM,
          capabilities: expect.arrayContaining([SourceCapability.DISCOVERY, SourceCapability.SCRAPING]),
        }),
      ]),
    )
  })

  it("rejects duplicate registrations", () => {
    expect(() => registerSourceAdapter(demoAdapter)).toThrow(/already registered/)
  })
})

describe("source configuration", () => {
  it("accepts a valid demo config and rejects invalid ones", () => {
    expect(demoConfigSchema.safeParse({ maxResults: 10 }).success).toBe(true)
    expect(demoConfigSchema.safeParse({ maxResults: 0 }).success).toBe(false)
    expect(demoConfigSchema.safeParse({ maxResults: 51 }).success).toBe(false)
    expect(demoConfigSchema.safeParse({ maxResults: "many" }).success).toBe(false)
    expect(demoConfigSchema.safeParse({ unknownKey: true }).success).toBe(false)
  })

  it("reports unavailable types cleanly", async () => {
    const result = await validateSourceConfig(LeadSourceType.WEB_SEARCH, {})
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not available/)
  })
})

describe("demo adapter", () => {
  it("returns deterministic records without external requests", async () => {
    const scrape = (maxResults = 5) =>
      demoAdapter.scrape({
        runId: "r",
        organizationId: "o",
        source: { id: "s", name: "Demo", slug: "demo", type: LeadSourceType.CUSTOM },
        targets: [],
        config: { maxResults },
      })
    const first = await scrape()
    const second = await scrape()
    expect(first.records).toEqual(second.records)
    expect(first.records).toHaveLength(5)
    expect(first.records[0]).toEqual({
      externalId: "northwind.io",
      sourceUrl: "https://northwind.io/team",
      data: expect.objectContaining({ company: expect.objectContaining({ name: "Northwind Software" }) }),
    })
    expect(first.stats).toEqual({ discovered: 5, processed: 5, failed: 0 })

    const targets = await demoAdapter.discover({ icp: null, source: { id: "s", name: "Demo", slug: "demo", type: LeadSourceType.CUSTOM }, maxResults: 3 })
    expect(targets).toHaveLength(3)
    expect(targets[0]).toEqual({ type: "DOMAIN", value: "northwind.io", title: "Northwind Software" })
  })
})

describe("scraper worker and runs", () => {
  it("runs end to end: run created, raw records stored, stats updated, run completes, events written", async () => {
    const org = await newOrg()
    const user = await newUser(org.id)
    const source = await createSource(org.id, user.id, demoSourceInput)

    const run = await createRun(org.id, user.id, { sourceId: source.id })
    expect(run.status).toBe(ScraperRunStatus.QUEUED)

    await executeRun(run.id)

    const done = await getRun(org.id, run.id)
    expect(done?.status).toBe(ScraperRunStatus.COMPLETED)
    expect(done?.recordsFound).toBe(5)
    expect(done?.recordsProcessed).toBe(5)
    expect(done?.recordsCreated).toBe(5)
    expect(done?.recordsDuplicate).toBe(0)
    expect(done?.recordsFailed).toBe(0)
    expect(done?.finishedAt).not.toBeNull()
    const events = await listRunEvents(org.id, run.id, {})
    expect(events?.data.map((e) => e.message)).toEqual(
      expect.arrayContaining([expect.stringContaining("Run started"), expect.stringContaining("Run completed")]),
    )

    const raw = await listRawLeads(org.id, run.id, {})
    expect(raw.total).toBe(5)
    const first = raw.data[0]
    expect(first.sourceUrl).toMatch(/^https:\/\//)
    expect((first.rawData as { company: { domain: string } }).company.domain).toBe(first.externalId)
  })

  it("counts re-encountered records as duplicates instead of creating rows again", async () => {
    const org = await newOrg()
    const user = await newUser(org.id)
    const source = await createSource(org.id, user.id, demoSourceInput)

    const run = await createRun(org.id, user.id, { sourceId: source.id })
    await executeRun(run.id)
    const second = await createRun(org.id, user.id, { sourceId: source.id })
    await executeRun(second.id)

    const done = await getRun(org.id, second.id)
    expect(done?.status).toBe(ScraperRunStatus.COMPLETED)
    expect(done?.recordsCreated).toBe(0)
    expect(done?.recordsDuplicate).toBe(5)
    expect((await listRawLeads(org.id, second.id, {})).total).toBe(0)
  })

  it("snapshots ICP information on the run", async () => {
    const org = await newOrg()
    const user = await newUser(org.id)
    const source = await createSource(org.id, user.id, demoSourceInput)
    const icp = await prisma.iCPProfile.create({
      data: { organizationId: org.id, name: "Test ICP", criteria: { industries: ["SaaS"] } },
    })

    const run = await createRun(org.id, user.id, { sourceId: source.id, icpId: icp.id })
    await executeRun(run.id)
    const done = await getRun(org.id, run.id)
    expect(done?.icp?.name).toBe("Test ICP")
    expect(done?.metadata).toEqual({ icpName: "Test ICP" })
  })

  it("fails a run when the adapter rejects the configuration", async () => {
    const org = await newOrg()
    const user = await newUser(org.id)
    const source = await createSource(org.id, user.id, demoSourceInput)
    await prisma.leadSource.update({ where: { id: source.id }, data: { config: { maxResults: "not-a-number" } } })

    const run = await createRun(org.id, user.id, { sourceId: source.id })
    await executeRun(run.id)

    const done = await getRun(org.id, run.id)
    expect(done?.status).toBe(ScraperRunStatus.FAILED)
    expect(done?.errorMessage).toBeTruthy()
    const events = await listRunEvents(org.id, run.id, {})
    expect(events?.data.some((e) => e.level === ScraperRunEventLevel.ERROR)).toBe(true)
    expect((await listRawLeads(org.id, run.id, {})).total).toBe(0)
  })

  it("stays cancelled when executed after cancellation", async () => {
    const org = await newOrg()
    const user = await newUser(org.id)
    const source = await createSource(org.id, user.id, demoSourceInput)

    const run = await createRun(org.id, user.id, { sourceId: source.id })
    expect(await cancelRun(org.id, run.id)).toBe(true)
    expect(await cancelRun(org.id, run.id)).toBe(false)

    await executeRun(run.id)
    const done = await getRun(org.id, run.id)
    expect(done?.status).toBe(ScraperRunStatus.CANCELLED)
    expect(done?.recordsCreated).toBe(0)
  })
})

describe("organization isolation", () => {
  it("blocks cross-organization access to sources, runs, and raw leads", async () => {
    const orgA = await newOrg()
    const orgB = await newOrg()
    const userA = await newUser(orgA.id)

    const source = await createSource(orgA.id, userA.id, demoSourceInput)
    const icp = await prisma.iCPProfile.create({
      data: { organizationId: orgA.id, name: "A ICP", criteria: {} },
    })
    const run = await createRun(orgA.id, userA.id, { sourceId: source.id, icpId: icp.id })
    await executeRun(run.id)

    expect(await getSource(orgB.id, source.id)).toBeNull()
    expect((await listSources(orgB.id, {})).total).toBe(0)
    expect(await getRun(orgB.id, run.id)).toBeNull()
    expect((await listRawLeads(orgB.id, run.id, {})).total).toBe(0)
    await expect(cancelRun(orgB.id, run.id)).rejects.toThrow(/not found/)
    await expect(updateSource(orgB.id, source.id, { description: "hacked" })).resolves.toBeNull()
    await expect(createRun(orgB.id, userA.id, { sourceId: source.id })).rejects.toThrow()
    await expect(createRun(orgA.id, userA.id, { sourceId: source.id, icpId: "bogus" })).rejects.toThrow(/ICP not found/)
  })

  it("prevents deleting a source that has runs", async () => {
    const org = await newOrg()
    const user = await newUser(org.id)
    const source = await createSource(org.id, user.id, demoSourceInput)
    const run = await createRun(org.id, user.id, { sourceId: source.id })
    await executeRun(run.id)
    await expect(deleteSource(org.id, source.id)).rejects.toThrow(/cannot be deleted/)
    const fresh = await createSource(org.id, user.id, { ...demoSourceInput, name: `Fresh ${Date.now()}` })
    expect(await deleteSource(org.id, fresh.id)).toBe(true)
  })

  it("enforces unique source names per organization", async () => {
    const org = await newOrg()
    const user = await newUser(org.id)
    await createSource(org.id, user.id, demoSourceInput)
    await expect(createSource(org.id, user.id, { ...demoSourceInput, name: demoSourceInput.name })).rejects.toThrow(/already exists/)
    const other = await newOrg()
    const otherSource = await createSource(other.id, user.id, { ...demoSourceInput, name: `Other ${Date.now()}` })
    expect(otherSource.slug).toBeTruthy()
  })
})