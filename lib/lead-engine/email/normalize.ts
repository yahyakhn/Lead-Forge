// TASK 014 §9, §24, §31, §52-§53: email normalization, role/generic/disposable
// classification and domain-match. Pure and deterministic; no DB, no network.

import { normalizeEmail } from "@/lib/lead-engine/extraction/normalize"
import { normalizeDomain } from "@/lib/lead-engine/resolution/normalize"
import type { EmailDomainMatch, EmailType } from "@/generated/prisma/enums"

// §9: small configurable generic-domain list. Extensible via EmailSettings.
export const DEFAULT_GENERIC_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
]

// §10/§24: common role prefixes, recognized but never treated as personal.
export const DEFAULT_ROLE_PREFIXES = [
  "hello",
  "sales",
  "support",
  "info",
  "contact",
  "admin",
  "team",
  "help",
  "office",
  "enquiries",
  "inquiries",
  "careers",
  "jobs",
  "hr",
  "press",
  "media",
  "billing",
  "accounts",
  "marketing",
  "partnerships",
  "service",
]

// §23: locally maintained disposable-domain list — conservative, small,
// extendable via EmailSettings. Absence from the list means UNKNOWN, never
// "not disposable".
export const DEFAULT_DISPOSABLE_DOMAINS = [
  "mailinator.com",
  "guerrillamail.com",
  "temp-mail.org",
  "tempmail.com",
  "10minutemail.com",
  "throwawaymail.com",
  "mailnesia.com",
  "yopmail.com",
  "sharklasers.com",
  "guerrillamailblock.com",
  "maildrop.cc",
  "mailinator.net",
  "dispostable.com",
  "mailcatch.com",
  "spamgourmet.com",
  "trashmail.com",
  "mailexpire.com",
  "mailmoat.com",
  "emailondeck.com",
  "mytemp.email",
  "getnada.com",
  "inboxbear.com",
  "tmpmail.org",
  "burnermail.io",
  "fakemail.net",
  "mailtemp.net",
  "tempinbox.com",
  "spambox.us",
  "mintemail.com",
  "maildump.ru",
]

// §31: trim whitespace, lowercase, strip accidental surrounding punctuation.
export function normalizeEmailAddress(value: string): string | null {
  return normalizeEmail(value)
}

export function emailHost(email: string): string | null {
  const normalized = normalizeEmailAddress(email)
  if (!normalized) return null
  const at = normalized.lastIndexOf("@")
  return normalized.slice(at + 1)
}

export function isGenericDomain(host: string, genericDomains: readonly string[] = DEFAULT_GENERIC_DOMAINS): boolean {
  const h = host.toLowerCase()
  return genericDomains.some((d) => h === d || h.endsWith(`.${d}`))
}

export function isDisposableDomain(host: string, disposableDomains: readonly string[] = DEFAULT_DISPOSABLE_DOMAINS): boolean {
  const h = host.toLowerCase()
  return disposableDomains.some((d) => h === d || h.endsWith(`.${d}`))
}

export function isRolePrefix(local: string, rolePrefixes: readonly string[] = DEFAULT_ROLE_PREFIXES): boolean {
  const l = local.toLowerCase()
  if (rolePrefixes.includes(l)) return true
  return rolePrefixes.some((p) => l.startsWith(`${p}+`))
}

// §13: email type classification. PERSONAL_BUSINESS = named business contact
// email, never a private-life address. Role addresses are never personal.
export function classifyEmailType(localPart: string, host: string, rolePrefixes: readonly string[] = DEFAULT_ROLE_PREFIXES, genericDomains: readonly string[] = DEFAULT_GENERIC_DOMAINS): EmailType {
  if (isRolePrefix(localPart, rolePrefixes)) return "ROLE_BASED"
  if (isGenericDomain(host, genericDomains)) return "GENERIC"
  const local = localPart.toLowerCase()
  if (/^[a-z][a-z0-9.'_-]{1,40}$/.test(local) && !/^(admin|webmaster|postmaster|abuse|noreply|no-?reply|donotreply|unsubscribe)$/.test(local)) {
    return "PERSONAL_BUSINESS"
  }
  return "UNKNOWN"
}

// §52-§53: email vs company-domain relationship. Generic domains are flagged,
// never invalidated; mismatches are informational only.
export function domainMatch(email: string, companyDomain: string | null | undefined): EmailDomainMatch {
  const host = emailHost(email)
  if (!host) return "NOT_APPLICABLE"
  if (isGenericDomain(host)) return "GENERIC_DOMAIN"
  const normalized = normalizeDomain(companyDomain ?? "")
  if (!normalized) return "NOT_APPLICABLE"
  const registrable = (d: string) => {
    const labels = d.split(".")
    return labels.slice(-2).join(".")
  }
  if (registrable(host) === registrable(normalized)) return "DOMAIN_MATCH"
  return "DOMAIN_MISMATCH"
}
