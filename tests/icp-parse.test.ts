// TASK 017: natural-language ICP parsing tests (spec §35). MockAIProvider and
// stub providers only — no network, no real API keys. Covers basic parsing,
// industries, locations, employee/revenue ranges, technologies, company types,
// signals, exclusions, company age, multiple/missing/duplicate criteria,
// invalid AI output, schema failures, input guards, AI failure propagation,
// currency handling, and ICP persistence compatibility.

import { describe, expect, it } from "vitest"
import { prisma } from "@/lib/db"
import { AIError, type AIProvider } from "@/lib/lead-engine/ai/types"
import { MockAIProvider } from "@/lib/lead-engine/ai/providers/mock"
import { IcpParseError, criteriaToInput, parseIcpPrompt } from "@/lib/crm/icp-parse"
import { createICP } from "@/lib/crm/icp"
import type { IcpInput } from "@/lib/crm/validators"

const parsed = (structured: unknown) =>
  parseIcpPrompt("ignored by the mock", { aiProvider: new MockAIProvider({ structured }) })

class FailingProvider implements AIProvider {
  readonly configured = true
  async generateText(): Promise<never> {
    throw new AIError("AI_TIMEOUT", "The AI provider timed out", true)
  }
  async generateStructured(): Promise<never> {
    throw new AIError("AI_TIMEOUT", "The AI provider timed out", true)
  }
}

