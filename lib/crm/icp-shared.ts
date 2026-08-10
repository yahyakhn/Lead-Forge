export interface RangeValue {
  min?: number
  max?: number
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