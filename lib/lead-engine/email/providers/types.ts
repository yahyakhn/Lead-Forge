// TASK 014 §4, §55-§56: provider abstractions. Providers are pluggable; the
// registry decides availability, EmailSettings decides per-org enablement.

import type { EmailSourceType } from "@/generated/prisma/enums"

export type EmailProviderCapability = "DISCOVERY" | "VERIFICATION" | "SENDING"

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

// ── sending (TASK 015 §13) ────────────────────────────────────────────────

export interface EmailOutboundMessage {
  to: string
  cc?: string
  bcc?: string
  subject: string
  body: string
  from?: string
  replyTo?: string
}

export interface EmailSendResult {
  ok: boolean
  providerMessageId?: string
  errorCode?: string
  errorMessage?: string
}

// Normalized inbound provider event. Event types map 1:1 to
// EmailWebhookEvent.eventType and are only processed when the provider
// actually supports them (§56).
export interface EmailProviderEvent {
  providerEventId: string
  eventType: "delivered" | "bounced" | "failed" | "opened" | "clicked" | "complaint" | "unsubscribe" | "reply"
  subjectId?: string
  email?: string
  subject?: string
  body?: string
  bounceType?: "hard" | "soft"
}

export interface EmailSendingProvider {
  id: string
  name: string
  capabilities: EmailProviderCapability[]
  send(message: EmailOutboundMessage): Promise<EmailSendResult>
  parseWebhook?(payload: unknown): EmailProviderEvent[]
}

export interface EmailProvider
  extends EmailProviderDescriptor,
    Partial<EmailDiscoveryProvider>,
    Partial<EmailVerificationProvider>,
    Partial<EmailSendingProvider> {
  id: string
  name: string
  capabilities: EmailProviderCapability[]
}
