// TASK 013 §13-§21: enrichment service integration — real database + real local fixture site.

import { describe, expect, it, afterAll, beforeAll } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { prisma } from "@/lib/db"
import { CandidateStatus, EnrichmentConflictStatus, EnrichmentRequestStatus, EnrichmentResultStatus, ScoreStatus, LeadStatus, ConflictResolution, LeadSourceType, ScraperRunStatus } from "@/generated/prisma/enums"
import { requestEnrichment, runEnrichmentJob, getRequest, resolveConflict, retryEnrichment, bulkEnrich, bulkPreview } from "@/lib/lead-engine/enrichment/service"

const orgIds: string[] = []

const newOrg = async () => {
  const org = await prisma.organization.create({
    data: { name: `Enrichment Test Org ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  })
  orgIds.push(org.id)
  return org.id
}

const newActor = async (orgId: string) => {
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: `Enr User ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, email: `enr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`, passwordHash: "test", role: "MEMBER" },
  })
  return { id: user.id, name: user.name }
}

const newCandidate = async (orgId: string, over: Record<string, unknown> = {}) => {
  const source = await prisma.leadSource.create({
    data: { name: `Enr Source ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, slug: `enr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type: LeadSourceType.CUSTOM, organizationId: orgId, config: {} },
  })
  const run = await prisma.scraperRun.create({ data: { organizationId: orgId, sourceId: source.id, status: ScraperRunStatus.COMPLETED } })
  const page = await prisma.rawPage.create({ data: { organizationId: orgId, runId: run.id, sourceId: source.id, url: "http://fixture", statusCode: 200, html: "<html></html>", textContent: "", fetchedAt: new Date() } })
  return prisma.leadCandidate.create({
    data: {
      organizationId: orgId,
      runId: run.id,
      sourceId: source.id,
      rawPageId: page.id,
      status: CandidateStatus.EXTRACTED,
      companyName: "Acme Corp",
      companyDomain: null,
      email: null,
      contactFullName: null,
      normalizedCompanyName: "acme corp",
      ...over,
    },
  })
}

let server: http.Server
let baseUrl = ""

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "/"
    if (url === "/robots.txt") {
      res.setHeader("content-type", "text/plain")
      res.end("User-agent: *\nDisallow: /private\n")
      return
    }
    res.setHeader("content-type", "text/html")
    if (url === "/about") {
      res.end(
        `<html><head><title>About Acme Corp</title><meta name="description" content="Acme Corp builds project management software for remote teams."></head>
        <body><h1>About us</h1><p>Acme Corp builds saas and software platforms for remote teams.</p><a href="tel:+14155550123">+1 415 555 0123</a></body></html>`,
      )
      return
    }
    res.end(
      `<html><head><title>Acme Corp — Software for teams</title>
      <meta name="description" content="Acme Corp builds project management software for remote teams.">
      <meta name="keywords" content="saas, project management">
      <script type="application/ld+json">{"@type":"Organization","name":"Acme Corp","address":{"addressCountry":"US","addressRegion":"CA","addressLocality":"San Francisco"}}</script></head>
      <body><h1>Acme Corp</h1><p>Acme Corp builds saas and software platforms for remote teams.</p>
      <a href="tel:+14155550123">+1 415 555 0123</a><a href="/about">About</a><img src="/wp-content/uploads/logo.png"></body></html>`,
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.ALLOW_PRIVATE_NETWORK_TARGETS = "true"
})

afterAll(async () => {
  process.env.ALLOW_PRIVATE_NETWORK_TARGETS = "false"
  server.close()
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
  await prisma.$disconnect()
})

