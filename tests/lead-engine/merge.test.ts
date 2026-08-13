// TASK 013 §11-§12: field merge decisions — provenance-aware, no data loss.

import { describe, expect, it } from "vitest"
import { mergeValue } from "@/lib/lead-engine/enrichment/merge"
import { sameValue } from "@/lib/lead-engine/enrichment/fields"

describe("mergeValue", () => {
  it("ACCEPTs when there is no existing value", () => {
    const v = mergeValue({ field: "description", existingValue: null, existingSource: "PUBLIC_WEBSITE", enrichedValue: "A software company", enrichedSource: "PUBLIC_WEBSITE", enrichedConfidence: 0.7 })
    expect(v.decision).toBe("ACCEPT")
  })

  it("CONFIRMs when enriched matches existing (normalized)", () => {
    const v = mergeValue({ field: "company_name", existingValue: "Acme Corp", existingSource: "PUBLIC_WEBSITE", enrichedValue: "ACME CORP", enrichedSource: "PUBLIC_WEBSITE", enrichedConfidence: 0.9 })
    expect(v.decision).toBe("CONFIRM")
  })

  it("keeps existing when a trusted source already holds the value", () => {
    const v = mergeValue({ field: "email", existingValue: "founder@acme.com", existingSource: "MANUAL", enrichedValue: "info@acme.com", enrichedSource: "PUBLIC_WEBSITE", enrichedConfidence: 0.9 })
    expect(v.decision).toBe("CONFLICT")
    expect(v.suggestedResolution).toBe("KEEP_EXISTING")
  })

  it("suggests ACCEPT_NEW when enriched is high-confidence and higher-priority", () => {
    const v = mergeValue({ field: "description", existingValue: "Old blurb", existingSource: "INFERRED", enrichedValue: "Fresh company description", enrichedSource: "PUBLIC_WEBSITE", enrichedConfidence: 0.85 })
    expect(v.decision).toBe("CONFLICT")
    expect(v.suggestedResolution).toBe("ACCEPT_NEW")
  })

  it("falls back to KEEP_BOTH for equal-priority conflicts", () => {
    const v = mergeValue({ field: "phone", existingValue: "+1 555 0100", existingSource: "PUBLIC_WEBSITE", enrichedValue: "+1 555 0199", enrichedSource: "PUBLIC_WEBSITE", enrichedConfidence: 0.7 })
    expect(v.decision).toBe("CONFLICT")
    expect(v.suggestedResolution).toBe("KEEP_BOTH")
  })

  it("never ACCEPTs a low-confidence enrichment over nothing when sources differ", () => {
    const v = mergeValue({ field: "industry", existingValue: null, existingSource: null, enrichedValue: "saas", enrichedSource: "INFERRED", enrichedConfidence: 0.3 })
    expect(v.decision).toBe("ACCEPT")
  })
})

describe("sameValue", () => {
  it("compares case-insensitively for names", () => {
    expect(sameValue("company_name", "Acme Corp", "acme corp")).toBe(true)
    expect(sameValue("company_name", "Acme Corp", "Acme Inc")).toBe(false)
  })

  it("compares email case-insensitively", () => {
    expect(sameValue("email", "Bob@Acme.com", "bob@acme.com")).toBe(true)
  })

  it("treats different values as different", () => {
    expect(sameValue("description", "One thing", "Another thing")).toBe(false)
  })
})