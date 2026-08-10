// Field normalization for extracted data (spec §25-§29). Deliberately
// conservative: normalize the shape, never invent content.

import { normalizeDomain as normalizeDomainBase } from "@/lib/crm/normalize"

// https://www.example.com/about → example.com (public-suffix aware naive
// guard: keeps the first label plus the rest; single-label hosts pass).
export function normalizeDomain(urlOrDomain: string): string | null {
  return normalizeDomainBase(urlOrDomain)
}

// Same registrable-domain check used to accept an AI-suggested domain.
export function sameDomain(a: string, b: string): boolean {
  const da = normalizeDomain(a)
  const db = normalizeDomain(b)
  if (!da || !db) return false
  const registrable = (d: string) => {
    const labels = d.split(".")
    return labels.slice(-2).join(".")
  }
  return registrable(da) === registrable(db)
}

const TRACKING_PARAMS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"])

// Strip tracking params (§26). Other query parameters are preserved.
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key)
    }
    parsed.hash = ""
    return parsed.toString()
  } catch {
    return url
  }
}

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

// "John   Smith" → "John Smith". Split on the last space; a single token
// stays as the full name (never destroy compound names).
export function splitName(fullName: string): { firstName: string; lastName?: string } {
  const part = normalizeText(fullName)
  const idx = part.lastIndexOf(" ")
  if (idx <= 0 || idx === part.length - 1) return { firstName: part }
  return { firstName: part.slice(0, idx), lastName: part.slice(idx + 1) }
}

export function isPlausibleName(value: string): boolean {
  if (!value || value.length < 2 || value.length > 80) return false
  if (/\d/.test(value)) return false
  const parts = value.split(/\s+/)
  if (parts.length > 5) return false
  return parts.every((part) => /^[A-ZÀ-ÿ][a-zà-ÿ'-]*$/.test(part.replace(/^[("']+|["'),.]+$/g, "")))
}

// Conservative email validation/normalization (§29): lowercase, trim, and
// require a real host with a dot. No verification claims.
export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase().replace(/^[<("']+|[>)"']+$/g, "")
  if (email.length > 254 || email.includes(" ")) return null
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return null
  const [local, host] = email.split("@")
  if (!local || !host.includes(".")) return null
  if (/^(example|test|foo|bar|invalid|no-?reply|donotreply)@/i.test(email)) return null
  return email
}

// Normalized phone = digits with optional leading + (spec §19). Country
// prefix is never guessed; when absent the normalized form preserves the
// local digits only.
export function normalizePhone(value: string): string | null {
  const raw = value.trim().replace(/[().\s-]/g, "")
  if (!/^\+?\d{6,15}$/.test(raw)) return null
  const digits = raw.replace(/\D/g, "")
  if (digits.length < 6 || digits.length > 15) return null
  return raw.startsWith("+") ? `+${digits}` : digits
}

export const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

export const PHONE_PATTERNS: RegExp[] = [
  /\+\d{1,3}[ .-]?\(\d{1,4}\)[ .-]?\d{2,4}[ .-]?\d{2,4}[ .-]?\d{2,4}/g,
  /(?<![\d+])(?:0{1,2}\d{1,2}|[1-9]\d{0,1})[ .-]?\d{3,4}[ .-]?\d{4}(?!\d)/g,
]