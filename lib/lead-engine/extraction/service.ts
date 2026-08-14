import { createHash } from "node:crypto"
import { prisma } from "@/lib/db"
import { CandidateStatus, ExtractionMethod } from "@/generated/prisma/enums"
import type { Prisma } from "@/generated/prisma/client"
import { classifyPage, isAIWorthyCategory } from "@/lib/lead-engine/extraction/classify"
import { extractDeterministic } from "@/lib/lead-engine/extraction/deterministic"
import { resolveCandidate, qualityFields } from "@/lib/lead-engine/resolution/service"
import { normalizeCompanyName } from "@/lib/lead-engine/resolution/normalize"
import { extractWithAI } from "@/lib/lead-engine/extraction/ai"
import { getAIProvider } from "@/lib/lead-engine/ai/registry"
import type { AIProvider } from "@/lib/lead-engine/ai/types"
import {
  normalizeEmail,
  normalizePhone,
  normalizeText,
  normalizeUrl,
  sameDomain,
  splitName,
} from "@/lib/lead-engine/extraction/normalize"
import type {
  AIExtractionResult,
  DeterministicContact,
  DeterministicResult,
  EvidenceType,
  PageForExtraction,
} from "@/lib/lead-engine/extraction/types"

export const EXTRACTION_VERSION = "1"

// Safety/cost controls (spec §47, §63).
const AI_MAX_CALLS_PER_RUN = Number(process.env.AI_MAX_CALLS_PER_RUN ?? 50)
const AI_MAX_INPUT_CHARS = Number(process.env.AI_MAX_INPUT_CHARS ?? 8000)
const AI_MAX_CONTACTS = 25
const INITIAL_BATCH_SIZE = 3

type PipelineOutcome = { status: CandidateStatus; aiCalled: boolean; cached: boolean }

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

function cleanForAI(page: PageForExtraction): string {
  let text = page.textContent ?? ""
  if (!text && page.html) {
    const stripped = page.html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
    text = stripped.replace(/\s+/g, " ").trim()
  }
  const title = page.title ? `Title: ${page.title}\n` : ""
  return `${title}${text}`.slice(0, AI_MAX_INPUT_CHARS)
}

// §32/§63: call AI only when the page is relevant, deterministic extraction
// is incomplete, and budget allows.
function shouldUseAI(
  page: PageForExtraction,
  classification: { category: Parameters<typeof isAIWorthyCategory>[0]; skip: boolean },
  deterministic: DeterministicResult,
  aiCallsUsed: number,
  aiConfigured: boolean,
): boolean {
  if (!aiConfigured) return false
  if (classification.skip) return false
  if (!isAIWorthyCategory(classification.category)) return false
  if (aiCallsUsed >= AI_MAX_CALLS_PER_RUN) return false
  if (!page.textContent && !page.html) return false
  const hasCompany = Boolean(deterministic.company.name && deterministic.company.domain)
  const hasContact = deterministic.contacts.some((c) => c.fullName && (c.email || c.jobTitle))
  const hasEmail = deterministic.emails.length > 0
  return !(hasCompany && (hasContact || hasEmail))
}

// Corroboration: AI must not inject values absent from the page (spec §36).
function corroborated(value: string, page: PageForExtraction): boolean {
  const haystack = `${page.title ?? ""} ${page.textContent ?? ""}`.toLowerCase()
  return haystack.includes(value.toLowerCase())
}

function isCorroboratedContact(contact: DeterministicContact, page: PageForExtraction): boolean {
  if (contact.fullName && corroborated(contact.fullName, page)) return true
  if (contact.email) {
    const haystack = `${page.title ?? ""} ${page.textContent ?? ""}`.toLowerCase()
    return haystack.includes(contact.email.toLowerCase())
  }
  if (contact.linkedinUrl && corroborated(contact.linkedinUrl, page)) return true
  return false
}

interface Merged {
  company: {
    name?: string
    domain?: string
    website?: string
    description?: string
    industry?: string
    country?: string
    region?: string
    city?: string
    logo?: string
  }
  contacts: DeterministicContact[]
  socialLinks: string[]
  jobs: NonNullable<AIExtractionResult["jobs"]>
  email?: string
  phone?: string
  phoneRaw?: string
  linkedinUrl?: string
  aiUsed: boolean
  aiOmitted: { field: string; value: string; reason: string }[]
}

