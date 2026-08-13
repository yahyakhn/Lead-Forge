// TASK 014 §10-§38, §52-§53: email discovery + verification — real database,
// fake DNS. No external network calls; verification provider is unit-tested
// with an injected resolver and the job pipeline is driven through a
// registered deterministic TEST provider.

import { describe, expect, it, afterAll } from "vitest"
import { prisma } from "@/lib/db"
import { CandidateStatus, EmailConflictResolution, EmailDiscoveryJobStatus, EmailStatus, EmailVerificationJobStatus, EmailVerificationBatchStatus, LeadSourceType, ScraperRunStatus, EmailType, EmailDomainMatch } from "@/generated/prisma/enums"
import {
  requestEmailDiscovery,
  runEmailDiscoveryJob,
  listEntityEmails,
  requestEmailVerification,
  runEmailVerificationJob,
  applyVerificationResult,
  effectiveStatus,
  bulkVerify,
  runEmailVerificationBatch,
  setPrimaryEmail,
  markEmailInvalid,
  removeEmail,
  listOpenEmailConflicts,
  resolveEmailConflict,
  retryEmailDiscovery,
  cancelEmailDiscovery,
  updateSettings,
  emailQueueCounts,
} from "@/lib/lead-engine/email/service"
import { registerEmailProvider } from "@/lib/lead-engine/email/providers/registry"
import type { EmailProvider } from "@/lib/lead-engine/email/providers/types"
import { requestEnrichment } from "@/lib/lead-engine/enrichment/service"
import { internalVerificationProvider } from "@/lib/lead-engine/email/providers/internal-verification"
import type { DnsResolver } from "@/lib/lead-engine/email/providers/internal-verification"
import { calculateReadiness, persistReadiness, latestReadiness, READINESS_VERSION } from "@/lib/lead-engine/email/readiness"
import { normalizeEmailAddress, classifyEmailType, domainMatch, isRolePrefix, isDisposableDomain } from "@/lib/lead-engine/email/normalize"

const orgIds: string[] = []

const newOrg = async () => {
  const org = await prisma.organization.create({
    data: { name: `Email Test Org ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  })
  orgIds.push(org.id)
  return org.id
}

const newActor = async (orgId: string) => {
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: `Em User ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, email: `em-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`, passwordHash: "test", role: "MEMBER" },
  })
  return { id: user.id, name: user.name }
}

const newCandidate = async (orgId: string, over: Record<string, unknown> = {}) => {
  const source = await prisma.leadSource.create({
    data: { name: `Em Source ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, slug: `em-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type: LeadSourceType.CUSTOM, organizationId: orgId, config: {} },
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
      companyDomain: "acme-test.local",
      websiteUrl: "http://acme-test.local",
      email: null,
      contactFullName: "Jane Doe",
      normalizedCompanyName: "acme corp",
      ...over,
    },
  })
}

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
  await prisma.$disconnect()
})

// ── pure normalization ────────────────────────────────────────────────────

