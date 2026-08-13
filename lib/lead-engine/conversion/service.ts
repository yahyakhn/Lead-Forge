// TASK 010: CRM entity conversion. Bridges LeadCandidate → Company/Contact/Lead.
// Deterministic resolution (§12-§18), idempotent (§28), transactional (§29),
// org-scoped (§49), conservative on manual CRM data (§56-§59).

import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import { CandidateStatus, ConversionStatus, ActivityType } from "@/generated/prisma/enums"
import { normalizeCompanyName, normalizeDomain, normalizeLinkedInUrl } from "@/lib/lead-engine/resolution/normalize"
import { normalizeEmail, normalizePhone } from "@/lib/lead-engine/extraction/normalize"
import { createActivity } from "@/lib/crm/activities"
import { scoreLead } from "@/lib/lead-engine/scoring/service"

export const SCRAPER_SOURCE = "SCRAPER"
export const LEAD_SOURCE_OPTIONS = ["MANUAL", "WEBSITE", "SCRAPER", "IMPORT", "REFERRAL", "OTHER"] as const

export type ConversionErrorCode =
  | "CANDIDATE_NOT_FOUND"
  | "ALREADY_CONVERTED"
  | "DUPLICATE_NOT_RESOLVED"
  | "INSUFFICIENT_DATA"
  | "AMBIGUOUS_COMPANY"
  | "AMBIGUOUS_CONTACT"
  | "DATABASE_ERROR"
  | "NOT_ELIGIBLE"

export interface ConversionResult {
  ok: boolean
  code?: ConversionErrorCode
  error?: string
  conversion?: {
    id: string
    status: ConversionStatus
    companyId: string | null
    contactId: string | null
    leadId: string | null
    candidateId: string
  }
  companyAction?: "CREATE" | "REUSE"
  contactAction?: "CREATE" | "REUSE"
}

export interface BulkSummary {
  selected: number
  converted: number
  alreadyConverted: number
  needsReview: number
  skipped: number
  failed: Array<{ candidateId: string; code: string; error: string }>
}

const candidateSelect = {
  id: true,
  organizationId: true,
  status: true,
  companyName: true,
  normalizedCompanyName: true,
  companyDomain: true,
  websiteUrl: true,
  description: true,
  industry: true,
  country: true,
  city: true,
  contactFullName: true,
  contactFirstName: true,
  contactLastName: true,
  contactJobTitle: true,
  email: true,
  phoneRaw: true,
  phone: true,
  linkedinUrl: true,
  dataQualityScore: true,
  rawPage: { select: { url: true } },
  conversions: { select: { id: true, status: true, companyId: true, contactId: true, leadId: true } },
} as const

type CandidateRow = Prisma.LeadCandidateGetPayload<{ select: typeof candidateSelect }>

// ── Eligibility (§34-§36) ─────────────────────────────────────────────────

export interface Eligibility {
  eligible: boolean
  code?: ConversionErrorCode
  reason?: string
}

// §34: bulk bar eligibility filter — what's safe to offer in the UI.
export function isConvertibleStatus(status: CandidateStatus): boolean {
  return (
    status !== CandidateStatus.CONVERTED &&
    status !== CandidateStatus.DUPLICATE &&
    status !== CandidateStatus.REVIEW &&
    !([CandidateStatus.FAILED, CandidateStatus.SKIPPED, CandidateStatus.PENDING, CandidateStatus.PROCESSING] as CandidateStatus[]).includes(status)
  )
}