type AExtraction = AIExtractionResult

function mergeResults(page: PageForExtraction, det: DeterministicResult, ai: AExtraction | null): Merged {
  const company = { ...det.company }
  const contacts = [...det.contacts]
  const socialLinks = [...det.socialLinks]
  const jobs = [...det.jobs]
  const aiOmitted: Merged["aiOmitted"] = []
  let aiUsed = false

  const adopt = <K extends keyof AExtraction["company"]>(field: K, candidate: string | null | undefined): void => {
    if (!candidate || company[field]) return
    aiUsed = true
    company[field] = candidate as Merged["company"][K]
  }

  if (ai) {
    const aiCompany = ai.company
    if (aiCompany.name && !company.name && corroborated(aiCompany.name, page)) adopt("name", aiCompany.name)
    else if (aiCompany.name && !company.name) aiOmitted.push({ field: "company_name", value: aiCompany.name, reason: "not found in page content" })
    if (aiCompany.domain && !company.domain && sameDomain(aiCompany.domain, company.domain ?? page.url)) adopt("domain", aiCompany.domain)
    else if (aiCompany.domain && !company.domain) aiOmitted.push({ field: "company_domain", value: aiCompany.domain, reason: "domain does not match page host" })
    if (aiCompany.website && !company.website && corroborated(aiCompany.website, page)) adopt("website", aiCompany.website)
    if (aiCompany.description && !company.description) adopt("description", aiCompany.description)
    if (aiCompany.industry && !company.industry) adopt("industry", aiCompany.industry)
    if (aiCompany.country && !company.country) adopt("country", aiCompany.country)
    if (aiCompany.region && !company.region) adopt("region", aiCompany.region)
    if (aiCompany.city && !company.city) adopt("city", aiCompany.city)

    for (const c of ai.contacts.slice(0, AI_MAX_CONTACTS)) {
      const contact: DeterministicContact = {
        fullName: c.fullName ? normalizeText(c.fullName) : undefined,
        firstName: c.firstName ? normalizeText(c.firstName) : undefined,
        lastName: c.lastName ? normalizeText(c.lastName) : undefined,
        jobTitle: c.jobTitle ? normalizeText(c.jobTitle) : undefined,
        email: c.email ? normalizeEmail(c.email) ?? undefined : undefined,
        phone: c.phone ? c.phone : undefined,
        linkedinUrl: c.linkedinUrl ? normalizeUrl(c.linkedinUrl) : undefined,
        evidence: ["AI"] as EvidenceType[],
      }
      if (!isCorroboratedContact(contact, page)) {
        if (contact.fullName) aiOmitted.push({ field: "contact_name", value: contact.fullName, reason: "not found in page content" })
        if (contact.email) aiOmitted.push({ field: "email", value: contact.email, reason: "not found in page content" })
        continue
      }
      aiUsed = true
      contacts.push(contact)
    }
    for (const link of ai.socialLinks) {
      if (!socialLinks.includes(link) && corroborated(link, page)) {
        socialLinks.push(link)
        aiUsed = true
      }
    }
    for (const job of ai.jobs) {
      if (!jobs.some((j) => j.title && j.title === job.title)) {
        jobs.push(job)
        aiUsed = true
      }
    }
  }

  const primary = contacts[0]
  const email = primary?.email ?? undefined
  const firstEmailFromList = !email && det.emails.length > 0 ? det.emails[0] : undefined
  return {
    company,
    contacts,
    socialLinks: [...new Set(socialLinks)],
    jobs,
    email: email ?? firstEmailFromList,
    phone: contacts.find((c) => c.phone)?.phone,
    phoneRaw: contacts.find((c) => c.phone)?.phone,
    linkedinUrl: contacts.find((c) => c.linkedinUrl)?.linkedinUrl,
    aiUsed,
    aiOmitted,
  }
}

function fieldConfidenceOf(evidenceTypes: EvidenceType[]): number {
  if (evidenceTypes.includes("JSON_LD") || evidenceTypes.includes("META") || evidenceTypes.includes("URL")) return 0.95
  if (evidenceTypes.includes("MAILTO") || evidenceTypes.includes("LINK")) return 0.9
  if (evidenceTypes.includes("VISIBLE_TEXT")) return 0.85
  return 0.6
}

