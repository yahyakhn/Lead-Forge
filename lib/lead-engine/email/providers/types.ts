// TASK 014 §4, §55-§56: provider abstractions. Providers are pluggable; the
// registry decides availability, EmailSettings decides per-org enablement.

import type { EmailSourceType } from "@/generated/prisma/enums"

export type EmailProviderCapability = "DISCOVERY" | "VERIFICATION"

export interface EmailProviderDescriptor {
  id: string
  name: string
  capabilities: EmailProviderCapability[]
}

// ── discovery ─────────────────────────────────────────────────────────────

export interface EmailDiscoveryEvidence {
  email: string
  sourceType: EmailSourceType
  sourceUrl?: string
  evidence?: string
  confidence: number
  observedAt?: Date
}

export interface EmailDiscoveryTarget {
  kind: "lead" | "candidate"
  id: string
  companyName?: string | null
  companyDomain?: string | null
  websiteUrl?: string | null
  contactFullName?: string | null
  email?: string | null
}

export interface EmailDiscoveryInput {
  organizationId: string
  target: EmailDiscoveryTarget
  jobId: string
  forceRefresh: boolean
}

export interface EmailDiscoveryOutcome {
  emails: EmailDiscoveryEvidence[]
  errorCode?: string
  errorMessage?: string
}

export interface EmailDiscoveryProvider {
  id: string
  name: string
  capabilities: EmailProviderCapability[]
  discover(input: EmailDiscoveryInput): Promise<EmailDiscoveryOutcome>
}

// ── verification ──────────────────────────────────────────────────────────

export interface EmailVerificationResult {
  email: string
  syntaxValid: boolean
  domainValid: boolean | null
  mxPresent: boolean | null
  disposable: boolean
  roleBased: boolean
  status: "VERIFIED" | "LIKELY_VALID" | "UNKNOWN" | "INVALID" | "RISKY" | "DISPOSABLE"
  confidence: number
  checkedAt: Date
  provider: string
  errorCode?: string
}

export interface EmailVerificationProvider {
  id: string
  name: string
  capabilities: EmailProviderCapability[]
  verify(email: string, options?: Record<string, unknown>): Promise<EmailVerificationResult>
}

export interface EmailProvider
  extends EmailProviderDescriptor,
    Partial<EmailDiscoveryProvider>,
    Partial<EmailVerificationProvider> {
  id: string
  name: string
  capabilities: EmailProviderCapability[]
}