// §36: company-only needs name or domain; contact needs name + company or
// strong contact identity (email/linkedin/phone). No email requirement.
export function canConvertCandidate(candidate: Pick<CandidateRow, "status" | "companyName" | "companyDomain" | "contactFullName" | "email" | "linkedinUrl" | "phone" | "phoneRaw">): Eligibility {
  if (candidate.status === CandidateStatus.CONVERTED) return { eligible: false, code: "ALREADY_CONVERTED", reason: "already converted" }
  if (candidate.status === CandidateStatus.DUPLICATE) return { eligible: false, code: "DUPLICATE_NOT_RESOLVED", reason: "duplicate candidate — conversion goes through the canonical candidate" }
  if (candidate.status === CandidateStatus.REVIEW) return { eligible: false, code: "AMBIGUOUS_COMPANY", reason: "duplicate review pending" }
  const notEligible = [CandidateStatus.FAILED, CandidateStatus.SKIPPED, CandidateStatus.PENDING, CandidateStatus.PROCESSING] as const satisfies readonly CandidateStatus[]
  if ((notEligible as readonly CandidateStatus[]).includes(candidate.status)) {
    return { eligible: false, code: "NOT_ELIGIBLE", reason: `candidate status ${candidate.status} is not eligible for conversion` }
  }

  const hasCompany = Boolean(normalizeCompanyName(candidate.companyName ?? "") || normalizeDomain(candidate.companyDomain ?? ""))
  const hasContactName = Boolean(candidate.contactFullName?.trim())
  const strongContact = Boolean(
    (candidate.email && normalizeEmail(candidate.email)) ||
      (candidate.linkedinUrl && normalizeLinkedInUrl(candidate.linkedinUrl)) ||
      candidatePhoneOf(candidate),
  )

  if (!hasCompany && !hasContactName && !strongContact) {
    return { eligible: false, code: "INSUFFICIENT_DATA", reason: "no usable company or contact identity" }
  }
  if (hasContactName && !hasCompany && !strongContact) {
    return { eligible: false, code: "INSUFFICIENT_DATA", reason: "contact name without company or strong contact identity" }
  }
  return { eligible: true }
}

// §33: duplicates convert through their canonical candidate, never alone.
export async function canonicalCandidateId(orgId: string, candidateId: string): Promise<string | null> {
  const membership = await prisma.duplicateGroupMember.findFirst({
    where: { organizationId: orgId, candidateId },
    include: {
      duplicateGroup: {
        select: {
          canonicalCandidateId: true,
          members: { select: { candidateId: true, candidate: { select: { status: true } } } },
        },
      },
    },
  })
  if (!membership) return null
  const group = membership.duplicateGroup
  if (group.canonicalCandidateId) return group.canonicalCandidateId
  const ready = group.members.find((m) => m.candidate.status === CandidateStatus.READY || m.candidate.status === CandidateStatus.CONVERTED)
  return ready?.candidateId ?? null
}

// ── Company resolution (§12): canonical → domain → safe name match ────────

type CompanyMatch = Prisma.CompanyGetPayload<{ select: { id: true; name: true; domain: true; source: true } }> | { ambiguity: true } | null

async function findClosestCompany(orgId: string, domain: string | null, normalizedName: string, tx: Prisma.TransactionClient | typeof prisma): Promise<CompanyMatch> {
  if (domain) {
    const byDomain = await tx.company.findFirst({ where: { organizationId: orgId, domain } })
    if (byDomain) return byDomain
  }
  if (normalizedName) {
    const byName = await tx.company.findMany({
      where: { organizationId: orgId, normalizedName },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, domain: true, source: true },
    })
    if (byName.length === 1) {
      const exact = byName[0]
      // §13: a candidate domain that conflicts with the name match is
      // ambiguity, not identity.
      if (domain && exact.domain && exact.domain !== domain) return { ambiguity: true }
      return exact
    }
    if (byName.length > 1) return { ambiguity: true }
  }
  return null
}

// §20: create only from supported candidate data.
function companyCreateData(candidate: CandidateRow) {
  const name = candidate.companyName?.trim() || normalizeDomain(candidate.companyDomain ?? "") || "Unknown company"
  return {
    name,
    normalizedName: normalizeCompanyName(name) || name.toLowerCase(),
    domain: candidate.companyDomain?.trim() || null,
    website: candidate.websiteUrl?.trim() || null,
    description: candidate.description?.trim() || null,
    industry: candidate.industry?.trim() || null,
    country: candidate.country || null,
    city: candidate.city || null,
    source: SCRAPER_SOURCE,
    sourceCandidateId: candidate.id,
  }
}

// ── Contact resolution (§14-§18) ──────────────────────────────────────────

function candidatePhoneOf(candidate: Pick<CandidateRow, "phone" | "phoneRaw">): string | null {
  return (candidate.phone && normalizePhone(candidate.phone)) || (candidate.phoneRaw && normalizePhone(candidate.phoneRaw)) || null
}