function computeConfidence(merged: Merged, deterministic: DeterministicResult, method: ExtractionMethod): number {
  let confidence = 0.2
  if (merged.company.name) confidence += 0.15
  if (merged.company.domain) confidence += 0.1
  if (merged.company.description) confidence += 0.05
  if (merged.email) confidence += 0.15
  if (merged.phone) confidence += 0.05
  if (merged.linkedinUrl) confidence += 0.05
  confidence += Math.min(0.15, merged.contacts.length * 0.05)
  if (method === "HYBRID") confidence += 0.05
  if (method === "AI") confidence += 0.03
  return Math.min(0.95, Math.round(confidence * 100) / 100)
}

function buildFieldConfidence(merged: Merged, det: DeterministicResult, method: ExtractionMethod): Record<string, number> {
  const byField = new Map<string, EvidenceType[]>()
  for (const evidence of det.evidence) {
    const list = byField.get(evidence.field) ?? []
    list.push(evidence.evidenceType)
    byField.set(evidence.field, list)
  }
  if (method === "HYBRID" || method === "AI") {
    for (const field of ["company_name", "description", "industry", "country", "region", "city", "contact_name", "email", "job_title", "linkedin_url", "phone"]) {
      if (!byField.has(field)) byField.set(field, ["AI"])
    }
  }
  const result: Record<string, number> = {}
  for (const [field, types] of byField) result[field] = fieldConfidenceOf(types)
  return result
}

function buildProvenance(merged: Merged, det: DeterministicResult, aiOmitted: Merged["aiOmitted"]): Prisma.InputJsonValue {
  const provenance: Record<string, unknown> = {}
  for (const evidence of det.evidence) {
    if (!provenance[evidence.field]) {
      provenance[evidence.field] = {
        value: evidence.value,
        method: "DETERMINISTIC",
        sourceUrl: evidence.sourceUrl,
        evidenceType: evidence.evidenceType,
      }
    }
  }
  if (merged.aiUsed) {
    const aiFields: Array<[string, string | undefined]> = [
      ["company_description", merged.company.description],
      ["industry", merged.company.industry],
      ["country", merged.company.country],
      ["region", merged.company.region],
      ["city", merged.company.city],
    ]
    for (const [field, value] of aiFields) {
      if (value && !provenance[field]) {
        provenance[field] = { value, method: "AI", sourceUrl: undefined, evidenceType: "AI" }
      }
    }
    for (const omitted of aiOmitted) {
      provenance[`rejected_${omitted.field}`] = { value: omitted.value, method: "AI", rejected: omitted.reason, evidenceType: "AI" }
    }
  }
  return provenance as unknown as Prisma.InputJsonValue
}

