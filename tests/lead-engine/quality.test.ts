// Unit tests for data quality assessment + merge logic (TASK 009 §67).

import { describe, expect, it } from "vitest"
import {
  assessQuality,
  sourceQuality,
  QUALITY_WEIGHTS,
} from "@/lib/lead-engine/resolution/quality"
import {
  calculateCompleteness,
  pickCanonical,
  mergeFields,
  pairIds,
} from "@/lib/lead-engine/resolution/groups"

const complete = {
  companyName: "Acme Inc",
  companyDomain: "acme.com",
  contactFullName: "John Doe",
  email: "john@acme.com",
  phone: "+1 415 555 0134",
  linkedinUrl: "https://www.linkedin.com/in/john-doe/",
  websiteUrl: "https://acme.com",
  extractionConfidence: 0.92,
  extractionMethod: "HYBRID" as const,
  pageClassification: "TEAM",
  hasEvidence: true,
}

describe("assessQuality", () => {
  it("scores a complete candidate 100 with no flags", () => {
    const r = assessQuality(complete)
    expect(r.score).toBe(100)
    expect(r.flags).toEqual([])
  })

  it("is fully deterministic", () => {
    expect(assessQuality(complete)).toEqual(assessQuality(complete))
  })

  it("flags a missing email and drops its weight", () => {
    const r = assessQuality({ ...complete, email: null })
    expect(r.flags).toContain("MISSING_EMAIL")
    expect(r.weights.EMAIL_FORMAT.earned).toBe(0)
    expect(r.score).toBe(85)
  })

  it("flags malformed email and phone values", () => {
    const r = assessQuality({ ...complete, email: "not-an-email", phone: "abc" })
    expect(r.flags).toContain("INVALID_EMAIL")
    expect(r.flags).toContain("INVALID_PHONE")
  })

  it("flags a missing company and missing domain", () => {
    const r = assessQuality({ ...complete, companyName: null, companyDomain: null, websiteUrl: null })
    expect(r.flags).toContain("MISSING_COMPANY")
    expect(r.flags).toContain("MISSING_DOMAIN")
  })

  it("flags low extraction confidence and weak sources", () => {
    const r = assessQuality({ ...complete, extractionConfidence: 0.3, pageClassification: null })
    expect(r.flags).toContain("LOW_CONFIDENCE")
    expect(r.flags).toContain("WEAK_SOURCE")
    expect(assessQuality(complete).flags).not.toContain("WEAK_SOURCE")
  })

  it("maps source page classifications to a quality weight", () => {
    expect(sourceQuality("TEAM")).toBeGreaterThan(sourceQuality("DIRECTORY"))
    expect(sourceQuality(undefined)).toBeLessThan(0.5)
  })
})

describe("quality weights", () => {
  it("keeps weights within the 0-100 budget", () => {
    expect(Object.values(QUALITY_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100)
  })
})


describe("completeness + canonical selection", () => {
  it("ranks a richer candidate above a sparse one", () => {
    const rich = { id: "a", email: "j@acme.com", companyName: "Acme", companyDomain: "acme.com", pageClassification: "TEAM" }
    const sparse = { id: "b", companyName: "Acme" }
    expect(calculateCompleteness(rich)).toBeGreaterThan(calculateCompleteness(sparse))
    expect(pickCanonical([sparse, rich]).id).toBe("a")
  })

  it("breaks ties deterministically by extraction confidence", () => {
    const a = { id: "a", email: "x@acme.com", extractionConfidence: 0.8 }
    const b = { id: "b", email: "y@acme.com", extractionConfidence: 0.9 }
    expect(pickCanonical([a, b]).id).toBe("b")
    expect(pickCanonical([b, a]).id).toBe("b")
  })
})

describe("mergeFields", () => {
  it("keeps canonical values and fills empty fields from members", () => {
    const canonical = { id: "a", companyName: "Acme Inc" }
    const member = { id: "b", email: "john@acme.com", phoneRaw: "+14155550134" }
    const { merged, conflicts } = mergeFields(canonical, [canonical, member], "a")
    expect(merged.companyName).toBe("Acme Inc")
    expect(merged.email).toBe("john@acme.com")
    expect(conflicts).toEqual([])
  })

  it("records differing values as conflicts instead of overwriting", () => {
    const canonical = { id: "a", companyName: "Acme Inc" }
    const member = { id: "b", companyName: "Acme Corp" }
    const { merged, conflicts } = mergeFields(canonical, [canonical, member], "a")
    expect(merged.companyName).toBe("Acme Inc")
    expect(conflicts).toEqual([
      {
        field: "companyName",
        values: [
          { value: "Acme Inc", sourceCandidateId: "a" },
          { value: "Acme Corp", sourceCandidateId: "b" },
        ],
      },
    ])
  })
})

describe("pairIds", () => {
  it("orders pairs canonically for idempotency", () => {
    expect(pairIds("z", "a")).toEqual({ candidateAId: "a", candidateBId: "z" })
    expect(pairIds("a", "z")).toEqual({ candidateAId: "a", candidateBId: "z" })
  })
})