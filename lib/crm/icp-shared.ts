export interface RangeValue {
  min?: number
  max?: number
}

// TASK 012: lead-scoring configuration stored alongside the scraping criteria.
export interface ICPScoringConfig {
  keywords: string[]
  jobTitles: string[]
  seniorities: string[]
  domains: string[]
  weights: {
    industry: number
    companySize: number
    location: number
    title: number
    keyword: number
    domain: number
    quality: number
  }
  thresholds: { hot: number; good: number; maybe: number }
  unknownCredit: number
}

export interface ICPCriteria {
  industries: string[]
  countries: string[]
  regions: string[]
  cities: string[]
  employeeRange: RangeValue | null
  revenueRange: (RangeValue & { currency?: string }) | null
  technologies: string[]
  companyTypes: string[]
  signals: string[]
  companyAge: RangeValue | null
  exclusions: {
    industries: string[]
    countries: string[]
    companyTypes: string[]
    keywords: string[]
  }
  scoring: ICPScoringConfig | null
}

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "INR"] as const
export type Currency = (typeof SUPPORTED_CURRENCIES)[number]

export const COMPANY_TYPES = [
  "B2B",
  "B2C",
  "B2B2C",
  "MARKETPLACE",
  "AGENCY",
  "STARTUP",
  "ENTERPRISE",
] as const
export type CompanyType = (typeof COMPANY_TYPES)[number]

export const SIGNALS = [
  "HIRING",
  "HIRING_SALES",
  "HIRING_MARKETING",
  "GROWTH",
  "FUNDING",
  "EXPANSION",
  "NEW_PRODUCT",
  "TECHNOLOGY_CHANGE",
] as const
export type Signal = (typeof SIGNALS)[number]

export const EMPLOYEE_PRESETS: { label: string; min: number; max?: number }[] = [
  { label: "1–10", min: 1, max: 10 },
  { label: "11–50", min: 11, max: 50 },
  { label: "51–200", min: 51, max: 200 },
  { label: "201–500", min: 201, max: 500 },
  { label: "501–1000", min: 501, max: 1000 },
  { label: "1000+", min: 1001 },
]

export function cleanList(values: (string | undefined)[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values ?? []) {
    const trimmed = (value ?? "").trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

function rangeOrNull(min: number | undefined, max: number | undefined): RangeValue | null {
  if (min === undefined && max === undefined) return null
  return {
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  }
}

export function normalizeCriteria(input: {
  industries?: string[]
  countries?: string[]
  regions?: string[]
  cities?: string[]
  employeeMin?: number
  employeeMax?: number
  revenueMin?: number
  revenueMax?: number
  revenueCurrency?: string
  technologies?: string[]
  companyTypes?: string[]
  signals?: string[]
  companyAgeMin?: number
  companyAgeMax?: number
  excludeIndustries?: string[]
  excludeCountries?: string[]
  excludeCompanyTypes?: string[]
  excludeKeywords?: string[]
  scoringKeywords?: string[]
  scoringJobTitles?: string[]
  scoringSeniorities?: string[]
  scoringDomains?: string[]
  scoringWeightIndustry?: number
  scoringWeightCompanySize?: number
  scoringWeightLocation?: number
  scoringWeightTitle?: number
  scoringWeightKeyword?: number
  scoringWeightDomain?: number
  scoringWeightQuality?: number
  scoringThresholdHot?: number
  scoringThresholdGood?: number
  scoringThresholdMaybe?: number
  scoringUnknownCredit?: number
}): ICPCriteria {
  return {
    industries: cleanList(input.industries ?? []),
    countries: cleanList(input.countries ?? []),
    regions: cleanList(input.regions ?? []),
    cities: cleanList(input.cities ?? []),
    employeeRange: rangeOrNull(input.employeeMin, input.employeeMax),
    revenueRange: (() => {
      const range = rangeOrNull(input.revenueMin, input.revenueMax)
      return range === null ? null : { ...range, currency: input.revenueCurrency || "USD" }
    })(),
    technologies: cleanList(input.technologies ?? []),
    companyTypes: cleanList(input.companyTypes ?? []),
    signals: cleanList(input.signals ?? []),
    companyAge: rangeOrNull(input.companyAgeMin, input.companyAgeMax),
    exclusions: {
      industries: cleanList(input.excludeIndustries ?? []),
      countries: cleanList(input.excludeCountries ?? []),
      companyTypes: cleanList(input.excludeCompanyTypes ?? []),
      keywords: cleanList(input.excludeKeywords ?? []),
    },
    scoring: normalizeScoringConfig(input),
  }
}

export function normalizeScoringConfig(input: {
  scoringKeywords?: string[]
  scoringJobTitles?: string[]
  scoringSeniorities?: string[]
  scoringDomains?: string[]
  scoringWeightIndustry?: number
  scoringWeightCompanySize?: number
  scoringWeightLocation?: number
  scoringWeightTitle?: number
  scoringWeightKeyword?: number
  scoringWeightDomain?: number
  scoringWeightQuality?: number
  scoringThresholdHot?: number
  scoringThresholdGood?: number
  scoringThresholdMaybe?: number
  scoringUnknownCredit?: number
}): ICPScoringConfig {
  return {
    keywords: cleanList(input.scoringKeywords ?? []),
    jobTitles: cleanList(input.scoringJobTitles ?? []),
    seniorities: cleanList(input.scoringSeniorities ?? []),
    domains: cleanList(input.scoringDomains ?? []),
    weights: {
      industry: input.scoringWeightIndustry ?? 20,
      companySize: input.scoringWeightCompanySize ?? 20,
      location: input.scoringWeightLocation ?? 10,
      title: input.scoringWeightTitle ?? 20,
      keyword: input.scoringWeightKeyword ?? 10,
      domain: input.scoringWeightDomain ?? 10,
      quality: input.scoringWeightQuality ?? 10,
    },
    thresholds: {
      hot: input.scoringThresholdHot ?? 80,
      good: input.scoringThresholdGood ?? 60,
      maybe: input.scoringThresholdMaybe ?? 40,
    },
    unknownCredit: input.scoringUnknownCredit ?? 40,
  }
}

export function humanize(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ")
}

export function rangeLabel(range: RangeValue | null | undefined): string {
  if (!range) return "—"
  const min = range.min !== undefined ? String(range.min) : "0"
  const max = range.max !== undefined ? String(range.max) : "+"
  return `${min}–${max}`
}