export async function processPage(page: PageForExtraction, provider: AIProvider): Promise<PipelineOutcome> {
  const content = cleanForAI(page)
  const hash = contentHash(content)
  const metaHeadings = Array.isArray(page.metadata?.headings) ? (page.metadata.headings as string[]) : []
  const classification = classifyPage({
    url: page.url,
    title: page.title,
    headings: metaHeadings,
    linkTexts: [],
  })

  if (classification.skip) return { status: CandidateStatus.SKIPPED, aiCalled: false, cached: false }

  const det = extractDeterministic(page)
  const run = await prisma.extractionRun.findUnique({
    where: { organizationId_scraperRunId: { organizationId: page.organizationId, scraperRunId: page.runId } },
    select: { id: true, aiCalls: true, aiFailures: true },
  })

  let ai: AExtraction | null = null
  let aiCalled = false
  let cached = false
  let aiError: string | null = null

  const cacheHit = await prisma.leadCandidate.findFirst({
    where: { organizationId: page.organizationId, contentHash: hash, extractionVersion: EXTRACTION_VERSION, status: CandidateStatus.EXTRACTED },
    select: { rawData: true },
    orderBy: { updatedAt: "desc" },
  })
  const cachedAi = cacheHit?.rawData && typeof cacheHit.rawData === "object" ? (cacheHit.rawData as { ai?: { result?: unknown } }).ai?.result : undefined

  if (shouldUseAI(page, classification, det, run?.aiCalls ?? 0, provider.configured)) {
    if (cachedAi && typeof cachedAi === "object") {
      ai = cachedAi as AExtraction
      cached = true
    } else if (run) {
      aiCalled = true
      const outcome = await extractWithAI(provider, { pageUrl: page.url, pageTitle: page.title ?? "", cleanedText: content })
      if (outcome.ok) {
        ai = outcome.result
        await prisma.extractionRun.update({
          where: { id: run.id },
          data: {
            aiCalls: { increment: 1 },
            aiInputChars: { increment: outcome.result.usage.promptChars },
            aiOutputChars: { increment: outcome.result.usage.completionChars },
          },
        })
      } else {
        aiError = outcome.error
        await prisma.extractionRun.update({
          where: { id: run.id },
          data: { aiCalls: { increment: 1 }, aiFailures: { increment: 1 } },
        })
      }
    }
  }

  const merged = mergeResults(page, det, ai)
  const method: ExtractionMethod =
    merged.aiUsed || aiCalled ? (det.company.name || det.contacts.length > 0 || det.emails.length > 0 ? "HYBRID" : "AI") : "DETERMINISTIC"
  const confidence = computeConfidence(merged, det, method)
  const fieldConfidence = buildFieldConfidence(merged, det, method)
  const provenance = buildProvenance(merged, det, merged.aiOmitted)

  const primary = merged.contacts[0]
  const nameParts = primary?.fullName ? splitName(primary.fullName) : undefined
  const quality = qualityFields({
    companyName: merged.company.name,
    companyDomain: merged.company.domain,
    websiteUrl: merged.company.website,
    contactFullName: primary?.fullName,
    email: merged.email,
    phone: merged.phone,
    linkedinUrl: merged.linkedinUrl,
    extractionConfidence: confidence,
    pageClassification: classification.category,
    fieldProvenance: provenance,
  })
  const fields: Prisma.LeadCandidateUncheckedCreateWithoutContactsInput = {
    organizationId: page.organizationId,
    runId: page.runId,
    sourceId: page.sourceId,
    rawPageId: page.id,
    pageClassification: classification.category,
    status: CandidateStatus.EXTRACTED,
    extractionMethod: method,
    extractionConfidence: confidence,
    extractionVersion: EXTRACTION_VERSION,
    contentHash: hash,
    aiUsed: merged.aiUsed || aiCalled,
    normalizedCompanyName: merged.company.name ? normalizeCompanyName(merged.company.name) : null,
    normalizedPhone: merged.phone ? normalizePhone(merged.phone) || null : null,
    ...quality,
    companyName: merged.company.name ?? null,
    companyDomain: merged.company.domain ?? null,
    websiteUrl: merged.company.website ?? null,
    description: merged.company.description ?? null,
    industry: merged.company.industry ?? null,
    country: merged.company.country ?? null,
    region: merged.company.region ?? null,
    city: merged.company.city ?? null,
    logoUrl: merged.company.logo ?? null,
    contactFullName: primary?.fullName ?? null,
    contactFirstName: nameParts?.firstName ?? null,
    contactLastName: nameParts?.lastName ?? null,
    contactJobTitle: primary?.jobTitle ?? null,
    email: merged.email ?? null,
    phone: merged.phone ? normalizePhone(merged.phone) ?? merged.phone : null,
    phoneRaw: merged.phoneRaw ?? null,
    linkedinUrl: merged.linkedinUrl ?? null,
    socialLinks: merged.socialLinks as unknown as Prisma.InputJsonValue,
    jobs: merged.jobs as unknown as Prisma.InputJsonValue,
    fieldProvenance: provenance,
    fieldConfidence: fieldConfidence as unknown as Prisma.InputJsonValue,
    rawData: {
      deterministic: { company: det.company, contacts: det.contacts, emails: det.emails, phones: det.phones, jobs: det.jobs, socialLinks: det.socialLinks, evidence: det.evidence },
      ai: ai ? { result: ai, error: aiError } : null,
    } as unknown as Prisma.InputJsonValue,
    normalizedData: {
      company: merged.company,
      contacts: merged.contacts,
      socialLinks: merged.socialLinks,
      source: { runId: page.runId, sourceId: page.sourceId, pageId: page.id, url: page.url },
      extraction: { method, confidence },
    } as unknown as Prisma.InputJsonValue,
  }
  const contactsData = merged.contacts.map((c) => ({
    organizationId: page.organizationId,
    fullName: c.fullName ?? c.email ?? "Unknown",
    firstName: c.firstName ?? null,
    lastName: c.lastName ?? (c.fullName ? splitName(c.fullName).lastName ?? null : null),
    jobTitle: c.jobTitle ?? null,
    email: c.email ? normalizeEmail(c.email) : null,
    phone: c.phone ?? null,
    linkedinUrl: c.linkedinUrl ?? null,
    confidence: fieldConfidenceOf(c.evidence),
    provenance: c.evidence as Prisma.InputJsonValue,
  }))

  const existing = await prisma.leadCandidate.findUnique({
    where: { organizationId_rawPageId: { organizationId: page.organizationId, rawPageId: page.id } },
    select: { id: true },
  })

  if (existing) {
    await prisma.$transaction([
      prisma.leadCandidate.update({ where: { id: existing.id }, data: { ...fields, contacts: undefined } }),
      prisma.candidateContact.deleteMany({ where: { candidateId: existing.id } }),
      ...(contactsData.length > 0
        ? [prisma.candidateContact.createMany({ data: contactsData as unknown as Prisma.CandidateContactCreateManyInput[] })]
        : []),
    ])
  } else {
    await prisma.leadCandidate.create({
      data: { ...fields, contacts: { create: contactsData as unknown as Prisma.CandidateContactCreateWithoutCandidateInput[] } },
    })
  }

  // TASK 009: incremental resolution for this new/updated candidate (§40).
  try {
    if (!existing) {
      const saved = await prisma.leadCandidate.findFirst({
        where: { organizationId: page.organizationId, rawPageId: page.id },
        select: { id: true },
      })
      if (saved) await resolveCandidate(page.organizationId, saved.id)
    }
  } catch (e) {
    console.log(`resolution.incremental.failed pageId=${page.id} error=${e instanceof Error ? e.message : "unknown"}`)
  }

  return { status: CandidateStatus.EXTRACTED, aiCalled, cached }
}