describe("enrichment service", () => {
  it("enriches a candidate end to end and applies fields", async () => {
    const orgId = await newOrg()
    const actor = await newActor(orgId)
    const candidate = await newCandidate(orgId, { websiteUrl: baseUrl })

    const result = await requestEnrichment(orgId, actor, { candidateId: candidate.id })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    await runEnrichmentJob(result.id)
    const request = await getRequest(orgId, result.id)
    expect(request?.status).toBe(EnrichmentRequestStatus.COMPLETED)
    expect(request?.pagesVisited).toBeGreaterThan(0)
    expect(request?.fieldsFound).toBeGreaterThan(0)
    expect(request?.fieldsUpdated).toBeGreaterThan(0)

    const updated = await prisma.leadCandidate.findUnique({ where: { id: candidate.id } })
    expect(updated?.description).toContain("project management software")
    expect(updated?.industry).toBe("SaaS")
    expect(updated?.country).toBe("US")
    expect(updated?.websiteUrl).toBe(baseUrl)

    const results = await prisma.enrichmentResult.findMany({ where: { organizationId: orgId, candidateId: candidate.id } })
    expect(results.length).toBe(request?.fieldsFound)
    const acceptedStatuses = new Set<EnrichmentResultStatus>([EnrichmentResultStatus.NEW, EnrichmentResultStatus.CONFIRMED])
    expect(results.every((r) => acceptedStatuses.has(r.status))).toBe(true)  })

  it("is idempotent: a forced re-run confirms existing values and updates nothing", async () => {
    const orgId = await newOrg()
    const actor = await newActor(orgId)
    const candidate = await newCandidate(orgId, { websiteUrl: baseUrl })

    const first = await requestEnrichment(orgId, actor, { candidateId: candidate.id })
    if (!first.ok) throw new Error("first request failed")
    await runEnrichmentJob(first.id)

    const second = await requestEnrichment(orgId, actor, { candidateId: candidate.id })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.skipped).toBe("RECENT")

    const forced = await requestEnrichment(orgId, actor, { candidateId: candidate.id, force: true })
    if (!forced.ok) throw new Error("forced request failed")
    await runEnrichmentJob(forced.id)
    const request = await getRequest(orgId, forced.id)
    expect(request?.status).toBe(EnrichmentRequestStatus.COMPLETED)
    expect(request?.fieldsFound).toBeGreaterThan(0)
    expect(request?.fieldsUpdated).toBe(0)

    const rows = await prisma.enrichmentResult.findMany({
      where: { organizationId: orgId, candidateId: candidate.id, field: "description" },
      orderBy: { observedAt: "asc" },
    })
    expect(rows.length).toBe(1)
    expect(rows[0].status).toBe(EnrichmentResultStatus.NEW)
    expect(rows[0].status).not.toBe(EnrichmentResultStatus.STALE)
  })

  it("keeps enrichment scoped to the calling organization", async () => {
    const orgA = await newOrg()
    const orgB = await newOrg()
    const actor = await newActor(orgB)
    const candidate = await newCandidate(orgA, { websiteUrl: baseUrl })
    const result = await requestEnrichment(orgB, actor, { candidateId: candidate.id })
    expect(result.ok).toBe(false)
  })

  it("creates a conflict for a differing existing value and resolves it", async () => {
    const orgId = await newOrg()
    const actor = await newActor(orgId)
    const candidate = await newCandidate(orgId, { websiteUrl: baseUrl, description: "Old description from an earlier run" })

    const result = await requestEnrichment(orgId, actor, { candidateId: candidate.id })
    if (!result.ok) throw new Error("request failed")
    await runEnrichmentJob(result.id)

    const conflicts = await prisma.enrichmentConflict.findMany({ where: { organizationId: orgId, candidateId: candidate.id } })
    expect(conflicts.length).toBeGreaterThan(0)
    const descriptionConflict = conflicts.find((c) => c.field === "description")
    expect(descriptionConflict?.existingValue).toContain("Old description")
    expect(descriptionConflict?.status).toBe(EnrichmentConflictStatus.OPEN)

    const resolved = await resolveConflict(orgId, descriptionConflict!.id, ConflictResolution.ACCEPT_NEW, actor)
    expect(resolved.ok).toBe(true)

    const updated = await prisma.leadCandidate.findUnique({ where: { id: candidate.id } })
    expect(updated?.description).toContain("project management software")
    const after = await prisma.enrichmentConflict.findUnique({ where: { id: descriptionConflict!.id } })
    expect(after?.status).toBe(EnrichmentConflictStatus.RESOLVED)
    expect(after?.resolution).toBe(ConflictResolution.ACCEPT_NEW)
    const row = await prisma.enrichmentResult.findFirst({ where: { organizationId: orgId, candidateId: candidate.id, field: "description" } })
    expect(row?.status).toBe(EnrichmentResultStatus.CONFIRMED)
  })

  it("marks candidate scores stale after a successful enrichment", async () => {
    const orgId = await newOrg()
    const actor = await newActor(orgId)
    const candidate = await newCandidate(orgId, { websiteUrl: baseUrl })
    await prisma.leadScore.create({
      data: { organizationId: orgId, candidateId: candidate.id, source: "CRM", modelVersion: "test", icpScore: 60, overallScore: 70, qualification: "GOOD", scoreStatus: ScoreStatus.CURRENT, scoreBreakdown: {}, reasons: [] },
    })

    const result = await requestEnrichment(orgId, actor, { candidateId: candidate.id })
    if (!result.ok) throw new Error("request failed")
    await runEnrichmentJob(result.id)

    const score = await prisma.leadScore.findFirst({ where: { organizationId: orgId, candidateId: candidate.id }, orderBy: { scoredAt: "desc" } })
    expect(score?.scoreStatus).toBe(ScoreStatus.STALE)
  })

  it("enriches a CRM lead through its company website", async () => {
    const orgId = await newOrg()
    const actor = await newActor(orgId)
    const company = await prisma.company.create({
      data: { organizationId: orgId, name: "Acme Corp", normalizedName: "acme corp", website: baseUrl },
    })
    const lead = await prisma.lead.create({
      data: { organizationId: orgId, companyId: company.id, title: "Acme — Sales", status: LeadStatus.NEW },
    })

    const result = await requestEnrichment(orgId, actor, { leadId: lead.id })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    await runEnrichmentJob(result.id)

    const request = await getRequest(orgId, result.id)
    expect(request?.status).toBe(EnrichmentRequestStatus.COMPLETED)
    expect(request?.fieldsUpdated).toBeGreaterThan(0)
    const updated = await prisma.company.findUnique({ where: { id: company.id } })
    expect(updated?.description).toContain("project management software")
    expect(updated?.industry).toBe("SaaS")
  })

  it("bulk-enriches a mixed batch with accurate counts", async () => {
    const orgId = await newOrg()
    const actor = await newActor(orgId)
    const fresh = await newCandidate(orgId, { websiteUrl: baseUrl })
    const missing = await newCandidate(orgId, { companyName: "No Website Co", normalizedCompanyName: "no website co" })
    const stale = await newCandidate(orgId, { websiteUrl: baseUrl })
    const r = await requestEnrichment(orgId, actor, { candidateId: stale.id })
    if (!r.ok) throw new Error("seed request failed")
    await runEnrichmentJob(r.id)

    const preview = await bulkPreview(orgId, [fresh.id, missing.id, stale.id])
    expect(preview.missingWebsite).toBe(1)
    expect(preview.recentlyEnriched).toBe(1)
    expect(preview.queued).toBe(1)

    const summary = await bulkEnrich(orgId, actor, [fresh.id, missing.id, stale.id])
    expect(summary.queued).toBe(1)
    expect(summary.ineligible).toBe(1)
    expect(summary.skippedRecent).toBe(1)
  })

  it("fails on an unreachable site and retries up to the cap", async () => {
    const orgId = await newOrg()
    const actor = await newActor(orgId)
    const candidate = await newCandidate(orgId, { websiteUrl: "http://127.0.0.1:1/" })

    const result = await requestEnrichment(orgId, actor, { candidateId: candidate.id })
    if (!result.ok) throw new Error("request failed")
    await runEnrichmentJob(result.id)
    const request = await getRequest(orgId, result.id)
    expect(request?.status).toBe(EnrichmentRequestStatus.FAILED)
    expect(request?.errorCode).toBeTruthy()

    const retried = await retryEnrichment(orgId, request!.id, actor)
    expect(retried.ok).toBe(true)
    const queued = await getRequest(orgId, request!.id)
    expect(queued?.status).toBe(EnrichmentRequestStatus.QUEUED)
    expect(queued?.retries).toBe(1)

    await runEnrichmentJob(request!.id)
    const failedAgain = await getRequest(orgId, request!.id)
    expect(failedAgain?.status).toBe(EnrichmentRequestStatus.FAILED)
    expect(failedAgain?.retries).toBe(1)

    const second = await retryEnrichment(orgId, request!.id, actor)
    expect(second.ok).toBe(true)
    const retriedTwice = await getRequest(orgId, request!.id)
    expect(retriedTwice?.retries).toBe(2)

    await runEnrichmentJob(request!.id)
    const capped = await retryEnrichment(orgId, request!.id, actor)
    expect(capped.ok).toBe(false)
    const final = await getRequest(orgId, request!.id)
    expect(final?.retries).toBe(2)
  })
})