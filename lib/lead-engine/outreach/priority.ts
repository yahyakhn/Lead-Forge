// TASK 015 §4-§6: deterministic outreach priority and outreach readiness.
// Priority is a weighted composite — no single score is hardcoded (§4).
// Readiness is a separate concept from ICP/lead score: a 95-score lead
// without an email is never READY (§5).

import type { EmailStatus, OutreachStatus } from "@/generated/prisma/enums"

// Email statuses that make an address usable for outreach (verified or not).
export const USABLE_EMAIL_STATUSES: EmailStatus[] = ["VERIFIED", "LIKELY_VALID", "DISCOVERED", "RISKY", "DISPOSABLE", "CONFLICT", "STALE", "UNKNOWN"]
// Verified-only (verification policy may restrict sending to these).
export const VERIFIED_EMAIL_STATUSES: EmailStatus[] = ["VERIFIED", "LIKELY_VALID"]
export const BLOCKED_EMAIL_STATUSES: EmailStatus[] = ["INVALID", "REJECTED", "DO_NOT_CONTACT", "UNSUBSCRIBED"]

export type OutreachReadinessState = "READY" | "MISSING_EMAIL" | "EMAIL_UNVERIFIED" | "MISSING_CONTACT" | "RECENTLY_CONTACTED" | "DO_NOT_CONTACT" | "PAUSED"

export const OUTREACH_READINESS_STATES: OutreachReadinessState[] = ["READY", "MISSING_EMAIL", "EMAIL_UNVERIFIED", "MISSING_CONTACT", "RECENTLY_CONTACTED", "DO_NOT_CONTACT", "PAUSED"]

export interface OutreachReadinessInput {
  status: string
  doNotContact: boolean
  contactDoNotContact?: boolean
  hasContact: boolean
  emailStatuses: EmailStatus[]
  allowUnverified: boolean
  minDaysBetweenOutreach: number
  lastOutboundAt?: Date | null
  now?: Date
}

export interface OutreachReadinessResult {
  state: OutreachReadinessState
  reasons: string[]
}

const PAUSED_LEAD_STATUSES = new Set(["DISQUALIFIED", "LOST", "CONVERTED"])

export function outreachReadiness(input: OutreachReadinessInput): OutreachReadinessResult {
  const now = input.now ?? new Date()
  if (input.doNotContact || input.contactDoNotContact) return { state: "DO_NOT_CONTACT", reasons: ["Lead or contact is marked do-not-contact"] }
  if (PAUSED_LEAD_STATUSES.has(input.status)) return { state: "PAUSED", reasons: [`Lead status is ${input.status}`] }
  if (!input.hasContact) return { state: "MISSING_CONTACT", reasons: ["No contact associated with this lead"] }

  const usable = input.emailStatuses.filter((s) => USABLE_EMAIL_STATUSES.includes(s))
  if (usable.length === 0) return { state: "MISSING_EMAIL", reasons: ["No usable email address"] }
  if (input.emailStatuses.some((s) => BLOCKED_EMAIL_STATUSES.includes(s)) && usable.length === 0) {
    return { state: "MISSING_EMAIL", reasons: ["All email addresses are blocked (invalid, do-not-contact or unsubscribed)"] }
  }

  if (!input.allowUnverified && !usable.some((s) => VERIFIED_EMAIL_STATUSES.includes(s))) {
    return { state: "EMAIL_UNVERIFIED", reasons: ["No verified email address and organization policy requires verification"] }
  }

  if (input.lastOutboundAt && input.minDaysBetweenOutreach > 0) {
    const cooldownMs = input.minDaysBetweenOutreach * 86400000
    if (now.getTime() - input.lastOutboundAt.getTime() < cooldownMs) {
      const daysAgo = Math.max(0, Math.round((now.getTime() - input.lastOutboundAt.getTime()) / 86400000))
      return { state: "RECENTLY_CONTACTED", reasons: [`Contacted ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago; cooldown is ${input.minDaysBetweenOutreach} days`] }
    }
  }

  return { state: "READY", reasons: ["Contact, email and policy checks pass"] }
}

// ── priority (§4) ─────────────────────────────────────────────────────────

export interface PriorityLead {
  id: string
  score: number | null
  contactReadiness: number | null
  emailStatuses: EmailStatus[]
  outreachStatus: OutreachStatus | null
  lastActivityAt: Date | null
  createdAt: Date
  ownerId: string | null
}

const EMAIL_PRIORITY: Record<string, number> = { VERIFIED: 800, LIKELY_VALID: 800, DISCOVERED: 300, UNKNOWN: 300, RISKY: 300, DISPOSABLE: 200, CONFLICT: 200, STALE: 200, INVALID: 0, REJECTED: 0, DO_NOT_CONTACT: 0, UNSUBSCRIBED: 0 }

export interface PriorityResult {
  priority: number
  breakdown: { score: number; readiness: number; email: number; recency: number; ownership: number; reply: number }
}

// Replies always outrank untouched leads (§79).
const REPLY_BONUS = 1500
const MY_LEAD_BONUS = 150
const NO_ACTIVITY_BONUS = 200
const NOT_CONTACTED_BONUS = 300

export function outreachPriority(lead: PriorityLead, viewerUserId: string): PriorityResult {
  const score = Math.max(0, Math.min(100, lead.score ?? 0))
  const readiness = Math.max(0, Math.min(100, lead.contactReadiness ?? 0))
  const email = Math.max(...(lead.emailStatuses.length > 0 ? lead.emailStatuses.map((s) => EMAIL_PRIORITY[s] ?? 0) : [0]))
  const reply = lead.outreachStatus === "REPLIED" ? REPLY_BONUS : lead.outreachStatus === "NOT_CONTACTED" ? NOT_CONTACTED_BONUS : 0
  const ownership = lead.ownerId === viewerUserId ? MY_LEAD_BONUS : 0
  let recency = NO_ACTIVITY_BONUS
  if (lead.lastActivityAt) recency = Math.max(0, NO_ACTIVITY_BONUS - Math.floor((Date.now() - lead.lastActivityAt.getTime()) / 86400000) * 5)
  const priority = score * 1000 + readiness * 20 + email + reply + ownership + recency
  return { priority, breakdown: { score, readiness, email, recency, ownership, reply } }
}

// Deterministic ordering helper: priority desc, then newest first.
export function sortByPriority<T extends PriorityLead>(leads: T[], viewerUserId: string): T[] {
  return [...leads].sort((a, b) => {
    const pa = outreachPriority(a, viewerUserId).priority
    const pb = outreachPriority(b, viewerUserId).priority
    if (pa !== pb) return pb - pa
    return b.createdAt.getTime() - a.createdAt.getTime()
  })
}