// TASK 014 §5-§8, §75: first-party discovery from existing evidence — the
// TASK 007 crawler output, TASK 008 extraction and TASK 013 enrichment
// results already on record. No second crawler, no guessing (§7), no
// fabricated addresses. Only explicitly published emails are harvested.

import { prisma } from "@/lib/db"
import { EnrichmentResultStatus } from "@/generated/prisma/enums"
import type { EmailDiscoveryEvidence, EmailDiscoveryInput, EmailDiscoveryOutcome, EmailDiscoveryProvider, EmailDiscoveryTarget } from "@/lib/lead-engine/email/providers/types"
import { normalizeEmailAddress } from "@/lib/lead-engine/email/normalize"

// §54: source confidence of existing on-record evidence.
const CANDIDATE_EMAIL_CONFIDENCE = 0.8
const CANDIDATE_CONTACT_CONFIDENCE = 0.7
const ENRICHMENT_CONFIDENCE_SCALE = 1

const SOURCE_CONFIDENCE: Record<string, number> = {
  MANUAL: 0.99,
  IMPORT: 0.6,
  SCRAPER: 0.8,
  WEBSITE: 0.8,
  REFERRAL: 0.5,
}

export const internalDiscoveryProvider: EmailDiscoveryProvider = {
  id: "EXISTING_DATA",
  name: "Existing data (crawl, extraction, enrichment)",
  capabilities: ["DISCOVERY"],

  async discover(input: EmailDiscoveryInput): Promise<EmailDiscoveryOutcome> {
    const { organizationId, target } = input
    const found: EmailDiscoveryEvidence[] = []
    const seen = new Set<string>()

    const add = (evidence: EmailDiscoveryEvidence) => {
      const normalized = normalizeEmailAddress(evidence.email)
      if (!normalized || seen.has(normalized)) return
      seen.add(normalized)
      found.push({ ...evidence, email: normalized })
    }

    if (target.kind === "candidate") {
      const candidate = await prisma.leadCandidate.findFirst({
        where: { id: target.id, organizationId },
        select: {
          email: true,
          extractionConfidence: true,
          fieldProvenance: true,
          contacts: { select: { email: true } },
        },
      })
      if (candidate?.email) {
        add({
          email: candidate.email,
          sourceType: "PUBLIC_WEBSITE",
          sourceUrl: target.websiteUrl ?? undefined,
          confidence: round2(CANDIDATE_EMAIL_CONFIDENCE * (candidate.extractionConfidence ?? 0.7)),
          evidence: candidate.email,
        })
      }
      for (const contact of candidate?.contacts ?? []) {
        if (!contact.email) continue
        add({ email: contact.email, sourceType: "PUBLIC_WEBSITE", sourceUrl: target.websiteUrl ?? undefined, confidence: CANDIDATE_CONTACT_CONFIDENCE, evidence: contact.email })
      }

      const results = await prisma.enrichmentResult.findMany({
        where: { organizationId, candidateId: target.id, field: "email", status: { in: [EnrichmentResultStatus.NEW, EnrichmentResultStatus.CONFIRMED] } },
        select: { value: true, source: true, sourceUrl: true, evidence: true, confidence: true, observedAt: true },
      })
      for (const r of results) {
        add({ email: r.value, sourceType: r.source === "PUBLIC_WEBSITE" ? "PUBLIC_WEBSITE" : "ENRICHMENT", sourceUrl: r.sourceUrl ?? undefined, evidence: r.evidence ?? undefined, confidence: round2(r.confidence * ENRICHMENT_CONFIDENCE_SCALE), observedAt: r.observedAt })
      }
    } else {
      const lead = await prisma.lead.findFirst({
        where: { id: target.id, organizationId },
        include: {
          contact: { select: { email: true, source: true } },
        },
      })
      if (lead?.contact?.email) {
        add({
          email: lead.contact.email,
          sourceType: lead.contact.source === "IMPORT" ? "USER_IMPORT" : lead.contact.source === "MANUAL" ? "MANUAL" : lead.contact.source === "SCRAPER" ? "PUBLIC_WEBSITE" : "CRM",
          confidence: SOURCE_CONFIDENCE[lead.contact.source ?? ""] ?? 0.5,
          evidence: lead.contact.email,
        })
      }
      const results = await prisma.enrichmentResult.findMany({
        where: { organizationId, leadId: target.id, field: "email", status: { in: [EnrichmentResultStatus.NEW, EnrichmentResultStatus.CONFIRMED] } },
        select: { value: true, source: true, sourceUrl: true, evidence: true, confidence: true, observedAt: true },
      })
      for (const r of results) {
        add({ email: r.value, sourceType: r.source === "PUBLIC_WEBSITE" ? "PUBLIC_WEBSITE" : "ENRICHMENT", sourceUrl: r.sourceUrl ?? undefined, evidence: r.evidence ?? undefined, confidence: round2(r.confidence), observedAt: r.observedAt })
      }
    }

    return { emails: found }
  },
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function discoveryEligibilityOf(target: Pick<EmailDiscoveryTarget, "companyDomain" | "websiteUrl" | "email">): boolean {
  return Boolean(target.companyDomain || target.websiteUrl || target.email)
}