describe("parseIcpPrompt", () => {
  // ── Basic criteria parsing ────────────────────────────────────────────

  it("parses a full description into structured criteria", async () => {
    const { criteria, warnings } = await parsed({
      industries: ["SaaS"],
      countries: ["India"],
      regions: ["Karnataka"],
      cities: ["Bangalore"],
      employeeRange: { min: 50, max: 500 },
      revenueRange: { min: 10_000_000, max: 50_000_000, currency: "USD" },
      technologies: ["React", "AWS"],
      companyTypes: ["STARTUP"],
      signals: ["HIRING"],
      companyAge: { min: null, max: 5 },
      exclusions: { industries: ["Government"], countries: [], companyTypes: ["AGENCY"], keywords: ["Mumbai"] },
    })
    expect(criteria.industries).toEqual(["SaaS"])
    expect(criteria.countries).toEqual(["India"])
    expect(criteria.regions).toEqual(["Karnataka"])
    expect(criteria.cities).toEqual(["Bangalore"])
    expect(criteria.employeeRange).toEqual({ min: 50, max: 500 })
    expect(criteria.revenueRange).toEqual({ min: 10_000_000, max: 50_000_000, currency: "USD" })
    expect(criteria.technologies).toEqual(["React", "AWS"])
    expect(criteria.companyTypes).toEqual(["STARTUP"])
    expect(criteria.signals).toEqual(["HIRING"])
    expect(criteria.companyAge).toEqual({ max: 5 })
    expect(criteria.exclusions.industries).toEqual(["Government"])
    expect(criteria.exclusions.companyTypes).toEqual(["AGENCY"])
    expect(criteria.exclusions.keywords).toEqual(["Mumbai"])
    expect(warnings).toEqual([])
  })

  it("parses industries", async () => {
    const { criteria } = await parsed({ industries: ["Fintech", "B2B SaaS"] })
    expect(criteria.industries).toEqual(["Fintech", "B2B SaaS"])
  })

  it("parses country, region and city locations", async () => {
    const { criteria } = await parsed({ countries: ["India"], regions: ["Europe"], cities: ["New York"] })
    expect(criteria.countries).toEqual(["India"])
    expect(criteria.regions).toEqual(["Europe"])
    expect(criteria.cities).toEqual(["New York"])
  })

  it("parses closed employee ranges", async () => {
    const { criteria } = await parsed({ employeeRange: { min: 50, max: 500 } })
    expect(criteria.employeeRange).toEqual({ min: 50, max: 500 })
  })

  it("parses open-ended employee ranges (100+ -> min only)", async () => {
    const { criteria } = await parsed({ employeeRange: { min: 100, max: null } })
    expect(criteria.employeeRange).toEqual({ min: 100 })
  })

  it("parses revenue ranges with currency", async () => {
    const { criteria } = await parsed({ revenueRange: { min: 1_000_000, max: 50_000_000, currency: "EUR" } })
    expect(criteria.revenueRange).toEqual({ min: 1_000_000, max: 50_000_000, currency: "EUR" })
  })

  it("defaults missing revenue currency to USD", async () => {
    const { criteria, warnings } = await parsed({ revenueRange: { min: 10_000_000, max: 50_000_000 } })
    expect(criteria.revenueRange?.currency).toBe("USD")
    expect(warnings).toEqual([])
  })

  it("parses technologies", async () => {
    const { criteria } = await parsed({ technologies: ["React", "AWS", "Shopify"] })
    expect(criteria.technologies).toEqual(["React", "AWS", "Shopify"])
  })

  it("parses company types", async () => {
    const { criteria } = await parsed({ companyTypes: ["STARTUP", "AGENCY"] })
    expect(criteria.companyTypes).toEqual(["STARTUP", "AGENCY"])
  })

  it("maps signal codes to the supported vocabulary", async () => {
    const { criteria } = await parsed({ signals: ["HIRING", "FUNDING", "EXPANSION"] })
    expect(criteria.signals).toEqual(["HIRING", "FUNDING", "EXPANSION"])
  })

  it("parses exclusions", async () => {
    const { criteria } = await parsed({
      exclusions: { industries: ["Government"], countries: ["China"], companyTypes: ["AGENCY"], keywords: ["Mumbai"] },
    })
    expect(criteria.exclusions).toEqual({
      industries: ["Government"],
      countries: ["China"],
      companyTypes: ["AGENCY"],
      keywords: ["Mumbai"],
    })
  })

  it("parses company age", async () => {
    const { criteria } = await parsed({ companyAge: { min: null, max: 5 } })
    expect(criteria.companyAge).toEqual({ max: 5 })
  })

  it("handles multiple criteria at once", async () => {
    const { criteria } = await parsed({
      industries: ["B2B SaaS"],
      countries: ["India"],
      employeeRange: { min: 100 },
      technologies: ["AWS"],
      exclusions: { industries: [], countries: [], companyTypes: ["AGENCY"], keywords: ["Mumbai"] },
    })
    expect(criteria.industries).toEqual(["B2B SaaS"])
    expect(criteria.countries).toEqual(["India"])
    expect(criteria.employeeRange).toEqual({ min: 100 })
    expect(criteria.technologies).toEqual(["AWS"])
    expect(criteria.exclusions.keywords).toEqual(["Mumbai"])
  })

  // ── Missing / duplicate criteria ──────────────────────────────────────

  it("keeps missing criteria empty or null", async () => {
    const { criteria } = await parsed({ industries: ["Software"] })
    expect(criteria.countries).toEqual([])
    expect(criteria.regions).toEqual([])
    expect(criteria.cities).toEqual([])
    expect(criteria.employeeRange).toBeNull()
    expect(criteria.revenueRange).toBeNull()
    expect(criteria.technologies).toEqual([])
    expect(criteria.companyTypes).toEqual([])
    expect(criteria.signals).toEqual([])
    expect(criteria.companyAge).toBeNull()
    expect(criteria.exclusions).toEqual({ industries: [], countries: [], companyTypes: [], keywords: [] })
  })

  it("deduplicates repeated criteria and normalizes case", async () => {
    const { criteria } = await parsed({ industries: ["SaaS", "SaaS"], countries: ["India", "india"] })
    expect(criteria.industries).toEqual(["SaaS"])
    expect(criteria.countries).toEqual(["India"])
  })

  // ── Signal / company-type mapping ─────────────────────────────────────

  it("maps natural signal phrases to codes", async () => {
    const { criteria, warnings } = await parsed({
      signals: ["hiring engineers", "recently raised funding", "international expansion"],
    })
    expect(criteria.signals).toEqual(["HIRING", "FUNDING", "EXPANSION"])
    expect(warnings).toEqual([])
  })

  it("maps lowercase and underscored signal codes", async () => {
    const { criteria } = await parsed({ signals: ["hiring", "raising_funding", "expanding"] })
    expect(criteria.signals).toEqual(["HIRING", "FUNDING", "EXPANSION"])
  })

  it("drops unmappable signals and company types with warnings", async () => {
    const { criteria, warnings } = await parsed({ signals: ["HIRING", "acquihire"], companyTypes: ["STARTUP", "unicorn"] })
    expect(criteria.signals).toEqual(["HIRING"])
    expect(criteria.companyTypes).toEqual(["STARTUP"])
    expect(warnings.join(" ")).toContain("acquihire")
    expect(warnings.join(" ")).toContain("unicorn")
  })

  it("maps natural company-type phrases to codes", async () => {
    const { criteria } = await parsed({ companyTypes: ["agencies", "b2b software companies", "marketplaces"] })
    expect(criteria.companyTypes).toEqual(["AGENCY", "B2B", "MARKETPLACE"])
  })

  // ── Range validation ──────────────────────────────────────────────────

  it("rejects inverted ranges with a warning", async () => {
    const { criteria, warnings } = await parsed({ employeeRange: { min: 500, max: 50 } })
    expect(criteria.employeeRange).toBeNull()
    expect(warnings.join(" ")).toContain("Employee")
  })

  it("rejects negative values with a warning", async () => {
    const { criteria, warnings } = await parsed({ revenueRange: { min: -1000, max: 10_000 } })
    expect(criteria.revenueRange).toBeNull()
    expect(warnings.join(" ")).toContain("Revenue")
  })

  it("rejects non-integer employee counts with a warning", async () => {
    const { criteria, warnings } = await parsed({ employeeRange: { min: 50.5, max: 500 } })
    expect(criteria.employeeRange).toBeNull()
    expect(warnings.join(" ")).toContain("Employee")
  })

  it("rejects out-of-bounds values with a warning", async () => {
    const { criteria, warnings } = await parsed({
      employeeRange: { min: 100_000_000 },
      revenueRange: { min: 1e15 },
      companyAge: { max: 500 },
    })
    expect(criteria.employeeRange).toBeNull()
    expect(criteria.revenueRange).toBeNull()
    expect(criteria.companyAge).toBeNull()
    expect(warnings.length).toBeGreaterThanOrEqual(3)
  })

  it("falls back to USD when the currency is unsupported", async () => {
    const { criteria, warnings } = await parsed({ revenueRange: { min: 1000, max: 5000, currency: "XXX" } })
    expect(criteria.revenueRange?.currency).toBe("USD")
    expect(warnings.join(" ")).toContain("XXX")
  })

  // ── Input guards ──────────────────────────────────────────────────────

  it("rejects empty input without calling the provider", async () => {
    await expect(parseIcpPrompt("", { aiProvider: new FailingProvider() })).rejects.toMatchObject({
      name: "IcpParseError",
      code: "ICP_EMPTY_INPUT",
    })
  })

  it("rejects whitespace-only input", async () => {
    await expect(parseIcpPrompt("   \n\t ", { aiProvider: new FailingProvider() })).rejects.toMatchObject({
      code: "ICP_EMPTY_INPUT",
    })
  })

  it("rejects oversized input without calling the provider", async () => {
    await expect(parseIcpPrompt("x".repeat(2001), { aiProvider: new FailingProvider() })).rejects.toMatchObject({
      code: "ICP_INPUT_TOO_LONG",
    })
  })

  // ── AI failure handling ───────────────────────────────────────────────

  it("propagates schema validation failures as AIError", async () => {
    await expect(parseIcpPrompt("text", { aiProvider: new MockAIProvider({ structured: { industries: [42] } }) })).rejects.toMatchObject({
      name: "AIError",
      code: "AI_SCHEMA_VALIDATION_ERROR",
    })
  })

  it("propagates invalid provider responses as AIError", async () => {
    await expect(parseIcpPrompt("text", { aiProvider: new MockAIProvider({ structured: "not json at all" }) })).rejects.toBeInstanceOf(
      AIError,
    )
  })

  it("propagates provider failures (timeout) unchanged", async () => {
    await expect(parseIcpPrompt("text", { aiProvider: new FailingProvider() })).rejects.toMatchObject({
      name: "AIError",
      code: "AI_TIMEOUT",
      retryable: true,
    })
  })

  // ── Form integration + persistence compatibility ─────────────────────

  it("criteriaToInput produces the flat shape the form submits", async () => {
    const { criteria } = await parsed({
      industries: ["SaaS"],
      employeeRange: { min: 50, max: 500 },
      revenueRange: { min: 10_000_000, currency: "EUR" },
      exclusions: { keywords: ["Mumbai"] },
    })
    expect(criteriaToInput(criteria)).toMatchObject({
      industries: ["SaaS"],
      employeeMin: 50,
      employeeMax: 500,
      revenueMin: 10_000_000,
      revenueCurrency: "EUR",
      excludeKeywords: ["Mumbai"],
    })
  })

  it("parsed criteria save through the existing ICP persistence", async () => {
    const org = await prisma.organization.create({ data: { name: `ICP Parse Test Org ${Date.now()}` } })
    try {
      const { criteria } = await parsed({
        industries: ["SaaS"],
        countries: ["India"],
        employeeRange: { min: 50, max: 500 },
        technologies: ["React", "AWS"],
        companyTypes: ["STARTUP"],
        signals: ["HIRING"],
      })
      const saved = await createICP(org.id, undefined, {
        name: "Parsed ICP",
        ...criteriaToInput(criteria),
        scoringKeywords: [],
        scoringJobTitles: [],
        scoringSeniorities: [],
        scoringDomains: [],
      } as IcpInput)
      const row = await prisma.iCPProfile.findUnique({ where: { id: saved.id } })
      expect(row).not.toBeNull()
    } finally {
      await prisma.organization.deleteMany({ where: { id: org.id } })
    }
  })

  // ── Network safety ────────────────────────────────────────────────────

  it("makes no network requests when a mock provider is injected", async () => {
    const mock = new MockAIProvider()
    const result = await parseIcpPrompt("B2B SaaS companies", { aiProvider: mock })
    expect(result.criteria).toBeDefined()
  })

  it("rejects IcpParseError instances with their code", () => {
    const error = new IcpParseError("ICP_EMPTY_INPUT", "Describe your ideal customer profile first")
    expect(error.code).toBe("ICP_EMPTY_INPUT")
    expect(error).toBeInstanceOf(Error)
  })
})