// ── Extraction run orchestration (spec §44-§45, §51, §62) ────────────────

export async function startExtraction(orgId: string, scraperRunId: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const run = await prisma.scraperRun.findFirst({ where: { id: scraperRunId, organizationId: orgId }, select: { id: true } })
  if (!run) return { ok: false, error: "Run not found in this organization" }
  const existing = await prisma.extractionRun.findUnique({
    where: { organizationId_scraperRunId: { organizationId: orgId, scraperRunId } },
    select: { id: true, status: true },
  })
  if (existing && (existing.status === CandidateStatus.PENDING || existing.status === CandidateStatus.PROCESSING)) {
    return { ok: false, error: "Extraction already running for this run" }
  }
  const extraction = await prisma.extractionRun.upsert({
    where: { organizationId_scraperRunId: { organizationId: orgId, scraperRunId } },
    update: {
      status: CandidateStatus.PENDING,
      pagesProcessed: 0,
      pagesSkipped: 0,
      pagesFailed: 0,
      candidatesCreated: 0,
      aiCalls: 0,
      aiFailures: 0,
      aiInputChars: 0,
      aiOutputChars: 0,
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
    },
    create: { organizationId: orgId, scraperRunId },
  })
  return { ok: true, id: extraction.id }
}

export async function runExtractionJob(extractionRunId: string, provider: AIProvider = getAIProvider()): Promise<void> {
  const run = await prisma.extractionRun.findUnique({ where: { id: extractionRunId }, include: { scraperRun: { select: { organizationId: true } } } })
  if (!run) return
  if (run.status !== CandidateStatus.PENDING) return

  await prisma.extractionRun.update({ where: { id: run.id }, data: { status: CandidateStatus.PROCESSING, startedAt: new Date() } })
  let pagesProcessed = 0
  let pagesSkipped = 0
  let pagesFailed = 0
  let candidatesCreated = 0

  const totals = await prisma.scraperRun.findUnique({
    where: { id: run.scraperRunId },
    select: { _count: { select: { rawPages: true } } },
  })
  console.log(`extraction.started runId=${run.scraperRunId} pages=${totals?._count.rawPages ?? 0}`)

  const pages = await prisma.rawPage.findMany({
    where: { runId: run.scraperRunId, organizationId: run.scraperRun.organizationId },
    orderBy: { fetchedAt: "asc" },
    select: { id: true, organizationId: true, runId: true, sourceId: true, url: true, title: true, html: true, textContent: true, metadata: true, fetchedAt: true },
  })

  for (let i = 0; i < pages.length; i += INITIAL_BATCH_SIZE) {
    const batch = pages.slice(i, i + INITIAL_BATCH_SIZE)
    const outcomes = await Promise.all(
      batch.map(async (page) => {
        try {
          return await processPage(page as PageForExtraction, provider)
        } catch (e) {
          console.log(`extraction.page.failed pageId=${page.id} error=${e instanceof Error ? e.message : "unknown"}`)
          return { status: CandidateStatus.FAILED, aiCalled: false, cached: false } as PipelineOutcome
        }
      }),
    )
    for (const outcome of outcomes) {
      if (outcome.status === CandidateStatus.SKIPPED) pagesSkipped++
      else if (outcome.status === CandidateStatus.FAILED) pagesFailed++
      else {
        pagesProcessed++
        candidatesCreated++
      }
    }
    await prisma.extractionRun.update({
      where: { id: run.id },
      data: { pagesProcessed, pagesSkipped, pagesFailed, candidatesCreated },
    })
  }

  await prisma.extractionRun.update({
    where: { id: run.id },
    data: {
      status: CandidateStatus.EXTRACTED,
      finishedAt: new Date(),
      pagesProcessed,
      pagesSkipped,
      pagesFailed,
      candidatesCreated,
    },
  })
  console.log(`extraction.completed runId=${run.scraperRunId} processed=${pagesProcessed} skipped=${pagesSkipped} failed=${pagesFailed} candidates=${candidatesCreated} aiCalls=${run.aiCalls}`)
}

