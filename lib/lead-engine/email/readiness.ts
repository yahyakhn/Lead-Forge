// TASK 014 §38-§40, §71-§73: Contact Readiness — a separate, deterministic
// sales-readiness metric. Deliberately distinct from ICP fit (TASK 012) and
// data quality (TASK 009). Pure formula + persistence with versioned history.

import { prisma } from "@/lib/db"
import { normalizePhone } from "@/lib/lead-engine/extraction/normalize"
import type { EmailStatus } from "@/generated/prisma/enums"

export const READINESS_VERSION = "v1"

export interface ReadinessInput {
  contactName?: string | null
  jobTitle?: string | null
  phone?: string | null
  website?: string | null
  domain?: string | null
  emailStatuses?: EmailStatus[]
  hasPublicEvidence?: boolean
}

export interface ReadinessBreakdown {
  verifiedEmail: number
  phone: number
  namedContact: number
  jobTitle: number
  website: number
  publicEvidence: number
}

export interface ReadinessResult {
  score: number
  version: string
  breakdown: ReadinessBreakdown
  reasons: string[]
}

export const READINESS_WEIGHTS = {
  verifiedEmail: 40,
  phone: 20,
  namedContact: 15,
  jobTitle: 10,
  website: 10,
  publicEvidence: 5,
} as const

const VERIFIED_STATUSES: EmailStatus[] = ["VERIFIED", "LIKELY_VALID"]
const ANY_EMAIL_STATUSES: EmailStatus[] = ["VERIFIED", "LIKELY_VALID", "DISCOVERED", "RISKY", "DISPOSABLE", "CONFLICT"]

// Deterministic, no randomness, no hidden inputs (§39, §72).
export function calculateReadiness(input: ReadinessInput): ReadinessResult {
  const breakdown: ReadinessBreakdown = { verifiedEmail: 0, phone: 0, namedContact: 0, jobTitle: 0, website: 0, publicEvidence: 0 }
  const reasons: string[] = []

  const hasVerified = (input.emailStatuses ?? []).some((s) => VERIFIED_STATUSES.includes(s))
  if (hasVerified) {
    breakdown.verifiedEmail = READINESS_WEIGHTS.verifiedEmail
    reasons.push("✓ Verified business email")
  } else if ((input.emailStatuses ?? []).some((s) => ANY_EMAIL_STATUSES.includes(s))) {
    reasons.push("⚠ Email discovered but not verified")
  } else {
    reasons.push("✗ No email on record")
  }

  if (input.phone && normalizePhone(input.phone)) {
    breakdown.phone = READINESS_WEIGHTS.phone
    reasons.push("✓ Phone available")
  } else {
    reasons.push("✗ No phone on record")
  }

  if (input.contactName?.trim()) {
    breakdown.namedContact = READINESS_WEIGHTS.namedContact
    reasons.push("✓ Named decision maker")
  } else {
    reasons.push("✗ No named contact")
  }

  if (input.jobTitle?.trim()) {
    breakdown.jobTitle = READINESS_WEIGHTS.jobTitle
    reasons.push("✓ Job title available")
  } else {
    reasons.push("✗ No job title")
  }

  if (input.website?.trim() || input.domain?.trim()) {
    breakdown.website = READINESS_WEIGHTS.website
    reasons.push("✓ Company website")
  } else {
    reasons.push("✗ No company website")
  }

  if (input.hasPublicEvidence) {
    breakdown.publicEvidence = READINESS_WEIGHTS.publicEvidence
    reasons.push("✓ Public source evidence")
  } else {
    reasons.push("⚠ No public source evidence")
  }

  const score = Object.values(breakdown).reduce((sum, v) => sum + v, 0)
  return { score, version: READINESS_VERSION, breakdown, reasons }
}

// ── persistence ───────────────────────────────────────────────────────────

export interface ReadinessEntity {
  leadId?: string
  candidateId?: string
}

// Appends a versioned readiness row (§73); Lead.contactReadiness mirrors the
// latest score for indexed sort/filter.
export async function persistReadiness(orgId: string, entity: ReadinessEntity, result: ReadinessResult): Promise<void> {
  await prisma.leadReadiness.create({
    data: {
      organizationId: orgId,
      ...(entity.leadId ? { leadId: entity.leadId } : { candidateId: entity.candidateId }),
      score: result.score,
      modelVersion: result.version,
      breakdown: result.breakdown as unknown as object,
      reasons: result.reasons as unknown as object,
    },
  })
  if (entity.leadId) {
    await prisma.lead.update({
      where: { id: entity.leadId },
      data: { contactReadiness: result.score },
    })
  }
}

export async function latestReadiness(orgId: string, entity: ReadinessEntity) {
  return prisma.leadReadiness.findFirst({
    where: { organizationId: orgId, ...(entity.leadId ? { leadId: entity.leadId } : { candidateId: entity.candidateId }) },
    orderBy: { calculatedAt: "desc" },
  })
}

export function readinessHistory(orgId: string, entity: ReadinessEntity) {
  return prisma.leadReadiness.findMany({
    where: { organizationId: orgId, ...(entity.leadId ? { leadId: entity.leadId } : { candidateId: entity.candidateId }) },
    orderBy: { calculatedAt: "desc" },
    take: 20,
  })
}