async function findClosestContact(orgId: string, candidate: CandidateRow, tx: Prisma.TransactionClient | typeof prisma) {
  // Strong identity order (§14): email → linkedin → phone.
  const email = candidate.email ? normalizeEmail(candidate.email) : null
  if (email) {
    const byEmail = await tx.contact.findFirst({ where: { organizationId: orgId, email } })
    if (byEmail) return byEmail
  }
  const linkedin = candidate.linkedinUrl ? normalizeLinkedInUrl(candidate.linkedinUrl) : null
  if (linkedin) {
    const byLinkedIn = await tx.contact.findFirst({ where: { organizationId: orgId, linkedinUrl: linkedin } })
    if (byLinkedIn) return byLinkedIn
  }
  const phone = candidatePhoneOf(candidate)
  if (phone) {
    const byPhone = await tx.contact.findFirst({ where: { organizationId: orgId, phone } })
    if (byPhone) return byPhone
  }
  // §15: name without strong identifiers never reuses a contact.
  return null
}

function candidatePersonExists(candidate: CandidateRow) {
  return Boolean(candidate.contactFullName?.trim() || candidate.email || candidate.linkedinUrl || candidatePhoneOf(candidate))
}

// §21: the contact is created only when the candidate carries person data.
type ContactFields = Omit<Prisma.ContactUncheckedCreateInput, "organizationId" | "companyId">
function contactCreateData(candidate: CandidateRow): ContactFields | null {
  if (!candidatePersonExists(candidate)) return null
  const email = candidate.email ? normalizeEmail(candidate.email) : null
  return {
    firstName: candidate.contactFirstName?.trim() || candidate.contactFullName?.trim().split(/\s+/)[0] || "",
    lastName: candidate.contactLastName?.trim() || null,
    fullName: candidate.contactFullName?.trim() || email || "Unknown contact",
    jobTitle: candidate.contactJobTitle?.trim() || null,
    email,
    phone: candidatePhoneOf(candidate),
    linkedinUrl: candidate.linkedinUrl ? normalizeLinkedInUrl(candidate.linkedinUrl) : null,
    source: SCRAPER_SOURCE,
    sourceCandidateId: candidate.id,
  }
}

// ── Lead resolution (§22-§24, §53-§55) ────────────────────────────────────

export function leadTitle(candidate: CandidateRow): string {
  const company = candidate.companyName?.trim() || normalizeDomain(candidate.companyDomain ?? "") || "Company"
  const contact = candidate.contactFullName?.trim()
  return contact ? `${company} — ${contact}` : company
}

function leadNotes(candidate: CandidateRow): string {
  return [
    "Imported from the website lead-generation engine.",
    `Source: ${candidate.rawPage?.url ?? "unknown"}`,
    candidate.dataQualityScore !== null ? `Data quality: ${candidate.dataQualityScore}/100` : null,
  ]
    .filter(Boolean)
    .join("\n")
}

// §53: one logical lead per (company, contact) pair; reimports reuse (§54).
async function findExistingLead(orgId: string, companyId: string | null, contactId: string | null, tx: Prisma.TransactionClient | typeof prisma) {
  return tx.lead.findFirst({
    where: { organizationId: orgId, companyId, contactId },
    orderBy: { createdAt: "asc" },
  })
}

async function writeConversionActivity(orgId: string, actorId: string | undefined, candidate: CandidateRow, leadId: string, db: Prisma.TransactionClient) {
  await createActivity(orgId, {
    leadId,
    type: ActivityType.NOTE,
    title: `Converted from lead candidate #${candidate.id.slice(-6)}`,
    description: [
      `Source: ${candidate.rawPage?.url ?? "unknown"}`,
      candidate.dataQualityScore !== null ? `Data quality: ${candidate.dataQualityScore}/100` : null,
      "Candidate → Company/Contact/Lead conversion (TASK 010).",
    ]
      .filter(Boolean)
      .join("\n"),
  }, actorId ?? undefined, db)
}

// ── Single conversion (§28-§32, §49) ──────────────────────────────────────

