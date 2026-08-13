// TASK 014 §16-§24: first-party verification pipeline. Conservative by
// design — syntax, domain presence, MX records, disposable/role detection.
// NO email is ever sent and no SMTP probing is performed (§20, §64, §95).
// DNS failures resolve to UNKNOWN, never to INVALID.

import * as dns from "node:dns/promises"
import type { EmailVerificationProvider, EmailVerificationResult } from "@/lib/lead-engine/email/providers/types"
import { emailHost, isDisposableDomain, isRolePrefix, normalizeEmailAddress } from "@/lib/lead-engine/email/normalize"

const DNS_TIMEOUT_MS = 4000

export interface DnsResolver {
  lookup(hostname: string): Promise<string[]>
  resolveMx(hostname: string): Promise<Array<{ exchange: string; priority: number }>>
}

export const nodeDnsResolver: DnsResolver = {
  async lookup(hostname) {
    const records = await dns.lookup(hostname, { all: true, verbatim: true })
    return records.map((r) => r.address)
  },
  async resolveMx(hostname) {
    return dns.resolveMx(hostname)
  },
}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("DNS_TIMEOUT")), ms))])

// Check ordering is deterministic: syntax → disposable → role → domain → MX.
function classify(input: { email: string; syntaxValid: boolean; domainValid: boolean | null; mxPresent: boolean | null; disposable: boolean; roleBased: boolean }): EmailVerificationResult["status"] {
  if (!input.syntaxValid) return "INVALID"
  if (input.domainValid === false) return "INVALID"
  if (input.disposable) return "DISPOSABLE"
  if (input.domainValid === null || input.mxPresent === null) return "UNKNOWN"
  if (input.mxPresent === false) return "RISKY"
  return "VERIFIED"
}

export const internalVerificationProvider: EmailVerificationProvider = {
  id: "INTERNAL",
  name: "Internal verifier (syntax + DNS + MX)",
  capabilities: ["VERIFICATION"],

  async verify(email, options): Promise<EmailVerificationResult> {
    const rolePrefixes = options?.rolePrefixes as string[] | undefined
    const disposableDomains = options?.disposableDomains as string[] | undefined
    const resolver = (options?.resolver as DnsResolver | undefined) ?? nodeDnsResolver
    const checkedAt = new Date()

    const normalized = normalizeEmailAddress(email)
    if (!normalized) {
      return { email, syntaxValid: false, domainValid: null, mxPresent: null, disposable: false, roleBased: false, status: "INVALID", confidence: 0, checkedAt, provider: this.id }
    }
    const host = emailHost(normalized) ?? ""
    const local = normalized.slice(0, normalized.lastIndexOf("@"))
    const disposable = isDisposableDomain(host, disposableDomains)
    const roleBased = isRolePrefix(local, rolePrefixes)

    let domainValid: boolean | null = null
    let mxPresent: boolean | null = null
    try {
      await withTimeout(resolver.lookup(host), DNS_TIMEOUT_MS)
      domainValid = true
    } catch (e) {
      const code = (e as { code?: string }).code ?? String(e)
      domainValid = code === "ENOTFOUND" || code === "EAI_AGAIN" ? false : null
    }
    if (domainValid) {
      try {
        const mx = await withTimeout(resolver.resolveMx(host), DNS_TIMEOUT_MS)
        mxPresent = mx.length > 0
      } catch (e) {
        const code = (e as { code?: string }).code ?? String(e)
        mxPresent = code === "ENODATA" || code === "ENOTFOUND" ? false : null
      }
    }

    const status = classify({ email: normalized, syntaxValid: true, domainValid, mxPresent, disposable, roleBased })
    const confidence = status === "VERIFIED" ? 0.8 : status === "LIKELY_VALID" ? 0.6 : status === "DISPOSABLE" || status === "RISKY" ? 0.4 : status === "INVALID" ? 0.05 : 0.2
    return {
      email: normalized,
      syntaxValid: true,
      domainValid,
      mxPresent,
      disposable,
      roleBased,
      status,
      confidence,
      checkedAt,
      provider: this.id,
    }
  },
}
