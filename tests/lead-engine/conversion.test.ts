// TASK 010 §62-§66: candidate → CRM conversion tests. Real database.

import { describe, expect, it, afterAll } from "vitest"
import { prisma } from "@/lib/db"
import { LeadSourceType, ScraperRunStatus, CandidateStatus, EntityType, DuplicateGroupStatus } from "@/generated/prisma/enums"
import { convertCandidate, bulkConvert, canConvertCandidate } from "@/lib/lead-engine/conversion/service"

const orgIds: string[] = []

const newOrg = async () => {
  const org = await prisma.organization.create({
    data: { name: `Conversion Test Org ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  })
  orgIds.push(org.id)
  return org
}

const newSource = (orgId: string) =>
  prisma.leadSource.create({
    data: {
      name: `Conv Source ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      slug: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

const newCandidate = async (orgId: string, url: string, over: Record<string, unknown>) => {
  const source = await newSource(orgId)
  const run = await newRun(orgId, source.id)
  const page = await newRawPage(orgId, run.id, source.id, url)
  return prisma.leadCandidate.create({
    data: {
      organizationId: orgId,
      runId: run.id,
      sourceId: source.id,
      rawPageId: page.id,
      status: CandidateStatus.EXTRACTED,
      companyName: null,
      companyDomain: null,
      email: null,
      contactFullName: null,
      normalizedCompanyName: null,
      ...over,
    },
  })
}

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
  await prisma.$disconnect()
})

describe("conversion", () => {
  it("creates company, contact and lead with provenance on first conversion", async () => {
    const org = await newOrg()
    const candidate = await newCandidate(org.id, "https://acme.com/team", {
      companyName: "Acme Inc",
      companyDomain: "acme.com",
      contactFullName: "Jane Smith",
      contactJobTitle: "CTO",
      email: "jane@acme.com",
      normalizedCompanyName: "acme",
    })

    const result = await convertCandidate(org.id, candidate.id)
    if (!result.ok) expect(result).toEqual({ ok: "see below" })
    expect(result.ok).toBe(true)
    expect(result.companyAction).toBe("CREATE")
    expect(result.contactAction).toBe("CREATE")

    const counts = {
      companies: await prisma.company.count({ where: { organizationId: org.id } }),
      contacts: await prisma.contact.count({ where: { organizationId: org.id } }),
      leads: await prisma.lead.count({ where: { organizationId: org.id } }),
    }
    expect(counts).toEqual({ companies: 1, contacts: 1, leads: 1 })

    const lead = await prisma.lead.findFirst({ where: { organizationId: org.id } })
    expect(lead).toMatchObject({
      source: "SCRAPER",
      sourceCandidateId: candidate.id,
      title: "Acme Inc — Jane Smith",
      companyId: result.conversion?.companyId,
      contactId: result.conversion?.contactId,
    })
    expect(lead?.notes).toContain("acme.com")
    expect(lead?.notes).toContain("Source: https://acme.com/team")

    const updated = await prisma.leadCandidate.findUnique({ where: { id: candidate.id } })
    expect(updated?.status).toBe(CandidateStatus.CONVERTED)
    const conversion = await prisma.leadCandidateConversion.findFirst({ where: { organizationId: org.id } })
    expect(conversion?.status).toBe("CONVERTED")
    expect(conversion?.leadId).toBe(lead?.id)
    expect(conversion?.candidateId).toBe(candidate.id)

    const activity = await prisma.activity.count({ where: { organizationId: org.id, leadId: lead?.id } })
    expect(activity).toBe(1)
  })

  it("is idempotent: second conversion reuses entities and returns ALREADY_CONVERTED", async () => {
    const org = await newOrg()
    const candidate = await newCandidate(org.id, "https://acme.com/two", {
      companyName: "Acme Inc",
      companyDomain: "acme.com",
      contactFullName: "Jane Smith",
      email: "jane@acme.com",
    })

    const first = await convertCandidate(org.id, candidate.id)
    if (!first.ok) throw new Error("FIRST: " + JSON.stringify(first))
    const second = await convertCandidate(org.id, candidate.id)
    expect(second.ok).toBe(true)
    expect(second.code).toBe("ALREADY_CONVERTED")
    expect(second.conversion?.leadId).toBe(first.conversion?.leadId)

    const counts = {
      companies: await prisma.company.count({ where: { organizationId: org.id } }),
      contacts: await prisma.contact.count({ where: { organizationId: org.id } }),
      leads: await prisma.lead.count({ where: { organizationId: org.id } }),
    }
    expect(counts).toEqual({ companies: 1, contacts: 1, leads: 1 })
  })

  it("reuses existing companies, contacts and leads on re-import", async () => {
    const org = await newOrg()
    const a = await newCandidate(org.id, "https://acme.com/first", {
      companyName: "Acme Inc",
      companyDomain: "acme.com",
      contactFullName: "Jane Smith",
      email: "jane@acme.com",
    })
    const first = await convertCandidate(org.id, a.id)

    const b = await newCandidate(org.id, "https://acme.com/second", {
      companyName: "Acme Inc",
      companyDomain: "acme.com",
      contactFullName: "Jane Smith",
      email: "jane@acme.com",
    })
    const second = await convertCandidate(org.id, b.id)
    expect(second.ok).toBe(true)
    expect(second.companyAction).toBe("REUSE")
    expect(second.contactAction).toBe("REUSE")
    expect(second.conversion?.leadId).toBe(first.conversion?.leadId)

    const counts = {
      companies: await prisma.company.count({ where: { organizationId: org.id } }),
      contacts: await prisma.contact.count({ where: { organizationId: org.id } }),
      leads: await prisma.lead.count({ where: { organizationId: org.id } }),
    }
    expect(counts).toEqual({ companies: 1, contacts: 1, leads: 1 })
    expect(await prisma.leadCandidate.count({ where: { organizationId: org.id, status: CandidateStatus.CONVERTED } })).toBe(2)
  })

  it("fails with NOT_ELIGIBLE/INSUFFICIENT_DATA and records a FAILED conversion row", async () => {
    const org = await newOrg()
    const candidate = await newCandidate(org.id, "https://empty.com/", {})
    const gate = canConvertCandidate({ status: CandidateStatus.EXTRACTED, companyName: null, companyDomain: null, contactFullName: null, email: null, linkedinUrl: null, phone: null, phoneRaw: null } as never)

    expect(canConvertCandidate(candidate).eligible).toBe(false)
    expect(canConvertCandidate(candidate).code).toBe("INSUFFICIENT_DATA")
    expect(gate.eligible).toBe(false)
    expect(gate.code).toBe("INSUFFICIENT_DATA")

    const result = await convertCandidate(org.id, candidate.id)
    expect(result.ok).toBe(false)
    expect(result.code).toBe("INSUFFICIENT_DATA")
    expect(await prisma.leadCandidateConversion.count({ where: { organizationId: org.id } })).toBe(0)

    const failed = await newCandidate(org.id, "https://sparse.com/", { companyName: "Sparse Co" })
    await prisma.leadCandidate.update({ where: { id: failed.id }, data: { status: CandidateStatus.FAILED } })
    const blocked = await convertCandidate(org.id, failed.id)
    expect(blocked.ok).toBe(false)
    expect(blocked.code).toBe("NOT_ELIGIBLE")
    expect(await prisma.leadCandidateConversion.count({ where: { organizationId: org.id } })).toBe(0)
  })

  it("keeps conversions scoped to the calling organization", async () => {
    const orgA = await newOrg()
    const orgB = await newOrg()
    const candidate = await newCandidate(orgA.id, "https://acme.com/scope", {
      companyName: "Acme Inc",
      companyDomain: "acme.com",
      contactFullName: "Jane Smith",
      email: "jane@acme.com",
    })

    const result = await convertCandidate(orgB.id, candidate.id)
    expect(result.ok).toBe(false)
    expect(result.code).toBe("CANDIDATE_NOT_FOUND")
    expect(await prisma.leadCandidateConversion.count({ where: { organizationId: orgA.id } })).toBe(0)
  })

  it("blocks ambiguous company matches and records a FAILED conversion row", async () => {
    const org = await newOrg()
    await prisma.company.create({ data: { organizationId: org.id, name: "First Acme", domain: "firstacme.com", normalizedName: "acme" } })
    await prisma.company.create({ data: { organizationId: org.id, name: "Second Acme", domain: "secondacme.com", normalizedName: "acme" } })

    const candidate = await newCandidate(org.id, "https://acme.com/ambig", {
      companyName: "Acme",
      normalizedCompanyName: "acme",
      contactFullName: "Jane Smith",
      email: "jane@acme.com",
    })
    const result = await convertCandidate(org.id, candidate.id)
    expect(result.ok).toBe(false)
    expect(result.code).toBe("AMBIGUOUS_COMPANY")

    const conversion = await prisma.leadCandidateConversion.findFirst({ where: { organizationId: org.id } })
    expect(conversion?.status).toBe("FAILED")
    expect(conversion?.errorMessage).toContain("AMBIGUOUS_COMPANY")
    expect(await prisma.lead.count({ where: { organizationId: org.id } })).toBe(0)
    expect(await prisma.contact.count({ where: { organizationId: org.id } })).toBe(0)
  })

  it("converts duplicate candidates through their canonical counterpart", async () => {
    const org = await newOrg()
    const canonical = await newCandidate(org.id, "https://acme.com/canon", {
      companyName: "Acme Inc",
      companyDomain: "acme.com",
      contactFullName: "Jane Smith",
      email: "jane@acme.com",
    })
    const duplicate = await newCandidate(org.id, "https://acme.com/dup", {
      companyName: "Acme Inc",
      companyDomain: "acme.com",
      contactFullName: "Jane Smith",
      email: "jane@acme.com",
      status: CandidateStatus.DUPLICATE,
    })
    await prisma.duplicateGroup.create({
      data: {
        organizationId: org.id,
        entityType: EntityType.COMPANY,
        status: DuplicateGroupStatus.CONFIRMED,
        canonicalCandidateId: canonical.id,
        members: {
          create: [
            { organizationId: org.id, candidateId: canonical.id },
            { organizationId: org.id, candidateId: duplicate.id },
          ],
        },
      },
    })

    const result = await convertCandidate(org.id, duplicate.id)
    expect(result.ok).toBe(true)
    expect(result.conversion?.leadId).toBeTruthy()

    const conversions = await prisma.leadCandidateConversion.findMany({ where: { organizationId: org.id } })
    expect(conversions).toHaveLength(2)
    expect(conversions.map((c) => c.candidateId).sort()).toEqual([canonical.id, duplicate.id].sort())
    expect(conversions.every((c) => c.leadId === result.conversion?.leadId)).toBe(true)

    const [c1, c2] = await Promise.all([
      prisma.leadCandidate.findUnique({ where: { id: canonical.id } }),
      prisma.leadCandidate.findUnique({ where: { id: duplicate.id } }),
    ])
    expect(c1?.status).toBe(CandidateStatus.CONVERTED)
    expect(c2?.status).toBe(CandidateStatus.CONVERTED)
    expect(await prisma.lead.count({ where: { organizationId: org.id } })).toBe(1)
  })

  it("keeps exactly one company when two conversions race (unique anchor)", async () => {
    const org = await newOrg()
    const candidate = await newCandidate(org.id, "https://acme.com/race", {
      companyName: "Acme Inc",
      companyDomain: "acme.com",
      contactFullName: "Jane Smith",
      email: "jane@acme.com",
    })

    const results = await Promise.allSettled([convertCandidate(org.id, candidate.id), convertCandidate(org.id, candidate.id)])
    const okResults = results.filter((r) => r.status === "fulfilled" && (r as PromiseFulfilledResult<Awaited<ReturnType<typeof convertCandidate>>>).value.ok)
    expect(okResults.length).toBeGreaterThanOrEqual(1)
    expect(await prisma.company.count({ where: { organizationId: org.id } })).toBe(1)
    expect(await prisma.lead.count({ where: { organizationId: org.id } })).toBe(1)
    expect(await prisma.leadCandidateConversion.count({ where: { organizationId: org.id } })).toBe(1)
  })

  it("bulk-converts 100 mixed candidates with accurate summary", async () => {
    const org = await newOrg()
    const ids: string[] = []
    for (let i = 0; i < 100; i++) {
      const candidate = await newCandidate(org.id, `https://company${i}.com/`, {
        companyName: `Company ${i}`,
        companyDomain: `company${i}.com`,
        contactFullName: `Person ${i}`,
        email: `person${i}@company${i}.com`,
      })
      ids.push(candidate.id)
    }
    const already = await newCandidate(org.id, "https://company0.com/again", {
      companyName: "Company 0",
      companyDomain: "company0.com",
      contactFullName: "Person 0",
      email: "person0@company0.com",
    })
    ids.push(already.id)
    const empty = await newCandidate(org.id, "https://empty.io/", {})
    ids.push(empty.id)

    const summary = await bulkConvert(org.id, ids)
    expect(summary.selected).toBe(102)
    expect(summary.converted).toBe(101)
    expect(summary.alreadyConverted).toBe(0)
    expect(summary.skipped).toBe(1)
    expect(summary.failed).toHaveLength(1)

    expect(await prisma.company.count({ where: { organizationId: org.id } })).toBe(100)
    expect(await prisma.lead.count({ where: { organizationId: org.id } })).toBe(100)
    expect(await prisma.leadCandidate.count({ where: { organizationId: org.id, status: CandidateStatus.CONVERTED } })).toBe(101)
  })
})