describe("email normalization", () => {
  it("normalizes case and whitespace, rejects garbage", () => {
    expect(normalizeEmailAddress("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com")
    expect(normalizeEmailAddress("not an email")).toBeNull()
    expect(normalizeEmailAddress("a@b")).toBeNull()
  })

  it("classifies role prefixes, generic domains and types", () => {
    expect(isRolePrefix("sales")).toBe(true)
    expect(isRolePrefix("sales+extra")).toBe(true)
    expect(isRolePrefix("jane")).toBe(false)
    expect(isDisposableDomain("mailinator.com")).toBe(true)
    expect(isDisposableDomain("acme.com")).toBe(false)
    expect(classifyEmailType("jane", "acme.com")).toBe(EmailType.PERSONAL_BUSINESS)
    expect(classifyEmailType("sales", "acme.com")).toBe(EmailType.ROLE_BASED)
    expect(classifyEmailType("jane", "gmail.com")).toBe(EmailType.GENERIC)
  })

  it("computes domain match without ever invalidating generic domains", () => {
    expect(domainMatch("jane@acme.com", "acme.com")).toBe(EmailDomainMatch.DOMAIN_MATCH)
    expect(domainMatch("jane@acme.co.uk", "www.acme.co.uk")).toBe(EmailDomainMatch.DOMAIN_MATCH)
    expect(domainMatch("jane@gmail.com", "acme.com")).toBe(EmailDomainMatch.GENERIC_DOMAIN)
    expect(domainMatch("jane@other.com", "acme.com")).toBe(EmailDomainMatch.DOMAIN_MISMATCH)
    expect(domainMatch("jane@acme.com", null)).toBe(EmailDomainMatch.NOT_APPLICABLE)
  })
})

// ── verification provider with injected DNS ───────────────────────────────

const fakeResolver: DnsResolver = {
  async lookup(hostname) {
    if (hostname === "good.test") return ["192.0.2.1"]
    throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" })
  },
  async resolveMx(hostname) {
    if (hostname === "good.test") return [{ exchange: "mail.good.test", priority: 10 }]
    throw Object.assign(new Error("ENODATA"), { code: "ENODATA" })
  },
}

describe("internal verification provider", () => {
  it("VERIFIED when domain + MX resolve", async () => {
    const result = await internalVerificationProvider.verify("jane@good.test", { resolver: fakeResolver })
    expect(result.status).toBe("VERIFIED")
    expect(result.mxPresent).toBe(true)
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it("INVALID when domain does not exist, never SMTP, never guesses", async () => {
    const result = await internalVerificationProvider.verify("jane@missing.test", { resolver: fakeResolver })
    expect(result.status).toBe("INVALID")
    expect(result.domainValid).toBe(false)
  })

  it("syntax failure is INVALID with zero confidence", async () => {
    const result = await internalVerificationProvider.verify("not-an-email", { resolver: fakeResolver })
    expect(result.status).toBe("INVALID")
    expect(result.syntaxValid).toBe(false)
    expect(result.confidence).toBe(0)
  })
})

// ── deterministic pipeline provider (no DNS in job path) ──────────────────

const testVerificationProvider: EmailProvider = {
  id: "TEST_PIPE",
  name: "Test pipeline provider",
  capabilities: ["VERIFICATION"],
  async verify() {
    return {
      email: "jane@acme-test.local",
      syntaxValid: true,
      domainValid: true,
      mxPresent: true,
      disposable: false,
      roleBased: false,
      status: "VERIFIED",
      confidence: 0.9,
      checkedAt: new Date(),
      provider: "TEST_PIPE",
    }
  },
}
registerEmailProvider(testVerificationProvider)

// ── discovery integration ─────────────────────────────────────────────────

describe("email discovery (existing evidence)", () => {
  it("discovers an email from enrichment evidence, sets primary, mirrors it", async () => {
    const orgId = await newOrg()
    const actor = await newActor(orgId)
    const candidate = await newCandidate(orgId, { email: null, extractionConfidence: 0.9 })
    const enriched = await requestEnrichment(orgId, null, { candidateId: candidate.id })
    expect(enriched.ok).toBe(true)
    await prisma.enrichmentResult.create({
      data: { organizationId: orgId, candidateId: candidate.id, requestId: (enriched as { id: string }).id, field: "email", value: "jane.doe@acme-test.local", source: "WEBSITE", status: "NEW", confidence: 0.9, method: "TEST" },
    })

    const request = await requestEmailDiscovery(orgId, actor, { candidateId: candidate.id })
    expect(request.ok).toBe(true)
    await runEmailDiscoveryJob((request as { id: string }).id)

    const job = await prisma.emailDiscoveryJob.findUnique({ where: { id: (request as { id: string }).id } })
    expect(job?.status).toBe(EmailDiscoveryJobStatus.COMPLETED)
    expect(job?.emailsFound).toBe(1)

    const emails = await listEntityEmails(orgId, { candidateId: candidate.id })
    expect(emails).toHaveLength(1)
    expect(emails[0].email).toBe("jane.doe@acme-test.local")
    expect(emails[0].status).toBe(EmailStatus.DISCOVERED)
    expect(emails[0].isPrimary).toBe(true)
    expect(emails[0].type).toBe(EmailType.PERSONAL_BUSINESS)
    expect(emails[0].domainMatch).toBe(EmailDomainMatch.DOMAIN_MATCH)

    const mirrored = await prisma.leadCandidate.findUnique({ where: { id: candidate.id } })
    expect(mirrored?.email).toBe("jane.doe@acme-test.local")
  })

  it("skips RECENT and ACTIVE runs, dedupes evidence", async () => {
    const orgId = await newOrg()
    const actor = await newActor(orgId)
    const candidate = await newCandidate(orgId, { email: "jane.doe@acme-test.local" })

    const first = await requestEmailDiscovery(orgId, actor, { candidateId: candidate.id })
    await runEmailDiscoveryJob((first as { id: string }).id)
    const again = await requestEmailDiscovery(orgId, actor, { candidateId: candidate.id })
    expect(again).toEqual({ ok: true, id: expect.any(String), skipped: "RECENT" })

    const emails = await listEntityEmails(orgId, { candidateId: candidate.id })
    expect(emails).toHaveLength(1)
  })

  it("creates an OPEN conflict when discovered email differs from the primary", async () => {
    const orgId = await newOrg()
    const actor = await newActor(orgId)
    const source = await prisma.leadSource.create({ data: { name: `Cf Src ${Date.now()}`, slug: `cf-${Date.now()}`, type: LeadSourceType.CUSTOM, organizationId: orgId, config: {} } })
    const run = await prisma.scraperRun.create({ data: { organizationId: orgId, sourceId: source.id, status: ScraperRunStatus.COMPLETED } })
    const page = await prisma.rawPage.create({ data: { organizationId: orgId, runId: run.id, sourceId: source.id, url: "http://fixture", statusCode: 200, html: "", textContent: "", fetchedAt: new Date() } })
    const candidate = await prisma.leadCandidate.create({
      data: { organizationId: orgId, runId: run.id, sourceId: source.id, rawPageId: page.id, status: CandidateStatus.EXTRACTED, companyName: "Conflict Co", companyDomain: "conflict.test", websiteUrl: "http://conflict.test", email: "sales@conflict.test", contactFullName: null, normalizedCompanyName: "conflict co" },
    })
    const enriched = await requestEnrichment(orgId, null, { candidateId: candidate.id })
    expect(enriched.ok).toBe(true)
    await prisma.enrichmentResult.create({
      data: { organizationId: orgId, candidateId: candidate.id, requestId: (enriched as { id: string }).id, field: "email", value: "jane@conflict.test", source: "WEBSITE", status: "NEW", confidence: 0.9, method: "TEST" },
    })

    const request = await requestEmailDiscovery(orgId, actor, { candidateId: candidate.id })
    expect(request.ok).toBe(true)
    await runEmailDiscoveryJob((request as { id: string }).id)

    const conflicts = await listOpenEmailConflicts(orgId)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].existingEmail).toBe("sales@conflict.test")
    expect(conflicts[0].discoveredEmail).toBe("jane@conflict.test")
  })

  it("enforces org isolation", async () => {
    const orgA = await newOrg()
    const orgB = await newOrg()
    const candidateA = await newCandidate(orgA, { email: "jane.doe@acme-test.local" })
    const result = await requestEmailDiscovery(orgB, null, { candidateId: candidateA.id })
    expect(result.ok).toBe(false)
  })

  it("rate limits discovery per organization", async () => {
    const orgId = await newOrg()
    const candidate = await newCandidate(orgId, { email: "jane.doe@acme-test.local" })
    await updateSettings(orgId, { discoveryRateLimit: 1 })
    const first = await requestEmailDiscovery(orgId, null, { candidateId: candidate.id })
    expect(first.ok).toBe(true)
    const second = await requestEmailDiscovery(orgId, null, { candidateId: candidate.id })
    expect(second.ok).toBe(false)
    expect((second as { error: string }).error).toContain("rate limit")
  })

  it("retries only failed retryable jobs and cancels active ones", async () => {
    const orgId = await newOrg()
    const candidate = await newCandidate(orgId, { email: "jane.doe@acme-test.local" })

    const queued = await requestEmailDiscovery(orgId, null, { candidateId: candidate.id })
    expect((queued as { ok: true }).ok).toBe(true)
    const cancel = await cancelEmailDiscovery(orgId, (queued as { id: string }).id, null)
    expect(cancel.ok).toBe(true)
    const retryCancelled = await retryEmailDiscovery(orgId, (queued as { id: string }).id, null)
    expect(retryCancelled.ok).toBe(false)

    const active = await requestEmailDiscovery(orgId, null, { candidateId: candidate.id })
    await runEmailDiscoveryJob((active as { id: string }).id)
    const retryCompleted = await retryEmailDiscovery(orgId, (active as { id: string }).id, null)
    expect(retryCompleted.ok).toBe(false)
  })
})

// ── verification pipeline ─────────────────────────────────────────────────

describe("email verification", () => {
  it("verifies via the pipeline provider and caches the result", async () => {
    const orgId = await newOrg()
    const actor = await newActor(orgId)
    const candidate = await newCandidate(orgId, { email: "jane.doe@acme-test.local" })
    const request = await requestEmailDiscovery(orgId, actor, { candidateId: candidate.id })
    await runEmailDiscoveryJob((request as { id: string }).id)
    const [address] = await listEntityEmails(orgId, { candidateId: candidate.id })

    const verReq = await requestEmailVerification(orgId, actor, address.id, { providerId: "TEST_PIPE" })
    expect(verReq.ok).toBe(true)
    await runEmailVerificationJob((verReq as { id: string }).id)

    const after = await prisma.emailAddress.findUnique({ where: { id: address.id } })
    expect(after?.status).toBe(EmailStatus.VERIFIED)
    expect(after?.verifiedAt).not.toBeNull()
    expect(after?.expiresAt).not.toBeNull()
    expect((after?.verification as { mxPresent?: boolean }).mxPresent).toBe(true)

    const fresh = await requestEmailVerification(orgId, actor, address.id, { providerId: "TEST_PIPE" })
    expect(fresh).toEqual({ ok: true, id: expect.any(String), skipped: "FRESH" })
  })

  it("expires as STALE and manual overrides stick", async () => {
    const orgId = await newOrg()
    const actor = await newActor(orgId)
    const candidate = await newCandidate(orgId, { email: "jane.doe@acme-test.local" })
    const request = await requestEmailDiscovery(orgId, actor, { candidateId: candidate.id })
    await runEmailDiscoveryJob((request as { id: string }).id)
    const [address] = await listEntityEmails(orgId, { candidateId: candidate.id })

    await applyVerificationResult(orgId, address, {
      email: address.email, syntaxValid: true, domainValid: true, mxPresent: true,
      disposable: false, roleBased: false, status: "VERIFIED", confidence: 0.9,
      checkedAt: new Date(), provider: "TEST_PIPE",
    }, 14)
    let row = await prisma.emailAddress.findUnique({ where: { id: address.id } })
    expect(effectiveStatus(row!)).toBe(EmailStatus.VERIFIED)

    await prisma.emailAddress.update({ where: { id: address.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    row = await prisma.emailAddress.findUnique({ where: { id: address.id } })
    expect(effectiveStatus(row!)).toBe(EmailStatus.STALE)

    await markEmailInvalid(orgId, address.id, actor)
    row = await prisma.emailAddress.findUnique({ where: { id: address.id } })
    expect(row?.status).toBe(EmailStatus.INVALID)
    expect(row?.expiresAt).toBeNull()
  })

  it("bulk verify runs a batch end to end", async () => {
    const orgId = await newOrg()
    const actor = await newActor(orgId)
    const candidate = await newCandidate(orgId, { email: "jane.doe@acme-test.local" })
    const request = await requestEmailDiscovery(orgId, actor, { candidateId: candidate.id })
    await runEmailDiscoveryJob((request as { id: string }).id)
    const [address] = await listEntityEmails(orgId, { candidateId: candidate.id })

    const batch = await bulkVerify(orgId, actor, [address.id])
    expect(batch.ok).toBe(true)
    await runEmailVerificationBatch((batch as { batchId: string }).batchId)

    const b = await prisma.emailVerificationBatch.findUnique({ where: { id: (batch as { batchId: string }).batchId } })
    expect(b?.status).toBe(EmailVerificationBatchStatus.COMPLETED)
    const job = await prisma.emailVerificationJob.findFirst({ where: { batchId: b?.id } })
    expect(job?.status).toBe(EmailVerificationJobStatus.COMPLETED)
    const counts = await emailQueueCounts(orgId)
    expect(counts.verificationQueued).toBe(0)
    expect(counts.verificationFailed).toBe(0)
  })
})

// ── primary / remove / conflict resolution ────────────────────────────────

describe("primary email + conflict resolution", () => {
  it("swaps primary and resolves conflicts", async () => {
    const orgId = await newOrg()
    const actor = await newActor(orgId)
    const source = await prisma.leadSource.create({ data: { name: `P Src ${Date.now()}`, slug: `p-${Date.now()}`, type: LeadSourceType.CUSTOM, organizationId: orgId, config: {} } })
    const run = await prisma.scraperRun.create({ data: { organizationId: orgId, sourceId: source.id, status: ScraperRunStatus.COMPLETED } })
    const page = await prisma.rawPage.create({ data: { organizationId: orgId, runId: run.id, sourceId: source.id, url: "http://fixture", statusCode: 200, html: "", textContent: "", fetchedAt: new Date() } })
    const candidate = await prisma.leadCandidate.create({
      data: { organizationId: orgId, runId: run.id, sourceId: source.id, rawPageId: page.id, status: CandidateStatus.EXTRACTED, companyName: "Primary Co", companyDomain: "primary.test", websiteUrl: "http://primary.test", email: "sales@primary.test", contactFullName: null, normalizedCompanyName: "primary co" },
    })
    const second = await prisma.emailAddress.create({
      data: { organizationId: orgId, candidateId: candidate.id, email: "jane@primary.test", normalizedEmail: "jane@primary.test", type: EmailType.PERSONAL_BUSINESS, status: EmailStatus.DISCOVERED, confidence: 0.7, isPrimary: false, provider: "EXISTING_DATA", sourceType: "ENRICHMENT", domainMatch: EmailDomainMatch.DOMAIN_MATCH },
    })

    const swap = await setPrimaryEmail(orgId, second.id, actor)
    expect(swap.ok).toBe(true)
    const candidateAfter = await prisma.leadCandidate.findUnique({ where: { id: candidate.id } })
    expect(candidateAfter?.email).toBe("jane@primary.test")

    await prisma.emailConflict.create({ data: { organizationId: orgId, emailId: second.id, existingEmail: "sales@primary.test", discoveredEmail: "jane@primary.test" } })
    const conflicts = await listOpenEmailConflicts(orgId)
    expect(conflicts).toHaveLength(1)
    const resolved = await resolveEmailConflict(orgId, conflicts[0].id, EmailConflictResolution.ACCEPT_NEW, actor)
    expect(resolved.ok).toBe(true)
    expect(await listOpenEmailConflicts(orgId)).toHaveLength(0)

    const removed = await removeEmail(orgId, second.id, actor)
    expect(removed.ok).toBe(true)
    const row = await prisma.emailAddress.findUnique({ where: { id: second.id } })
    expect(row?.status).toBe(EmailStatus.REJECTED)
    expect(row?.isPrimary).toBe(false)
  })
})

// ── readiness ─────────────────────────────────────────────────────────────

describe("contact readiness", () => {
  it("scores, persists and mirrors onto the lead", async () => {
    const orgId = await newOrg()
    const company = await prisma.company.create({ data: { organizationId: orgId, name: "Readiness Co", domain: "ready.test", normalizedName: "readiness co" } })
    const contact = await prisma.contact.create({ data: { organizationId: orgId, fullName: "Jane Doe", firstName: "Jane", email: null, source: "MANUAL" } })
    const lead = await prisma.lead.create({ data: { organizationId: orgId, companyId: company.id, contactId: contact.id, title: "Readiness Lead", status: "NEW" } })

    const result = calculateReadiness({ contactName: "Jane Doe", jobTitle: null, phone: null, website: "http://ready.test", domain: "ready.test", emailStatuses: ["VERIFIED"], hasPublicEvidence: true })
    expect(result.version).toBe(READINESS_VERSION)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)

    await persistReadiness(orgId, { leadId: lead.id }, result)
    const latest = await latestReadiness(orgId, { leadId: lead.id })
    expect(latest?.score).toBe(result.score)
    const leadAfter = await prisma.lead.findUnique({ where: { id: lead.id } })
    expect(leadAfter?.contactReadiness).toBe(result.score)
  })
})