// Reprocessing (spec §50): reset the extraction run and let startExtraction
// re-run pages under the current extraction version.
export async function reprocessRun(orgId: string, scraperRunId: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  return startExtraction(orgId, scraperRunId)
}

export async function reprocessPage(orgId: string, rawPageId: string, provider: AIProvider = getAIProvider()): Promise<PipelineOutcome> {
  const page = await prisma.rawPage.findFirst({ where: { id: rawPageId, organizationId: orgId } })
  if (!page) throw new Error("Page not found in this organization")
  return processPage(page as unknown as PageForExtraction, provider)
}

// ── Read paths (organization-scoped) ────────────────────────────────────

export async function getExtractionRun(orgId: string, scraperRunId: string) {
  return prisma.extractionRun.findUnique({
    where: { organizationId_scraperRunId: { organizationId: orgId, scraperRunId } },
  })
}

export interface CandidateFilters {
  page?: string
  pageSize?: string
  method?: string
  status?: string
  sourceId?: string
  runId?: string
  hasEmail?: string
  hasContact?: string
  hasPhone?: string
  hasLinkedIn?: string
  companyDomain?: string
  minQuality?: string
  sort?: string
  q?: string
  minIcpScore?: string
  minOverallScore?: string
  qualification?: string
  enrichment?: "NOT_ENRICHED" | "RECENTLY_ENRICHED" | "NEEDS_REFRESH" | "FAILED" | "ACTIVE" | "HAS_CONFLICTS"
}

