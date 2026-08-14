// TASK 017: natural-language ICP parsing (spec §24-§27). Turns a plain-English
// description of the ideal customer profile into structured ICPCriteria using
// the AI provider abstraction. Runs server-side only; never touches the
// network in tests (MockAIProvider).

import { z } from "zod"
import { getAIProvider } from "@/lib/lead-engine/ai/registry"
import type { AIProvider } from "@/lib/lead-engine/ai/types"
import {
  COMPANY_TYPES,
  SIGNALS,
  SUPPORTED_CURRENCIES,
  normalizeCriteria,
  type CompanyType,
  type Currency,
  type ICPCriteria,
  type RangeValue,
  type Signal,
} from "@/lib/crm/icp-shared"

export const ICP_PARSE_PROMPT_VERSION = 1
export const ICP_PARSE_MAX_CHARS = 2000

export class IcpParseError extends Error {
  readonly code: "ICP_EMPTY_INPUT" | "ICP_INPUT_TOO_LONG" | "ICP_PARSE_FAILED"

  constructor(code: "ICP_EMPTY_INPUT" | "ICP_INPUT_TOO_LONG" | "ICP_PARSE_FAILED", message: string) {
    super(message)
    this.name = "IcpParseError"
    this.code = code
  }
}

export interface ParsedIcp {
  criteria: ICPCriteria
  warnings: string[]
}

// Bounds mirrored from lib/crm/validators.ts so parsed values always satisfy
// the persistence schema without ever reaching the database.
const EMPLOYEE_LIMIT = 10_000_000
const REVENUE_LIMIT = 1e12
const AGE_LIMIT = 200

const listOf = (maxItems: number, maxLen: number) => z.array(z.string().trim().min(1).max(maxLen)).max(maxItems)

const rangeDto = z
  .object({
    min: z.number().nullish(),
    max: z.number().nullish(),
  })
  .nullable()

const revenueRangeDto = z
  .object({
    min: z.number().nullish(),
    max: z.number().nullish(),
    currency: z.string().trim().max(6).nullish(),
  })
  .nullable()

// DTO is deliberately lenient (free-form strings, no enum checks): the model
// gets synonyms and phrasing; the deterministic mapping below normalizes.
// Every field defaults so a model omitting a key never fails validation.
const icpParseSchema = z.object({
  industries: listOf(20, 60).default([]),
  countries: listOf(20, 60).default([]),
  regions: listOf(20, 60).default([]),
  cities: listOf(20, 60).default([]),
  employeeRange: rangeDto.default(null),
  revenueRange: revenueRangeDto.default(null),
  technologies: listOf(20, 80).default([]),
  companyTypes: listOf(20, 40).default([]),
  signals: listOf(20, 80).default([]),
  companyAge: rangeDto.default(null),
  exclusions: z
    .object({
      industries: listOf(20, 60).default([]),
      countries: listOf(20, 60).default([]),
      companyTypes: listOf(20, 40).default([]),
      keywords: listOf(20, 80).default([]),
    })
    .nullable()
    .default({ industries: [], countries: [], companyTypes: [], keywords: [] }),
})

type ParseDto = z.infer<typeof icpParseSchema>

const SIGNAL_ALIASES: Record<string, Signal> = {
  hiring: "HIRING",
  "hiring engineers": "HIRING",
  "hiring developers": "HIRING",
  "hiring talent": "HIRING",
  recruiting: "HIRING",
  "hiring sales": "HIRING_SALES",
  "hiring salespeople": "HIRING_SALES",
  "sales hiring": "HIRING_SALES",
  "hiring marketing": "HIRING_MARKETING",
  "hiring marketers": "HIRING_MARKETING",
  "marketing hiring": "HIRING_MARKETING",
  growth: "GROWTH",
  growing: "GROWTH",
  "high growth": "GROWTH",
  "fast growing": "GROWTH",
  funding: "FUNDING",
  "raised funding": "FUNDING",
  "raising funding": "FUNDING",
  "raised money": "FUNDING",
  "raised venture funding": "FUNDING",
  "recently raised": "FUNDING",
  "recently raised funding": "FUNDING",
  fundraising: "FUNDING",
  "recently funded": "FUNDING",
  "series a": "FUNDING",
  "venture backed": "FUNDING",
  expansion: "EXPANSION",
  expanding: "EXPANSION",
  "expanding into": "EXPANSION",
  "international expansion": "EXPANSION",
  "global expansion": "EXPANSION",
  "new product": "NEW_PRODUCT",
  launching: "NEW_PRODUCT",
  "product launch": "NEW_PRODUCT",
  "launching new products": "NEW_PRODUCT",
  "new products": "NEW_PRODUCT",
  "technology change": "TECHNOLOGY_CHANGE",
  "tech change": "TECHNOLOGY_CHANGE",
  "changing stack": "TECHNOLOGY_CHANGE",
  "stack migration": "TECHNOLOGY_CHANGE",
  "adopting new technology": "TECHNOLOGY_CHANGE",
  "migrating platforms": "TECHNOLOGY_CHANGE",
}