export async function convertCandidate(orgId: string, candidateId: string, actorId?: string): Promise<ConversionResult> {
  const candidate = await prisma.leadCandidate.findFirst({
    where: { id: candidateId, organizationId: orgId },
    select: candidateSelect,
  })
  if (!candidate) return { ok: false, code: "CANDIDATE_NOT_FOUND", error: "Candidate not found in this organization" }

  const existing = candidate.conversions[0]
  if (existing?.status === ConversionStatus.CONVERTED) {
    return { ok: true, code: "ALREADY_CONVERTED", conversion: { ...existing, candidateId: candidate.id }, companyAction: "REUSE", contactAction: "REUSE" }
  }

  // §33: duplicate candidates convert through their canonical candidate,
  // never alone — resolve BEFORE the eligibility gate, which blocks DUPLICATE.
  let sourceCandidate = candidate
  if (candidate.status === CandidateStatus.DUPLICATE) {
    const canonicalId = await canonicalCandidateId(orgId, candidateId)
    if (!canonicalId) return { ok: false, code: "DUPLICATE_NOT_RESOLVED", error: "Duplicate candidate has no resolved canonical counterpart" }
    const canon = await prisma.leadCandidate.findFirst({ where: { id: canonicalId, organizationId: orgId }, select: candidateSelect })
    if (!canon) return { ok: false, code: "DUPLICATE_NOT_RESOLVED", error: "Canonical candidate not found" }
    const canonExisting = canon.conversions[0]
    if (canonExisting?.status === ConversionStatus.CONVERTED) {
      return { ok: true, code: "ALREADY_CONVERTED", conversion: { ...canonExisting, candidateId: candidate.id }, companyAction: "REUSE", contactAction: "REUSE" }
    }
    sourceCandidate = canon
  }

  const gate = canConvertCandidate(sourceCandidate)
  if (!gate.eligible) {
    return { ok: false, code: gate.code, error: gate.reason }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const domain = sourceCandidate.companyDomain ? normalizeDomain(sourceCandidate.companyDomain) : null
      const normalizedName = sourceCandidate.normalizedCompanyName ?? normalizeCompanyName(sourceCandidate.companyName ?? "")

      // 1. Company (§12)
      const existingCompany = await findClosestCompany(orgId, domain, normalizedName, tx)
      let companyAction: "CREATE" | "REUSE" = "REUSE"
      let companyId: string
      if (existingCompany && "ambiguity" in existingCompany) {
        await recordFailure(orgId, candidate, existing, ConversionStatus.FAILED, "AMBIGUOUS_COMPANY", "Multiple existing companies match, or the name match has a conflicting domain. No company was created — review before converting.")
        throw new ConversionBlocked({ code: "AMBIGUOUS_COMPANY" })
      } else if (existingCompany) {
        companyId = existingCompany.id
        // §56: fill empty fields; never overwrite populated manual data.
        if (!existingCompany.source) {
          await tx.company.update({ where: { id: companyId }, data: { source: SCRAPER_SOURCE, sourceCandidateId: sourceCandidate.id } })
        }
      } else {
        companyAction = "CREATE"
        const created = await tx.company.create({ data: { organizationId: orgId, ...companyCreateData(sourceCandidate) } })
        companyId = created.id
      }

      // 2. Contact (§14-§18). Company-only candidates are valid (§37).
      let contactAction: "CREATE" | "REUSE" = "REUSE"
      let contactId: string | null = null
      if (candidatePersonExists(sourceCandidate)) {
        const existingContact = await findClosestContact(orgId, sourceCandidate, tx)
        if (existingContact) {
          contactId = existingContact.id
          if (!existingContact.companyId && companyId) {
            await tx.contact.update({ where: { id: contactId }, data: { companyId } })
          }
        } else {
          const built = contactCreateData(sourceCandidate)
          if (built) {
            contactAction = "CREATE"
            const created = await tx.contact.create({ data: { organizationId: orgId, companyId, ...built } })
            contactId = created.id
          }
        }
      }

      // 3. Lead (§22-§24, §53).
      const existingLead = await findExistingLead(orgId, companyId, contactId, tx)
      let leadId: string
      if (existingLead) {
        leadId = existingLead.id
        const fill: Prisma.LeadUncheckedUpdateInput = {}
        if (!existingLead.source) fill.source = SCRAPER_SOURCE
        if (!existingLead.sourceCandidateId) fill.sourceCandidateId = sourceCandidate.id
        if (Object.keys(fill).length > 0) await tx.lead.update({ where: { id: leadId }, data: fill })
      } else {
        const created = await tx.lead.create({
          data: {
            organizationId: orgId,
            companyId,
            contactId,
            title: leadTitle(sourceCandidate),
            notes: leadNotes(sourceCandidate),
            source: SCRAPER_SOURCE,
            sourceCandidateId: sourceCandidate.id,
          },
        })
        leadId = created.id
      }

      // 4. Conversion record + candidate state (§10, §28).
      const conversion = await tx.leadCandidateConversion.create({
        data: {
          organizationId: orgId,
          candidateId: sourceCandidate.id,
          companyId,
          contactId,
          leadId,
          status: ConversionStatus.CONVERTED,
          convertedById: actorId ?? null,
          convertedAt: new Date(),
        },
      })
      await tx.leadCandidate.update({ where: { id: sourceCandidate.id }, data: { status: CandidateStatus.CONVERTED } })
      if (sourceCandidate.id !== candidate.id) {
        await tx.leadCandidateConversion.create({
          data: {
            organizationId: orgId,
            candidateId: candidate.id,
            companyId,
            contactId,
            leadId,
            status: ConversionStatus.CONVERTED,
            convertedById: actorId ?? null,
            convertedAt: new Date(),
          },
        })
        await tx.leadCandidate.update({ where: { id: candidate.id }, data: { status: CandidateStatus.CONVERTED } })
      }
      await writeConversionActivity(orgId, actorId, sourceCandidate, leadId, tx)
      return { conversion: { id: conversion.id, companyId, contactId, leadId, candidateId: candidate.id }, companyAction, contactAction }
    })
    // TASK 012 §20: a converted candidate becomes a CRM lead — score it.
    if (result.conversion.leadId) {
      try {
        await scoreLead(orgId, result.conversion.leadId, { actor: actorId ? { id: actorId, name: "" } : null })
      } catch (e) {
        console.log(`scoring.conversion.failed leadId=${result.conversion.leadId} error=${e instanceof Error ? e.message : "unknown"}`)
      }
    }
    return {
      ok: true,
      conversion: { id: result.conversion.id, status: ConversionStatus.CONVERTED, companyId: result.conversion.companyId, contactId: result.conversion.contactId, leadId: result.conversion.leadId, candidateId: candidate.id },
      companyAction: result.companyAction,
      contactAction: result.contactAction,
    }
  } catch (e) {
    if (e instanceof ConversionBlocked) {
      return { ok: false, code: "AMBIGUOUS_COMPANY", error: "Multiple existing companies match, or the name match has a conflicting domain. Review before converting." }
    }
    const uniqueViolation = (e as Error).message?.includes("unique constraint") || (e as Error).message?.startsWith("ERROR: duplicate key")
    if (uniqueViolation) {
      // §30/§62: a concurrent conversion lost the race — return the winner.
      const after = await prisma.leadCandidateConversion.findUnique({ where: { candidateId: candidate.id } })
      if (after?.status === ConversionStatus.CONVERTED) {
        return { ok: true, code: "ALREADY_CONVERTED", conversion: { id: after.id, status: after.status, companyId: after.companyId, contactId: after.contactId, leadId: after.leadId, candidateId: candidate.id }, companyAction: "REUSE", contactAction: "REUSE" }
      }
    }
    await recordFailure(orgId, candidate, existing, ConversionStatus.FAILED, "DATABASE_ERROR", "Conversion failed; please retry.")
    return { ok: false, code: "DATABASE_ERROR", error: "Conversion failed; please retry." }
  }
}

