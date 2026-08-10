// End-to-end resolution tests (TASK 009 §68): candidates into deduplication,
// review, confirm/reject, org isolation and idempotent re-runs. Real database.

import { describe, expect, it, afterAll } from "vitest"
import { prisma } from "@/lib/db"
import {
  LeadSourceType,
  ScraperRunStatus,
  CandidateStatus,
  MatchStatus,
  EntityType,
} from "@/generated/prisma/enums"
import { deduplicateRun, resolveCandidate } from "@/lib/lead-engine/resolution/service"
import { confirmDuplicateGroup, rejectDuplicateGroup } from "@/lib/lead-engine/resolution/groups"

const orgIds: string[] = []

const newOrg = async () => {
  const org = await prisma.organization.create({
    data: { name: `Resolution Test Org ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  })
  orgIds.push(org.id)
  return org
}

const newSource = (orgId: string) =>
  prisma.leadSource.create({
    data: {
      name: `Res Source ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      slug: `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: LeadSourceType.CUSTOM,
      organizationId: orgId,
      config: {},
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

const candidateData = (orgId: string, runId: string, sourceId: string, rawPageId: string, over: Record<string, unknown>) => ({
  organizationId: orgId,
  runId,
  sourceId,
  rawPageId,
  status: CandidateStatus.EXTRACTED,
  companyName: null,
  companyDomain: null,
  email: null,
  contactFullName: null,
  normalizedCompanyName: null,
  ...over,
})

const counts = (orgId: string) =>
  prisma.$transaction([
    prisma.entityMatch.count({ where: { organizationId: orgId } }),
    prisma.duplicateGroup.count({ where: { organizationId: orgId } }),
    prisma.duplicateGroupMember.count({ where: { organizationId: orgId } }),
    prisma.leadCandidate.count({ where: { organizationId: orgId } }),
  ])

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
  await prisma.$disconnect()
})

describe("resolution", () => {
  it("does not match candidates across organizations", async () => {
    const org = await newOrg()
    const source = await newSource(org.id)
    const run = await newRun(org.id, source.id)
    const page = await newRawPage(org.id, run.id, source.id, "https://acme.com/dup")
    await prisma.leadCandidate.create({
      data: candidateData(org.id, run.id, source.id, page.id, { companyName: "Acme Inc", companyDomain: "acme.com", email: "john@acme.com", contactFullName: "John Doe", normalizedCompanyName: "acme" }),
    })
    const org2 = await newOrg()
    const source2 = await newSource(org2.id)
    const run2 = await newRun(org2.id, source2.id)
    const page2 = await newRawPage(org2.id, run2.id, source2.id, "https://acme2.com/dup")
    await prisma.leadCandidate.create({
      data: candidateData(org2.id, run2.id, source2.id, page2.id, { companyName: "Acme Inc", companyDomain: "acme2.com", email: "john@acme.com", contactFullName: "John Doe", normalizedCompanyName: "acme" }),
    })

    const summary = await deduplicateRun(org.id, run.id)
    expect(summary.autoMatches).toBe(0)
    expect(summary.reviewMatches).toBe(0)
    expect(prisma.entityMatch.count({ where: { organizationId: org2.id } })).resolves.toBe(0)
  })

  it("auto-merges candidates sharing an email and merges their data", async () => {
    const org = await newOrg()
    const source = await newSource(org.id)
    const run = await newRun(org.id, source.id)
    const base = { organizationId: org.id, runId: run.id, sourceId: source.id, status: CandidateStatus.EXTRACTED }

    const a = await prisma.leadCandidate.create({
      data: {
        ...base,
        rawPageId: (await newRawPage(org.id, run.id, source.id, "https://acme.com/a")).id,
        companyName: "Acme Inc",
        companyDomain: "acme.com",
        normalizedCompanyName: "acme",
        email: "john@acme.com",
        contactFullName: "John Doe",
      },
    })
    const b = await prisma.leadCandidate.create({
      data: {
        ...base,
        rawPageId: (await newRawPage(org.id, run.id, source.id, "https://acme.com/b")).id,
        companyName: "Acme, Inc.",
        companyDomain: "acme.com",
        normalizedCompanyName: "acme",
        email: "JOHN@acme.com",
        contactFullName: null,
        phoneRaw: "+14155550134",
      },
    })

    const summary = await deduplicateRun(org.id, run.id)
    expect(summary.autoMatches).toBe(1)

    const [matches, groups] = await prisma.$transaction([
      prisma.entityMatch.findMany({ where: { organizationId: org.id } }),
      prisma.duplicateGroup.findMany({ where: { organizationId: org.id }, include: { members: true } }),
    ])
    expect(matches).toHaveLength(1)
    expect(matches[0].status).toBe(MatchStatus.AUTO_MATCH)
    expect(groups).toHaveLength(1)
    expect(groups[0].status).toBe("AUTO_MERGED")

    const merged = await prisma.leadCandidate.findMany({ where: { organizationId: org.id } })
    const ready = merged.find((c) => c.status === CandidateStatus.READY)
    const duplicate = merged.find((c) => c.status === CandidateStatus.DUPLICATE)
    expect(ready?.id).toBe(a.id)
    expect(ready?.companyName).toBe("Acme Inc")
    expect(duplicate?.id).toBe(b.id)

    const audit = await prisma.duplicateAuditEvent.findMany({ where: { organizationId: org.id } })
    expect(audit.map((e) => e.action)).toContain("AUTO_MERGED")
  })

  it("flags same company name with different domains for review, then confirm merges", async () => {
    const org = await newOrg()
    const source = await newSource(org.id)
    const run = await newRun(org.id, source.id)
    const base = { organizationId: org.id, runId: run.id, sourceId: source.id, status: CandidateStatus.EXTRACTED }

    const a = await prisma.leadCandidate.create({
      data: {
        ...base,
        rawPageId: (await newRawPage(org.id, run.id, source.id, "https://a.io/team")).id,
        companyName: "Acme Software",
        companyDomain: "a.io",
        normalizedCompanyName: "acme software",
        email: "jane@a.io",
        contactFullName: "Jane Doe",
      },
    })
    const b = await prisma.leadCandidate.create({
      data: {
        ...base,
        rawPageId: (await newRawPage(org.id, run.id, source.id, "https://b.co/team")).id,
        companyName: "Acme Software",
        companyDomain: "b.co",
        normalizedCompanyName: "acme software",
        email: "jane@b.co",
        contactFullName: null,
      },
    })

    const summary = await deduplicateRun(org.id, run.id)
    expect(summary.reviewMatches).toBe(1)
    expect(summary.autoMatches).toBe(0)

    const groups = await prisma.duplicateGroup.findMany({ where: { organizationId: org.id }, include: { members: true } })
    expect(groups).toHaveLength(1)
    expect(groups[0].entityType).toBe(EntityType.COMPANY)
    expect(groups[0].status).toBe("PENDING_REVIEW")

    const reviewer = { id: "reviewer-1", name: "Reviewer" }
    await confirmDuplicateGroup(org.id, groups[0].id, reviewer)

    const done = await prisma.duplicateGroup.findUnique({
      where: { id: groups[0].id },
      include: { members: true, auditEvents: true },
    })
    expect(done?.status).toBe("CONFIRMED")
    expect(done?.canonicalCandidateId).toBe(a.id)
    const events = done?.auditEvents.map((e) => e.action) ?? []
    expect(events).toContain("USER_CONFIRMED_DUPLICATE")
    expect(events).toContain("CANONICAL_SELECTED")
    const statuses = await prisma.leadCandidate.findMany({ where: { organizationId: org.id }, select: { id: true, status: true } })
    const byId = Object.fromEntries(statuses.map((s) => [s.id, s.status]))
    expect(byId[a.id]).toBe(CandidateStatus.READY)
    expect(byId[b.id]).toBe(CandidateStatus.DUPLICATE)
    expect(JSON.stringify(done?.conflicts)).toContain("jane@b.co")
  })

  it("records conflicts when member data disagrees", async () => {
    const org = await newOrg()
    const source = await newSource(org.id)
    const run = await newRun(org.id, source.id)
    const base = { organizationId: org.id, runId: run.id, sourceId: source.id, status: CandidateStatus.EXTRACTED }

    const a = await prisma.leadCandidate.create({
      data: {
        ...base,
        rawPageId: (await newRawPage(org.id, run.id, source.id, "https://x.io/1")).id,
        companyName: "Zenith Labs",
        companyDomain: "zenith-a.io",
        normalizedCompanyName: "zenith labs",
        email: "lena@a.io",
        contactFullName: "Lena Moon",
        phoneRaw: "+14155550134",
      },
    })
    const b = await prisma.leadCandidate.create({
      data: {
        ...base,
        rawPageId: (await newRawPage(org.id, run.id, source.id, "https://y.io/2")).id,
        companyName: "Zenith Labs",
        companyDomain: "zenith-b.io",
        normalizedCompanyName: "zenith labs",
        email: "lena@b.io",
      },
    })

    await deduplicateRun(org.id, run.id)
    const groups = await prisma.duplicateGroup.findMany({ where: { organizationId: org.id } })
    expect(groups).toHaveLength(1)
    await confirmDuplicateGroup(org.id, groups[0].id, { id: "u", name: "U" })
    const done = await prisma.duplicateGroup.findUnique({ where: { id: groups[0].id }, select: { conflicts: true } })
    expect(JSON.stringify(done?.conflicts)).toContain("lena@b.io")
    const statusA = await prisma.leadCandidate.findUnique({ where: { id: a.id }, select: { status: true } })
    const statusB = await prisma.leadCandidate.findUnique({ where: { id: b.id }, select: { status: true } })
    expect(statusA?.status).toBe(CandidateStatus.READY)
    expect(statusB?.status).toBe(CandidateStatus.DUPLICATE)
  })

  it("rejects a review group and does not re-group on re-run (anti-loop)", async () => {
    const org = await newOrg()
    const source = await newSource(org.id)
    const run = await newRun(org.id, source.id)
    const base = { organizationId: org.id, runId: run.id, sourceId: source.id, status: CandidateStatus.EXTRACTED }

    const a = await prisma.leadCandidate.create({
      data: {
        ...base,
        rawPageId: (await newRawPage(org.id, run.id, source.id, "https://m.io/1")).id,
        companyName: "Meridian Tools",
        companyDomain: "m.io",
        normalizedCompanyName: "meridian tools",
      },
    })
    await prisma.leadCandidate.create({
      data: {
        ...base,
        rawPageId: (await newRawPage(org.id, run.id, source.id, "https://n.co/2")).id,
        companyName: "Meridian Tools",
        companyDomain: "n.co",
        normalizedCompanyName: "meridian tools",
      },
    })

    const summary = await deduplicateRun(org.id, run.id)
    expect(summary.reviewMatches).toBe(1)

    const groups = await prisma.duplicateGroup.findMany({ where: { organizationId: org.id } })
    await rejectDuplicateGroup(org.id, groups[0].id, { id: "reviewer", name: "Reviewer" })
    const rejected = await prisma.duplicateGroup.findUnique({ where: { id: groups[0].id } })
    expect(rejected?.status).toBe("REJECTED")

    const matches = await prisma.entityMatch.findMany({ where: { organizationId: org.id } })
    expect(matches[0].status).toBe(MatchStatus.NOT_MATCH)

    await deduplicateRun(org.id, run.id)
    const after = await counts(org.id)
    expect(after[1]).toBe(1)
    const status = await prisma.leadCandidate.findUnique({ where: { id: a.id }, select: { status: true } })
    expect(status?.status).toBe(CandidateStatus.EXTRACTED)
  })

  it("is idempotent: re-running deduplication creates nothing new", async () => {
    const org = await newOrg()
    const source = await newSource(org.id)
    const run = await newRun(org.id, source.id)
    const base = { organizationId: org.id, runId: run.id, sourceId: source.id, status: CandidateStatus.EXTRACTED }

    const make = async (url: string, email: string) =>
      prisma.leadCandidate.create({
        data: {
          ...base,
          rawPageId: (await newRawPage(org.id, run.id, source.id, url)).id,
          companyName: "Idem Corp",
          companyDomain: "idem.com",
          normalizedCompanyName: "idem corp",
          email,
          contactFullName: "Person Name",
        },
      })
    await Promise.all([make("https://idem.com/a", "p1@idem.com"), make("https://idem.com/b", "p2@idem.com"), make("https://idem.com/c", "p3@idem.com")])

    const first = await deduplicateRun(org.id, run.id)
    const before = await counts(org.id)
    const second = await deduplicateRun(org.id, run.id)
    const after = await counts(org.id)

    expect(second.compared).toBe(0)
    expect(after[1]).toBe(3)
    expect(after[0]).toBe(before[0])
    expect(after[2]).toBe(before[2])
    expect(after[3]).toBe(3)
    expect(first.autoMatches).toBeGreaterThan(0)
  })

  it("resolves a single candidate incrementally", async () => {
    const org = await newOrg()
    const source = await newSource(org.id)
    const run = await newRun(org.id, source.id)
    const base = { organizationId: org.id, runId: run.id, sourceId: source.id, status: CandidateStatus.EXTRACTED }

    await prisma.leadCandidate.create({
      data: {
        ...base,
        rawPageId: (await newRawPage(org.id, run.id, source.id, "https://inc.io/1")).id,
        companyName: "Incremental Co",
        companyDomain: "inc.io",
        normalizedCompanyName: "incremental co",
        email: "first@inc.io",
      },
    })
    const fresh = await prisma.leadCandidate.create({
      data: {
        ...base,
        rawPageId: (await newRawPage(org.id, run.id, source.id, "https://inc.io/2")).id,
        companyName: "Incremental Co",
        companyDomain: "inc.io",
        normalizedCompanyName: "incremental co",
        email: "second@inc.io",
      },
    })

    const summary = await resolveCandidate(org.id, fresh.id)
    expect(summary.processed).toBe(1)
    expect(summary.autoMatches).toBe(1)
    const groups = await prisma.duplicateGroup.findMany({ where: { organizationId: org.id } })
    expect(groups).toHaveLength(1)
  })
})