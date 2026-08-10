// Unit tests for entity resolution matching + normalization (TASK 009 §65-§66).

import { describe, expect, it } from "vitest"
import {
  decideMatch,
  entityDecision,
  nameSimilarity,
  companyNameSimilarity,
  levenshtein,
  scoreCompanyMatch,
  scoreContactMatch,
  THRESHOLDS,
} from "@/lib/lead-engine/resolution/match"
import {
  normalizeCompanyName,
  companyNamePrefix,
  normalizeDomain,
  emailDomain,
  isGenericEmailDomain,
  normalizePersonName,
  nameTokens,
  hasFirstLastName,
  normalizeLinkedInUrl,
} from "@/lib/lead-engine/resolution/normalize"

const C = (over: Record<string, unknown> = {}) => ({ id: "x", ...over })

describe("normalization", () => {
  it("normalizes company legal suffixes, case and whitespace", () => {
    expect(normalizeCompanyName("Acme, Inc.")).toBe("acme")
    expect(normalizeCompanyName("ACME INC")).toBe("acme")
    expect(normalizeCompanyName("Acme Incorporated")).toBe("acme")
    expect(normalizeCompanyName("Acme Pvt Ltd")).toBe("acme")
    expect(normalizeCompanyName("  Acme   Software  ")).toBe("acme software")
  })

  it("strips a stable blocking prefix", () => {
    expect(companyNamePrefix("acme software")).toBe("acme")
    expect(companyNamePrefix("")).toBe("")
  })

  it("normalizes domains to bare hostname", () => {
    expect(normalizeDomain("https://www.Acme.com/team")).toBe("acme.com")
    expect(normalizeDomain("acme.com")).toBe("acme.com")
  })

  it("extracts email domains and identifies generic ones", () => {
    expect(emailDomain("john@GMAIL.COM")).toBe("gmail.com")
    expect(emailDomain("john@acme.com")).toBe("acme.com")
    expect(isGenericEmailDomain("gmail.com")).toBe(true)
    expect(isGenericEmailDomain("acme.com")).toBe(false)
  })

  it("normalizes linkedin URLs to a canonical form", () => {
    expect(normalizeLinkedInUrl("https://www.linkedin.com/in/john-doe/")).toBe("linkedin.com/in/john-doe")
    expect(normalizeLinkedInUrl("http://linkedin.com/in/john-doe")).toBe("linkedin.com/in/john-doe")
  })

  it("person name normalization keeps token order and first+last detection", () => {
    expect(normalizePersonName("John   DOE")).toBe("john doe")
    expect(nameTokens("john doe")).toEqual(["john", "doe"])
    expect(hasFirstLastName("john doe")).toBe(true)
    expect(hasFirstLastName("john")).toBe(false)
  })
})

describe("similarity", () => {
  it("computes levenshtein distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3)
    expect(levenshtein("same", "same")).toBe(0)
  })

  it("treats legal-suffix variants of a company name as equal", () => {
    expect(companyNameSimilarity("Acme Software Inc", "Acme Software Incorporated")).toBe(1)
    expect(normalizeCompanyName("Acme Software Inc")).toBe(normalizeCompanyName("Acme Software Incorporated"))
  })

  it("scores clearly different names below the similar threshold", () => {
    expect(companyNameSimilarity("Acme Software", "Acme Systems")).toBeLessThan(0.72)
    expect(nameSimilarity("Alice Smith", "Bob Jones")).toBeLessThan(0.8)
  })
})

describe("decision thresholds", () => {
  it("centralizes the 90 / 70 cutoffs", () => {
    expect(THRESHOLDS).toEqual({ AUTO_MATCH: 90, REVIEW: 70 })
    expect(decideMatch(90)).toBe("AUTO_MATCH")
    expect(decideMatch(89)).toBe("REVIEW")
    expect(decideMatch(70)).toBe("REVIEW")
    expect(decideMatch(69)).toBe("NOT_MATCH")
  })
})