const COMPANY_TYPE_ALIASES: Record<string, CompanyType> = {
  startup: "STARTUP",
  startups: "STARTUP",
  agency: "AGENCY",
  agencies: "AGENCY",
  b2b: "B2B",
  "b2b saas": "B2B",
  "b2b software": "B2B",
  "b2b software companies": "B2B",
  b2c: "B2C",
  "b2c software": "B2C",
  b2b2c: "B2B2C",
  marketplace: "MARKETPLACE",
  marketplaces: "MARKETPLACE",
  enterprise: "ENTERPRISE",
  enterprises: "ENTERPRISE",
  corporate: "ENTERPRISE",
  corporates: "ENTERPRISE",
}

const isSupportedCurrency = (c: string): c is Currency =>
  (SUPPORTED_CURRENCIES as readonly string[]).includes(c)

export const ICP_PARSE_SYSTEM_PROMPT = `You are an ICP (Ideal Customer Profile) extraction assistant.

Extract structured ICP criteria from the user's natural-language description.

Rules:
- Extract ONLY criteria the user explicitly stated. NEVER invent industries, locations, sizes, technologies, signals, company types, or exclusions.
- If a criterion is not mentioned, use an empty array or null for that field.
- "software companies", "SaaS" etc. count as industries.
- Locations map to: countries ("India"), regions ("Europe", "APAC"), cities ("Bangalore", "New York").
- Exclusions go into the "exclusions" object; use exclusions.keywords for anything that does not fit an industry, country, or company type (e.g. excluded cities).
- Normalize numbers: "50-500 employees" -> {"min":50,"max":500}; "100+" -> {"min":100,"max":null}; "under 50" -> {"max":49}.
- Revenue: normalize to USD unless another currency is stated; "$10M-$50M" -> {"min":10000000,"max":50000000,"currency":"USD"}; "over $10 million" -> {"min":10000000,"currency":"USD"}.
- Company age: only when explicitly stated ("founded in the last 5 years" -> {"max":5}).
- Technologies: actual stack names ("React", "AWS", "Shopify", "Kubernetes").
- Signals: use ONLY these codes and only when the user's words clearly match:
  HIRING, HIRING_SALES, HIRING_MARKETING, GROWTH, FUNDING, EXPANSION, NEW_PRODUCT, TECHNOLOGY_CHANGE.
  Examples: "hiring engineers" -> HIRING; "raising funding" -> FUNDING; "expanding into India" -> EXPANSION.
  "using AWS" is NOT a signal, it is a technology.
- Company types: use ONLY these codes: B2B, B2C, B2B2C, MARKETPLACE, AGENCY, STARTUP, ENTERPRISE.
  "agencies" -> AGENCY; "startups" -> STARTUP.

Return STRICT JSON matching exactly:
{"industries":string[],"countries":string[],"regions":string[],"cities":string[],"employeeRange":{"min":number|null,"max":number|null}|null,"revenueRange":{"min":number|null,"max":number|null,"currency":string}|null,"technologies":string[],"companyTypes":string[],"signals":string[],"companyAge":{"min":number|null,"max":number|null}|null,"exclusions":{"industries":string[],"countries":string[],"companyTypes":string[],"keywords":string[]}}`

function mapSignals(rawSignals: string[], warnings: string[]): Signal[] {
  const mapped = new Set<Signal>()
  const result: Signal[] = []
  for (const raw of rawSignals) {
    const trimmed = raw.trim()
    const direct = SIGNALS.find((s) => s.toLowerCase() === trimmed.toLowerCase())
    const mappedSignal = direct ?? SIGNAL_ALIASES[trimmed.toLowerCase().replace(/_/g, " ")]
    if (mappedSignal && !mapped.has(mappedSignal)) {
      mapped.add(mappedSignal)
      result.push(mappedSignal)
    } else if (!mappedSignal) {
      warnings.push(`Unrecognized signal "${trimmed}" was ignored`)
    }
  }
  return result
}

function mapCompanyTypes(rawTypes: string[], warnings: string[]): CompanyType[] {
  const mapped = new Set<CompanyType>()
  const result: CompanyType[] = []
  for (const raw of rawTypes) {
    const trimmed = raw.trim()
    const direct = COMPANY_TYPES.find((t) => t.toLowerCase() === trimmed.toLowerCase())
    const mappedType = direct ?? COMPANY_TYPE_ALIASES[trimmed.toLowerCase().replace(/_/g, " ")]
    if (mappedType && !mapped.has(mappedType)) {
      mapped.add(mappedType)
      result.push(mappedType)
    } else if (!mappedType) {
      warnings.push(`Unrecognized company type "${trimmed}" was ignored`)
    }
  }
  return result
}