class ConversionBlocked extends Error {
  result: { code: ConversionErrorCode }
  constructor(result: { code: ConversionErrorCode }) {
    super(result.code)
    this.result = result
  }
}

async function recordFailure(
  orgId: string,
  candidate: CandidateRow,
  existing: { id: string; status: ConversionStatus } | null,
  status: "FAILED" | "SKIPPED" | "NEEDS_REVIEW",
  code: string,
  message: string,
) {
  const data = { status, errorMessage: `${code}: ${message}` }
  if (existing) {
    return prisma.leadCandidateConversion.update({ where: { id: existing.id }, data })
  }
  return prisma.leadCandidateConversion.create({ data: { organizationId: orgId, candidateId: candidate.id, ...data } })
}

// ── Preview (§51-§52): read-only lookahead ────────────────────────────────

export interface PreviewPlan {
  candidateId: string
  status: string
  company: { action: "CREATE" | "REUSE" | "BLOCKED"; name?: string }
  contact: { action: "CREATE" | "REUSE" | "NONE"; name?: string }
  lead: { action: "CREATE" | "REUSE"; title?: string }
  error?: string
}

export async function previewCandidate(orgId: string, candidateId: string): Promise<PreviewPlan> {
  const candidate = await prisma.leadCandidate.findFirst({
    where: { id: candidateId, organizationId: orgId },
    select: candidateSelect,
  })
  if (!candidate) return { candidateId, status: "BLOCKED", company: { action: "BLOCKED" }, contact: { action: "NONE" }, lead: { action: "REUSE" }, error: "Candidate not found" }
  if (candidate.conversions[0]?.status === ConversionStatus.CONVERTED) {
    return { candidateId, status: "ALREADY_CONVERTED", company: { action: "REUSE" }, contact: { action: "REUSE" }, lead: { action: "REUSE" } }
  }
  const gate = canConvertCandidate(candidate)
  if (!gate.eligible) {
    return { candidateId, status: "BLOCKED", company: { action: "BLOCKED" }, contact: { action: "NONE" }, lead: { action: "REUSE" }, error: gate.reason }
  }

  let resolved = candidate
  if (candidate.status === CandidateStatus.DUPLICATE) {
    const canonicalId = await canonicalCandidateId(orgId, candidateId)
    if (!canonicalId) return { candidateId, status: "BLOCKED", company: { action: "BLOCKED" }, contact: { action: "NONE" }, lead: { action: "REUSE" }, error: "Duplicate candidate without canonical counterpart" }
    const canonical = await prisma.leadCandidate.findFirst({ where: { id: canonicalId, organizationId: orgId }, select: candidateSelect })
    if (!canonical) return { candidateId, status: "BLOCKED", company: { action: "BLOCKED" }, contact: { action: "NONE" }, lead: { action: "REUSE" }, error: "Canonical candidate not found" }
    resolved = canonical
  }

  const domain = resolved.companyDomain ? normalizeDomain(resolved.companyDomain) : null
  const normalizedName = resolved.normalizedCompanyName ?? normalizeCompanyName(resolved.companyName ?? "")
  const companyMatch = await findClosestCompany(orgId, domain, normalizedName, prisma)
  const company: PreviewPlan["company"] = companyMatch && "ambiguity" in companyMatch
    ? { action: "BLOCKED", name: resolved.companyName ?? undefined }
    : companyMatch
      ? { action: "REUSE", name: companyMatch.name }
      : { action: "CREATE", name: resolved.companyName ?? domain ?? undefined }

  const contact: PreviewPlan["contact"] = { action: "NONE" }
  if (candidatePersonExists(resolved)) {
    const existingContact = await findClosestContact(orgId, resolved, prisma)
    if (existingContact) contact.action = "REUSE"
    else contact.action = "CREATE"
    contact.name = resolved.contactFullName?.trim() || undefined
  }

  const lead: PreviewPlan["lead"] = { action: "CREATE", title: leadTitle(resolved) }
  if (company.action !== "BLOCKED") {
    const companyId = companyMatch && "ambiguity" in companyMatch ? null : companyMatch ? companyMatch.id : null
    if (companyId) {
      const contactId = contact.action === "REUSE" ? await prisma.contact.findFirst({ where: { organizationId: orgId, fullName: contact.name ?? "" } }).then((c) => c?.id ?? null) : null
      if (await findExistingLead(orgId, companyId, contactId, prisma)) lead.action = "REUSE"
    }
  }

  return { candidateId, status: company.action === "BLOCKED" ? "NEEDS_REVIEW" : "READY", company, contact, lead }
}