describe("company matching", () => {
  it("auto-matches identical domains with matching names", () => {
    const a = C({ companyName: "Acme Inc", companyDomain: "acme.com" })
    const b = C({ companyName: "Acme, Inc.", companyDomain: "https://www.acme.com/" })
    const r = scoreCompanyMatch(a, b)
    expect(r.score).toBe(170)
    expect(r.reasons).toEqual(["DOMAIN_EXACT", "COMPANY_NAME_EXACT"])
    expect(decideMatch(r.score)).toBe("AUTO_MATCH")
  })

  it("auto-matches on the same non-generic email domain plus company name", () => {
    const a = C({ companyName: "Acme Inc", email: "john@acme.com" })
    const b = C({ companyName: "Acme Corp", email: "jane@acme.com" })
    const r = scoreCompanyMatch(a, b)
    expect(r.reasons).toContain("EMAIL_DOMAIN_EXACT")
    expect(r.score).toBeGreaterThanOrEqual(90)
    expect(decideMatch(r.score)).toBe("AUTO_MATCH")
  })

  it("only flags a review when the name matches without domain evidence", () => {
    const a = C({ companyName: "Acme Software", companyDomain: "acme-soft.io" })
    const b = C({ companyName: "Acme Software", companyDomain: "acmesoftware.co" })
    const r = scoreCompanyMatch(a, b)
    expect(r.score).toBe(70)
    expect(r.reasons).toEqual(["COMPANY_NAME_EXACT"])
    expect(decideMatch(r.score)).toBe("REVIEW")
  })

  it("does not merge unrelated companies", () => {
    const r = scoreCompanyMatch(
      C({ companyName: "Northwind Software", companyDomain: "northwind.io" }),
      C({ companyName: "Globex Systems", companyDomain: "globex.com" }),
    )
    expect(decideMatch(r.score)).toBe("NOT_MATCH")
    expect(r.reasons).toEqual([])
  })
})

describe("contact matching", () => {
  it("auto-matches an exact email regardless of case", () => {
    const r = scoreContactMatch(C({ email: "John@Acme.com", contactFullName: "John Doe" }), C({ email: "john@acme.com", contactFullName: "J. Doe" }))
    expect(r.score).toBe(100)
    expect(r.reasons).toEqual(["EMAIL_EXACT"])
    expect(decideMatch(r.score)).toBe("AUTO_MATCH")
  })

  it("auto-matches an exact linkedin profile", () => {
    const a = C({ linkedinUrl: "https://www.linkedin.com/in/john-doe/" })
    const b = C({ linkedinUrl: "linkedin.com/in/john-doe" })
    const r = scoreContactMatch(a, b)
    expect(r.score).toBe(100)
    expect(decideMatch(r.score)).toBe("AUTO_MATCH")
  })

  it("flags a review for same name at the same company without email", () => {
    const a = C({ contactFullName: "John Doe", companyName: "Acme Inc", companyDomain: "acme.com" })
    const b = C({ contactFullName: "John Doe", companyName: "Acme, Inc.", companyDomain: "acme.com" })
    const r = scoreContactMatch(a, b)
    expect(r.score).toBe(70)
    expect(r.reasons).toContain("CONTACT_NAME_EXACT")
    expect(r.reasons).toContain("CONTACT_COMPANY_MATCH")
    expect(decideMatch(r.score)).toBe("REVIEW")
  })

  it("never auto-matches on name alone", () => {
    const r = scoreContactMatch(C({ contactFullName: "John Doe" }), C({ contactFullName: "John Doe" }))
    expect(r.score).toBe(50)
    expect(decideMatch(r.score)).toBe("NOT_MATCH")
  })

  it("treats a lone phone match as review, not auto", () => {
    const r = scoreContactMatch(C({ phone: "+14155550134" }), C({ phone: "+1 415-555-0134" }))
    expect(r.score).toBe(85)
    expect(r.reasons).toEqual(["PHONE_EXACT"])
    expect(decideMatch(r.score)).toBe("REVIEW")
  })
})

describe("entity decision", () => {
  it("picks the higher of company vs contact scores", () => {
    const a = C({ companyName: "Acme Inc", companyDomain: "acme.com", contactFullName: "Alice Brown" })
    const b = C({ companyName: "Acme, Inc.", companyDomain: "acme.com", contactFullName: "Bob Green" })
    const { entityType, match } = entityDecision(a, b)
    expect(entityType).toBe("COMPANY")
    expect(match.score).toBe(170)
  })
})