export async function listCandidates(orgId: string, filters: CandidateFilters = {}) {
  const { parsePagination } = await import("@/lib/crm/pagination")
  const { page, pageSize } = parsePagination(filters)
  const where: Prisma.LeadCandidateWhereInput = { organizationId: orgId }
  if (filters.method) where.extractionMethod = filters.method as ExtractionMethod
  if (filters.status) where.status = filters.status as CandidateStatus
  if (filters.sourceId) where.sourceId = filters.sourceId
  if (filters.runId) where.runId = filters.runId
  if (filters.companyDomain) where.companyDomain = filters.companyDomain
  if (filters.hasEmail === "1" || filters.hasEmail === "true") where.NOT = { email: null }
  if (filters.hasContact === "1" || filters.hasContact === "true") where.NOT = { contactFullName: null }
  if (filters.hasPhone === "1" || filters.hasPhone === "true") where.NOT = { phone: null }
  if (filters.hasLinkedIn === "1" || filters.hasLinkedIn === "true") where.NOT = { linkedinUrl: null }
  const minQuality = Number(filters.minQuality)
  if (filters.minQuality && !Number.isNaN(minQuality)) where.dataQualityScore = { gte: minQuality }
  if (filters.minIcpScore) {
    const v = Number(filters.minIcpScore)
    if (!Number.isNaN(v)) where.scores = { some: { icpScore: { gte: v }, scoreStatus: "CURRENT" } }
  }
  if (filters.minOverallScore) {
    const v = Number(filters.minOverallScore)
    if (!Number.isNaN(v)) where.scores = { some: { overallScore: { gte: v }, scoreStatus: "CURRENT" } }
  }
  if (filters.qualification) {
    where.scores = { some: { qualification: filters.qualification as Prisma.EnumQualificationFilter["equals"], scoreStatus: "CURRENT" } }
  }
  if (filters.q?.trim()) {
    const q = filters.q.trim().toLowerCase()
    where.OR = [
      { companyName: { contains: q, mode: "insensitive" } },
      { contactFullName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { companyDomain: { contains: q, mode: "insensitive" } },
    ]
  }
  if (filters.enrichment) {
    const { getSettings } = await import("@/lib/lead-engine/enrichment/service")
    const settings = await getSettings(orgId)
    const cutoff = new Date(Date.now() - settings.freshnessDays * 24 * 60 * 60 * 1000)
    const eligible: Prisma.LeadCandidateWhereInput = { OR: [{ companyDomain: { not: null } }, { websiteUrl: { not: null } }] }
    const succeeded = { status: { in: ["COMPLETED" as const, "PARTIAL" as const] } }
    const active = { status: { in: ["QUEUED" as const, "RUNNING" as const] } }
    const conditions: Prisma.LeadCandidateWhereInput[] = []
    switch (filters.enrichment) {
      case "NOT_ENRICHED":
        conditions.push(eligible, { enrichmentRequests: { none: succeeded } })
        break
      case "RECENTLY_ENRICHED":
        conditions.push({ enrichmentRequests: { some: { ...succeeded, completedAt: { gte: cutoff } } } })
        break
      case "NEEDS_REFRESH":
        conditions.push(eligible, { enrichmentRequests: { none: succeeded } }, {
          enrichmentRequests: { some: { ...succeeded, completedAt: { lt: cutoff } } },
        })
        break
      case "FAILED":
        conditions.push(eligible, { enrichmentRequests: { some: { status: "FAILED" } } })
        break
      case "ACTIVE":
        conditions.push({ enrichmentRequests: { some: active } })
        break
      case "HAS_CONFLICTS":
        conditions.push({ enrichmentConflicts: { some: { status: "OPEN" } } })
        break
    }
    where.AND = conditions
  }
  const orderBy: Prisma.LeadCandidateOrderByWithRelationInput =
    filters.sort === "oldest"
      ? { createdAt: "asc" }
      : filters.sort === "quality"
        ? { dataQualityScore: "desc" }
        : filters.sort === "company"
          ? { companyName: "asc" }
          : filters.sort === "confidence"
            ? { extractionConfidence: "desc" }
            : filters.sort === "icpScore"
              ? { scores: { _count: "desc" } } // placeholder - would need a subquery
              : { createdAt: "desc" }
  const [total, data] = await Promise.all([
    prisma.leadCandidate.count({ where }),
    prisma.leadCandidate.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        companyName: true,
        companyDomain: true,
        contactFullName: true,
        contactJobTitle: true,
        email: true,
        phone: true,
        linkedinUrl: true,
        status: true,
        extractionMethod: true,
        extractionConfidence: true,
        dataQualityScore: true,
        pageClassification: true,
        createdAt: true,
        runId: true,
        sourceId: true,
        scores: {
          where: { scoreStatus: "CURRENT" },
          take: 1,
          orderBy: { scoredAt: "desc" },
          select: { icpScore: true, overallScore: true, qualification: true, scoreStatus: true, modelVersion: true },
        },
        enrichmentRequests: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, errorCode: true, completedAt: true, createdAt: true },
        },
      },
    }),
  ])
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function getCandidate(orgId: string, id: string) {
  return prisma.leadCandidate.findFirst({
    where: { id, organizationId: orgId },
    include: {
      contacts: { orderBy: { createdAt: "asc" } },
      run: { select: { id: true, status: true, createdAt: true } },
      source: { select: { id: true, name: true, type: true } },
      rawPage: { select: { id: true, url: true, title: true, statusCode: true, fetchedAt: true } },
    },
  })
}