// ── Bulk (§41-§43, §63-§65) ───────────────────────────────────────────────

// Sequential per candidate; each convert runs in its own transaction (§41-§42).
// ponytail: plain loop, no queue — fine until organic volume warrants the
// existing job-queue; candidates stay independent and retryable.
export async function bulkConvert(orgId: string, candidateIds: string[], actorId?: string): Promise<BulkSummary> {
  const summary: BulkSummary = { selected: candidateIds.length, converted: 0, alreadyConverted: 0, needsReview: 0, skipped: 0, failed: [] }
  for (const candidateId of candidateIds) {
    const result = await convertCandidate(orgId, candidateId, actorId)
    if (result.ok && !result.code) {
      summary.converted++
    } else if (result.ok && result.code === "ALREADY_CONVERTED") {
      summary.alreadyConverted++
    } else if (result.code === "AMBIGUOUS_COMPANY" || result.code === "AMBIGUOUS_CONTACT" || result.code === "DUPLICATE_NOT_RESOLVED") {
      summary.needsReview++
      summary.failed.push({ candidateId, code: result.code, error: result.error ?? result.code })
    } else {
      summary.skipped++
      summary.failed.push({ candidateId, code: result.code ?? "ERROR", error: result.error ?? "unknown error" })
    }
  }
  return summary
}

export async function bulkPreview(orgId: string, candidateIds: string[]): Promise<PreviewPlan[]> {
  return Promise.all(candidateIds.map((id) => previewCandidate(orgId, id)))
}