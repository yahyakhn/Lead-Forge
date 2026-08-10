// Identity normalization for entity resolution (TASK 009 §5-§8). All
// functions are pure and deterministic; originals are never modified.

import { normalizeDomain as normalizeDomainBase } from "@/lib/crm/normalize"
import { normalizeText as collapseSpaces } from "@/lib/lead-engine/extraction/normalize"

// ── Company names (§6) ────────────────────────────────────────────────────

// Legal suffixes removed ONLY for comparison; see spec §6 "Do not blindly
// remove meaningful words" — this list is deliberate and bounded.
const LEGAL_SUFFIXES =
  /\b(?:inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|pvt\s+ltd|private\s+limited|sa|sl|srl|s\.?r\.?l\.?|gmbh|ag|bv|nv|oü|oy|oyj|as|ab)\b/g

const PUNCTUATION = /[^a-z0-9\s]/g

export function normalizeCompanyName(name: string): string {
  return collapseSpaces(name)
    .toLowerCase()
    .replace(PUNCTUATION, " ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// Shared prefix scoring key for blocking (§37): first 4 chars of the
// normalized name. Short names fall back to the whole name.
export function companyNamePrefix(normalized: string): string {
  return normalized.slice(0, 4)
}

// ── Domains (§7, §12) ─────────────────────────────────────────────────────

// https://www.acme.com/ | http://acme.com/about | www.acme.com → acme.com
export function normalizeDomain(urlOrDomain: string): string | null {
  return normalizeDomainBase(urlOrDomain)
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@")
  if (at <= 0) return null
  return normalizeDomain(email.slice(at + 1))
}

// §8: free-mail providers are not company identity signals.
const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "outlook.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "hotmail.co.uk",
  "icloud.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "live.com",
  "msn.com",
  "me.com",
  "mail.com",
  "gmx.com",
  "gmx.de",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "sina.com",
  "naver.com",
  "fastmail.com",
  "hey.com",
  "tutanota.com",
])

export function isGenericEmailDomain(domain: string | null): boolean {
  return !!domain && GENERIC_EMAIL_DOMAINS.has(domain)
}

// ── Persons (§33) ─────────────────────────────────────────────────────────

// Comparison form only: lowercased, punctuation-stripped, single spaces.
export function normalizePersonName(name: string): string {
  return collapseSpaces(name).toLowerCase().replace(PUNCTUATION, " ").replace(/\s+/g, " ").trim()
}

// Full name → [first, last] tokens for similarity; "Jane A. Doe" and
// "Jane Doe" both key on "jane" + "doe" (used in contact similarity).
export function nameTokens(name: string): string[] {
  return normalizePersonName(name).split(" ").filter(Boolean)
}

export function hasFirstLastName(name: string): boolean {
  const tokens = nameTokens(name)
  return tokens.length >= 2 && tokens.some((t) => t.length > 1)
}

// ── LinkedIn (§11) ────────────────────────────────────────────────────────

// Only URL comparison, never crawling. Normalized form keeps protocol-free,
// www-free, lowercased path: https://www.linkedin.com/in/Jane-Doe → linkedin.com/in/jane-doe
export function normalizeLinkedInUrl(url: string): string | null {
  const domain = normalizeDomain(url)
  if (!domain) return null
  const lowered = url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "")
  const match = lowered.match(/linkedin\.com\/(?:company|in|school)\/[a-z0-9._%-]+/)
  if (!match) return null
  return `linkedin.com/${match[0].slice("linkedin.com/".length)}`
}