import { describe, expect, it } from "vitest"
import {
  evaluate,
  industryMatch,
  locationMatch,
  titleMatch,
  keywordMatchCount,
  keywordCredit,
  domainFit,
  sizeMatch,
  overallScore,
  normalizeWeights,
  normalizeIndustry,
  normalizeLocation,
  seniorityOf,
  creditFor,
  DEFAULT_WEIGHTS,
  type ScoreInput,
} from "@/lib/lead-engine/scoring/engine"

describe("Scoring Engine", () => {
  describe("normalizeWeights", () => {
    it("returns defaults when empty", () => {
      expect(normalizeWeights({})).toEqual(DEFAULT_WEIGHTS)
    })
    it("normalizes to sum 100", () => {
      const w = normalizeWeights({ industry: 40, companySize: 20, location: 10, title: 10, keyword: 10, domain: 5, quality: 5 })
      const sum = Object.values(w).reduce((a, b) => a + b, 0)
      expect(sum).toBe(100)
    })
    it("ignores negative weights", () => {
      const w = normalizeWeights({ industry: -10, companySize: 20 })
      expect(w.industry).toBe(0)
    })
  })

  describe("normalizeIndustry", () => {
    it("normalizes saas aliases", () => {
      expect(normalizeIndustry("SaaS")).toBe("saas")
      expect(normalizeIndustry("Software as a Service")).toBe("saas")
    })
    it("normalizes software aliases", () => {
      expect(normalizeIndustry("Software Development")).toBe("software")
      expect(normalizeIndustry("Computer Software")).toBe("software")
    })
    it("returns lowercase for unknown", () => {
      expect(normalizeIndustry("Biotech")).toBe("biotech")
    })
    it("returns empty for null", () => {
      expect(normalizeIndustry(null)).toBe("")
    })
  })

  describe("industryMatch", () => {
    it("returns MATCH when industry in targets", () => {
      expect(industryMatch("SaaS", ["SaaS", "Software"])).toBe("MATCH")
    })
    it("returns MISMATCH when industry not in targets", () => {
      expect(industryMatch("Manufacturing", ["SaaS", "Software"])).toBe("MISMATCH")
    })
    it("returns UNKNOWN when no industry", () => {
      expect(industryMatch(null, ["SaaS"])).toBe("UNKNOWN")
      expect(industryMatch("", ["SaaS"])).toBe("UNKNOWN")
    })
    it("returns PARTIAL when no targets configured", () => {
      expect(industryMatch("SaaS", [])).toBe("PARTIAL")
      expect(industryMatch("SaaS", [""])).toBe("PARTIAL")
    })
  })

  describe("normalizeLocation", () => {
    it("normalizes country aliases", () => {
      expect(normalizeLocation("IN")).toBe("india")
      expect(normalizeLocation("US")).toBe("united states")
      expect(normalizeLocation("UK")).toBe("united kingdom")
    })
    it("returns lowercase for unknown", () => {
      expect(normalizeLocation("Mars")).toBe("mars")
    })
  })

  describe("locationMatch", () => {
    it("returns MATCH when country matches", () => {
      expect(locationMatch("India", null, ["India"], [])).toBe("MATCH")
    })
    it("returns MATCH when city matches", () => {
      expect(locationMatch(null, "Mumbai", [], ["Mumbai"])).toBe("MATCH")
    })
    it("returns MISMATCH when both known but no match", () => {
      expect(locationMatch("USA", "New York", ["India"], ["Mumbai"])).toBe("MISMATCH")
    })
    it("returns PARTIAL when only one axis known", () => {
      expect(locationMatch("USA", null, ["India"], [])).toBe("PARTIAL")
      expect(locationMatch(null, "Mumbai", [], ["Delhi"])).toBe("PARTIAL")
    })
    it("returns UNKNOWN when no location data", () => {
      expect(locationMatch(null, null, ["India"], [])).toBe("UNKNOWN")
    })
  })

  describe("seniorityOf", () => {
    it("detects FOUNDER", () => {
      expect(seniorityOf("Co-Founder")).toBe("FOUNDER")
      expect(seniorityOf("Founder")).toBe("FOUNDER")
      expect(seniorityOf("Entrepreneur")).toBe("FOUNDER")
    })
    it("detects C_LEVEL", () => {
      expect(seniorityOf("CEO")).toBe("C_LEVEL")
      expect(seniorityOf("Chief Technology Officer")).toBe("C_LEVEL")
      expect(seniorityOf("CTO")).toBe("C_LEVEL")
      expect(seniorityOf("CFO")).toBe("C_LEVEL")
    })
    it("detects VP", () => {
      expect(seniorityOf("VP Sales")).toBe("VP")
      expect(seniorityOf("Vice President Marketing")).toBe("VP")
    })
    it("detects DIRECTOR", () => {
      expect(seniorityOf("Director of Engineering")).toBe("DIRECTOR")
    })
    it("detects HEAD", () => {
      expect(seniorityOf("Head of Sales")).toBe("HEAD")
    })
    it("detects MANAGER", () => {
      expect(seniorityOf("Sales Manager")).toBe("MANAGER")
      expect(seniorityOf("Team Lead")).toBe("MANAGER")
    })
    it("returns IC for individual contributors", () => {
      expect(seniorityOf("Software Engineer")).toBe("IC")
      expect(seniorityOf("Sales Rep")).toBe("IC")
    })
    it("returns UNKNOWN for empty", () => {
      expect(seniorityOf("")).toBe("UNKNOWN")
      expect(seniorityOf(null)).toBe("UNKNOWN")
    })
  })

  describe("titleMatch", () => {
    it("returns MATCH on exact normalized title", () => {
      expect(titleMatch("CEO", ["CEO"], [])).toBe("MATCH")
    })
    it("returns MATCH on partial title containment", () => {
      expect(titleMatch("VP Sales", ["Sales"], [])).toBe("MATCH")
      expect(titleMatch("Software Engineer", ["Engineer"], [])).toBe("MATCH")
    })
    it("returns MATCH on seniority group", () => {
      expect(titleMatch("Chief Technology Officer", [], ["C_LEVEL"])).toBe("MATCH")
      expect(titleMatch("VP Engineering", [], ["VP"])).toBe("MATCH")
    })
    it("returns UNKNOWN when no title and no targets", () => {
      expect(titleMatch(null, [], [])).toBe("UNKNOWN")
    })
    it("returns MISMATCH when title known but no match", () => {
      expect(titleMatch("Software Engineer", ["CEO"], [])).toBe("MISMATCH")
    })
  })

  describe("keywordMatchCount", () => {
    it("counts keyword occurrences", () => {
      const texts = ["Acme Software", "We build CRM and SaaS tools", "SaaS"]
      expect(keywordMatchCount(texts, ["CRM", "SaaS", "automation"])).toBe(2)
    })
    it("returns 0 for no matches", () => {
      expect(keywordMatchCount(["Acme Corp"], ["CRM", "SaaS"])).toBe(0)
    })
    it("handles null/undefined texts", () => {
      expect(keywordMatchCount([null, undefined, "test"], ["test"])).toBe(1)
    })
  })

  describe("keywordCredit", () => {
    it("returns 1 for all keywords matched", () => {
      expect(keywordCredit(3, 3)).toBe(1)
    })
    it("returns 0.7 for >= 60% matched", () => {
      expect(keywordCredit(2, 3)).toBe(0.7)
    })
    it("returns 0.4 for some matched", () => {
      expect(keywordCredit(1, 3)).toBe(0.4)
    })
    it("returns 0 for no matches", () => {
      expect(keywordCredit(0, 3)).toBe(0)
    })
    it("returns 0 for no keywords configured", () => {
      expect(keywordCredit(0, 0)).toBe(0)
    })
  })

  describe("domainFit", () => {
    it("returns MATCH for exact domain", () => {
      expect(domainFit("software.com", null, ["software.com"])).toBe("MATCH")
    })
    it("returns MATCH for subdomain", () => {
      expect(domainFit("www.software.com", null, ["software.com"])).toBe("MATCH")
      expect(domainFit("api.software.com", null, ["software.com"])).toBe("MATCH")
    })
    it("returns MISMATCH for unrelated domain", () => {
      expect(domainFit("evil.com", null, ["software.com"])).toBe("MISMATCH")
    })
    it("returns UNKNOWN for generic email", () => {
      expect(domainFit(null, "user@gmail.com", ["software.com"])).toBe("UNKNOWN")
      expect(domainFit(null, "user@yahoo.com", ["software.com"])).toBe("UNKNOWN")
    })
    it("returns PARTIAL when no patterns configured", () => {
      expect(domainFit("software.com", null, [])).toBe("PARTIAL")
    })
    it("returns UNKNOWN when no domain or email", () => {
      expect(domainFit(null, null, ["software.com"])).toBe("UNKNOWN")
    })
  })

  describe("sizeMatch", () => {
    it("returns MATCH when within range", () => {
      expect(sizeMatch(100, { min: 50, max: 500 })).toBe("MATCH")
    })
    it("returns MISMATCH when below min", () => {
      expect(sizeMatch(10, { min: 50, max: 500 })).toBe("MISMATCH")
    })
    it("returns MISMATCH when above max", () => {
      expect(sizeMatch(1000, { min: 50, max: 500 })).toBe("MISMATCH")
    })
    it("returns UNKNOWN when no employee count", () => {
      expect(sizeMatch(null, { min: 50, max: 500 })).toBe("UNKNOWN")
      expect(sizeMatch(undefined, { min: 50, max: 500 })).toBe("UNKNOWN")
    })
    it("returns PARTIAL when no range configured", () => {
      expect(sizeMatch(100, null)).toBe("PARTIAL")
      expect(sizeMatch(100, {})).toBe("PARTIAL")
    })
  })

  describe("overallScore", () => {
    it("calculates 90% ICP + 10% quality", () => {
      expect(overallScore(90, 80)).toBe(Math.round(90 * 0.9 + 80 * 0.1))
    })
    it("handles missing quality as 0", () => {
      expect(overallScore(90, null)).toBe(Math.round(90 * 0.9))
    })
    it("clamps to 0-100", () => {
      expect(overallScore(100, 100)).toBe(100)
      expect(overallScore(0, 0)).toBe(0)
    })
  })

  describe("creditFor", () => {
    it("returns full weight for MATCH", () => {
      expect(creditFor("MATCH", 20)).toBe(20)
    })
    it("returns 75% for PARTIAL", () => {
      expect(creditFor("PARTIAL", 20)).toBe(15)
    })
    it("returns unknownCredit% for UNKNOWN", () => {
      expect(creditFor("UNKNOWN", 20, 40)).toBe(8)
    })
    it("returns 0 for MISMATCH", () => {
      expect(creditFor("MISMATCH", 20)).toBe(0)
    })
  })

  describe("evaluate - full scoring", () => {
    const baseInput: ScoreInput = {
      industry: "SaaS",
      companyName: "Acme Software",
      description: "We build CRM and SaaS automation tools for sales teams",
      employeeCount: 100,
      country: "India",
      city: "Bangalore",
      jobTitle: "CEO",
      email: "ceo@acme.com",
      companyDomain: "acme.com",
      dataQualityScore: 85,
      industries: ["SaaS", "Software"],
      countries: ["India"],
      cities: ["Bangalore"],
      keywords: ["CRM", "SaaS", "automation"],
      jobTitles: ["CEO", "CTO"],
      seniorities: ["FOUNDER", "C_LEVEL"],
      domains: ["acme.com"],
    }

    it("scores perfect match as HOT", () => {
      const result = evaluate(baseInput)
      expect(result.icpScore).toBeGreaterThanOrEqual(80)
      expect(result.qualification).toBe("HOT")
    })

    it("includes all criteria in breakdown", () => {
      const result = evaluate(baseInput)
      const criteria = result.breakdown.map((b) => b.criterion)
      expect(criteria).toContain("industry")
      expect(criteria).toContain("companySize")
      expect(criteria).toContain("location")
      expect(criteria).toContain("title")
      expect(criteria).toContain("keywords")
      expect(criteria).toContain("domain")
      expect(criteria).toContain("quality")
    })

    it("produces reasons for each criterion", () => {
      const result = evaluate(baseInput)
      expect(result.reasons.length).toBeGreaterThan(0)
    })

    it("weights are normalized to 100", () => {
      const result = evaluate(baseInput)
      const weightSum = Object.values(result.weights).reduce((a, b) => a + b, 0)
      expect(weightSum).toBe(100)
    })
  })

  describe("evaluate - unknown data handling", () => {
    it("does not penalize unknown criteria aggressively", () => {
      const input: ScoreInput = {
        industry: null,
        companyName: "Acme",
        employeeCount: null,
        country: "India",
        city: "Bangalore",
        jobTitle: "CEO",
        email: "ceo@acme.com",
        companyDomain: "acme.com",
        dataQualityScore: 50,
        industries: ["SaaS"],
        countries: ["India"],
        cities: ["Bangalore"],
        keywords: ["CRM"],
        jobTitles: ["CEO"],
        seniorities: ["C_LEVEL"],
        domains: ["acme.com"],
      }
      const result = evaluate(input)
      expect(result.icpScore).toBeGreaterThan(0)
      const unknownCriteria = result.breakdown.filter((b) => b.status === "UNKNOWN")
      expect(unknownCriteria.length).toBeGreaterThan(0)
    })
  })

  describe("evaluate - qualification thresholds", () => {
    const baseInput: ScoreInput = {
      industry: "SaaS",
      companyName: "Acme",
      description: "We build CRM and SaaS automation tools",
      employeeCount: 100,
      country: "India",
      city: "Bangalore",
      jobTitle: "CEO",
      email: "ceo@acme.com",
      companyDomain: "acme.com",
      dataQualityScore: 80,
      industries: ["SaaS"],
      countries: ["India"],
      cities: ["Bangalore"],
      keywords: ["CRM", "SaaS"],
      jobTitles: ["CEO"],
      seniorities: ["C_LEVEL"],
      domains: ["acme.com"],
    }

    it("returns HOT for score >= 80", () => {
      const result = evaluate({ ...baseInput, thresholds: { hot: 80, good: 60, maybe: 40 } })
      expect(result.qualification).toBe("HOT")
    })

    it("returns GOOD for score 60-79", () => {
      const result = evaluate({ ...baseInput, thresholds: { hot: 100, good: 60, maybe: 40 } })
      expect(result.qualification).toBe("GOOD")
    })

    it("returns MAYBE for score 40-59", () => {
      const result = evaluate({
        ...baseInput,
        industry: "Manufacturing",
        email: "intern@gmail.com",
        companyDomain: null,
        dataQualityScore: 50,
        jobTitle: "Intern",
        thresholds: { hot: 100, good: 80, maybe: 40 },
      })
      expect(result.qualification).toBe("MAYBE")
    })

    it("returns LOW for score < 40", () => {
      const result = evaluate({
        ...baseInput,
        industry: "Manufacturing",
        employeeCount: 10,
        email: "intern@gmail.com",
        companyDomain: null,
        dataQualityScore: 50,
        jobTitle: "Intern",
        country: null,
        city: null,
        thresholds: { hot: 100, good: 80, maybe: 50 },
      })
      expect(result.qualification).toBe("LOW")
    })
  })
})