function boundedRange(
  range: { min?: number | null; max?: number | null } | null,
  opts: { integer?: boolean; limit?: number; label: string },
  warnings: string[],
): RangeValue | null {
  if (!range) return null
  const min = range.min ?? undefined
  const max = range.max ?? undefined
  if (min === undefined && max === undefined) return null
  const valid = (v: number) =>
    Number.isFinite(v) && v >= 0 && (!opts.integer || Number.isInteger(v)) && (opts.limit === undefined || v <= opts.limit)
  const minInvalid = min !== undefined && !valid(min)
  const maxInvalid = max !== undefined && !valid(max)
  const inverted = min !== undefined && max !== undefined && min > max
  if (minInvalid || maxInvalid || inverted) {
    warnings.push(`${opts.label} range was ignored because it was invalid`)
    return null
  }
  return {
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  }
}

function buildCriteria(dto: ParseDto): ParsedIcp {
  const warnings: string[] = []
  const currency = mapCurrency(dto.revenueRange?.currency, warnings)
  const { signals, companyTypes } = mapEnums(dto, warnings)
  const employee = boundedRange(dto.employeeRange, { integer: true, limit: EMPLOYEE_LIMIT, label: "Employee" }, warnings)
  const revenue = boundedRange(dto.revenueRange, { limit: REVENUE_LIMIT, label: "Revenue" }, warnings)
  const companyAge = boundedRange(dto.companyAge, { integer: true, limit: AGE_LIMIT, label: "Company age" }, warnings)
  return {
    criteria: normalizeCriteria({
      industries: dto.industries,
      countries: dto.countries,
      regions: dto.regions,
      cities: dto.cities,
      employeeMin: employee?.min,
      employeeMax: employee?.max,
      revenueMin: revenue?.min,
      revenueMax: revenue?.max,
      revenueCurrency: currency,
      technologies: dto.technologies,
      companyTypes,
      signals,
      companyAgeMin: companyAge?.min,
      companyAgeMax: companyAge?.max,
      excludeIndustries: dto.exclusions?.industries,
      excludeCountries: dto.exclusions?.countries,
      excludeCompanyTypes: dto.exclusions?.companyTypes,
      excludeKeywords: dto.exclusions?.keywords,
    }),
    warnings,
  }
}

function mapEnums(dto: ParseDto, warnings: string[]) {
  return {
    signals: mapSignals(dto.signals, warnings),
    companyTypes: mapCompanyTypes(dto.companyTypes, warnings),
  }
}

function mapCurrency(currency: string | null | undefined, warnings: string[]): string {
  const c = (currency ?? "").trim().toUpperCase()
  if (!c) return "USD"
  if (!isSupportedCurrency(c)) {
    warnings.push(`Unsupported currency "${c}" — using USD`)
    return "USD"
  }
  return c
}

export async function parseIcpPrompt(
  text: string,
  options: { aiProvider?: AIProvider } = {},
): Promise<ParsedIcp> {
  const input = text.trim()
  if (!input) throw new IcpParseError("ICP_EMPTY_INPUT", "Describe your ideal customer profile first")
  if (input.length > ICP_PARSE_MAX_CHARS) {
    throw new IcpParseError("ICP_INPUT_TOO_LONG", `ICP description is too long (max ${ICP_PARSE_MAX_CHARS} characters)`)
  }
  const provider = options.aiProvider ?? getAIProvider()
  const dto = await provider.generateStructured(
    {
      systemPrompt: ICP_PARSE_SYSTEM_PROMPT,
      userPrompt: input,
      temperature: 0,
      maxTokens: 1200,
      responseFormat: "json_object",
    },
    icpParseSchema,
  )
  return buildCriteria(dto)
}

// Flatten parsed criteria into the same shape the ICP form submits, so the
// "apply to form" flow uses one source of truth for field names.
export function criteriaToInput(criteria: ICPCriteria) {
  return {
    industries: criteria.industries,
    countries: criteria.countries,
    regions: criteria.regions,
    cities: criteria.cities,
    employeeMin: criteria.employeeRange?.min,
    employeeMax: criteria.employeeRange?.max,
    revenueMin: criteria.revenueRange?.min,
    revenueMax: criteria.revenueRange?.max,
    revenueCurrency: criteria.revenueRange?.currency ?? "USD",
    technologies: criteria.technologies,
    companyTypes: criteria.companyTypes,
    signals: criteria.signals,
    companyAgeMin: criteria.companyAge?.min,
    companyAgeMax: criteria.companyAge?.max,
    excludeIndustries: criteria.exclusions.industries,
    excludeCountries: criteria.exclusions.countries,
    excludeCompanyTypes: criteria.exclusions.companyTypes,
    excludeKeywords: criteria.exclusions.keywords,
  }
}
