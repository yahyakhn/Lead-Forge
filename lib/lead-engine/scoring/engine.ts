// TASK 012: deterministic, explainable lead scoring engine (§8-§35).
// Pure functions only — no DB, no AI, no components. Every score must be
// reproducible from the same inputs.

import { isGenericEmailDomain } from "@/lib/lead-engine/resolution/normalize"

export const SCORING_VERSION = "v1"

export const DEFAULT_WEIGHTS = {
  industry: 20,
  companySize: 20,
  location: 10,
  title: 20,
  keyword: 10,
  domain: 10,
  quality: 10,
} as const
export type WeightKey = keyof typeof DEFAULT_WEIGHTS
export type WeightConfig = Record<WeightKey, number>

export const DEFAULT_THRESHOLDS = { hot: 80, good: 60, maybe: 40 } as const

// §35: unknown criteria earn this share of their weight instead of 0 —
// data-poor leads are not ranked below known-mismatches.
export const DEFAULT_UNKNOWN_CREDIT = 40

export type CriterionStatus = "MATCH" | "PARTIAL" | "MISMATCH" | "UNKNOWN"

export interface CriterionResult {
  criterion: string
  status: CriterionStatus
  score: number
  maxScore: number
  reason: string
}

export interface ScoreInput {
  industry?: string | null
  companyName?: string | null
  description?: string | null
  employeeCount?: number | null
  country?: string | null
  city?: string | null
  jobTitle?: string | null
  email?: string | null
  companyDomain?: string | null
  dataQualityScore?: number | null
  industries?: readonly string[]
  countries?: readonly string[]
  cities?: readonly string[]
  keywords?: readonly string[]
  jobTitles?: readonly string[]
  seniorities?: readonly Seniority[]
  domains?: readonly string[]
  sizeRange?: SizeRange | null
  weights?: Partial<WeightConfig>
  thresholds?: Partial<Record<keyof typeof DEFAULT_THRESHOLDS, number>>
  unknownCredit?: number
}

export interface ScoreBundle {
  icpScore: number
  overallScore: number
  breakdown: CriterionResult[]
  qualification: "HOT" | "GOOD" | "MAYBE" | "LOW" | "UNQUALIFIED"
  reasons: string[]
}

export function normalizeWeights(weights: Partial<WeightConfig> = {}): WeightConfig {
  const merged: WeightConfig = { ...DEFAULT_WEIGHTS, ...weights }
  const sum = Object.values(merged).reduce((acc, w) => acc + Math.max(0, w), 0)
  if (sum <= 0) return { ...DEFAULT_WEIGHTS }
  // §9: validate sum = 100 or normalize automatically.
  const factor = 100 / sum
  return Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, Math.round(Math.max(0, v) * factor)])) as WeightConfig
}

export type ThresholdConfig = Record<keyof typeof DEFAULT_THRESHOLDS, number>

export function thresholdPoint(value: number, thresholds: ThresholdConfig = DEFAULT_THRESHOLDS): "HOT" | "GOOD" | "MAYBE" | "LOW" {
  if (value >= thresholds.hot) return "HOT"
  if (value >= thresholds.good) return "GOOD"
  if (value >= thresholds.maybe) return "MAYBE"
  return "LOW"
}

export function qualificationOf(value: number, thresholds: ThresholdConfig = DEFAULT_THRESHOLDS): ScoreBundle["qualification"] {
  return value >= 0 ? thresholdPoint(value, thresholds) : "UNQUALIFIED"
}

// §24: light industry normalization. Aliases stay small and org-agnostic —
// profiles configure the rest.
const INDUSTRY_ALIASES: Record<string, string> = {
  saas: "saas",
  "software as a service": "saas",
  "software development": "software",
  "software": "software",
  "information technology": "it",
  "it services": "it",
  "it services and it consulting": "it",
  "computer software": "software",
}

export function normalizeIndustry(value: string | null | undefined): string {
  const raw = (value ?? "").trim().toLowerCase().replace(/\s+/g, " ")
  if (!raw) return ""
  return INDUSTRY_ALIASES[raw] ?? raw
}

export function industryMatch(industry: string | null | undefined, targets: readonly string[]): CriterionStatus {
  const normalized = normalizeIndustry(industry)
  if (!normalized) return "UNKNOWN"
  const targetSet = new Set(targets.map(normalizeIndustry).filter(Boolean))
  if (targetSet.size === 0) return "PARTIAL"
  return targetSet.has(normalized) ? "MATCH" : "MISMATCH"
}

// §25: location normalization. Generic aliases map to canonical forms
// (country-level); anything else falls back to case/whitespace folding.
const LOCATION_ALIASES: Record<string, string> = {
  in: "india",
  india: "india",
  "republic of india": "india",
  "bharat": "india",
  sg: "singapore",
  singapore: "singapore",
  uae: "united arab emirates",
  "united arab emirates": "united arab emirates",
  us: "united states",
  usa: "united states",
  "united states": "united states",
  "united states of america": "united states",
  uk: "united kingdom",
  gb: "united kingdom",
  "united kingdom": "united kingdom",
  de: "germany",
  germany: "germany",
  au: "australia",
  australia: "australia",
  ca: "canada",
  canada: "canada",
}

export function normalizeLocation(value: string | null | undefined): string {
  const raw = (value ?? "").trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ")
  if (!raw) return ""
  return LOCATION_ALIASES[raw] ?? raw
}

export function locationMatch(country: string | null | undefined, city: string | null | undefined, countries: readonly string[], cities: readonly string[]): CriterionStatus {
  const countryN = normalizeLocation(country)
  const cityN = normalizeLocation(city)
  if (!countryN && !cityN) return "UNKNOWN"
  const countryTargets = new Set(countries.map(normalizeLocation).filter(Boolean))
  const cityTargets = new Set(cities.map(normalizeLocation).filter(Boolean))
  if (countryN && countryTargets.has(countryN)) return "MATCH"
  if (cityN && cityTargets.has(cityN)) return "MATCH"
  if (cityN && countryN) return "MISMATCH"
  // Partial: only one axis known and not matched — do not call it a hard mismatch.
  return "PARTIAL"
}

// §26-§27: title normalization + seniority groups.
export type Seniority = "FOUNDER" | "C_LEVEL" | "VP" | "DIRECTOR" | "HEAD" | "MANAGER" | "IC" | "UNKNOWN"

export const ALL_SENIORITIES: Seniority[] = ["FOUNDER", "C_LEVEL", "VP", "DIRECTOR", "HEAD", "MANAGER", "IC", "UNKNOWN"]

const C_LEVEL_PATTERNS = ["ceo", "chief executive", "cfo", "chief financial", "cto", "chief technology", "coo", "chief operating", "cmo", "chief marketing", "cio", "chief information", "cpo", "chief product", "cso", "chief sales", "chief revenue", "cro", "chief growth", "cbo", "chief business", "ciso", "chief security", "chro", "chief human"]

export function normalizeTitle(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9+# ]/g, " ").replace(/\s+/g, " ").trim()
}

export function seniorityOf(value: string | null | undefined): Seniority {
  const title = normalizeTitle(value)
  if (!title) return "UNKNOWN"
  const has = (parts: string[]) => parts.every((p) => title.includes(p))
  const atWord = (p: string) => new RegExp(`(^|[^a-z])${p}([^a-z]|$)`).test(title)
  if (/(^|[^a-z])co-?founder/.test(title) || /(^|[^a-z])founder/.test(title) || title === "entrepreneur") return "FOUNDER"
  if (C_LEVEL_PATTERNS.some((p) => atWord(p)) || atWord("c[0-9]o")) return "C_LEVEL"
  if (title.startsWith("vp ") || title.startsWith("vice president") || has(["vp", "president", "sales"]) || has(["vp", "president", "marketing"])) return "VP"
  if (title.startsWith("director") || title.includes("director of") || title.includes("director,")) return "DIRECTOR"
  if (title.startsWith("head of") || title.includes(" head of ")) return "HEAD"
  if (title.includes("manager") || title.includes("lead") || title.includes("team lead")) return "MANAGER"
  return "IC"
}

/**
 * §26 matching modes:
 * - exact: normalized titles equal
 * - normalized: profile target embeds in the contact title (or vice versa)
 * - keyword/seniority: contact seniority group is in the profile's target groups
 */
export function titleMatch(jobTitle: string | null | undefined, targetTitles: readonly string[], targetSeniorities: readonly Seniority[]): CriterionStatus {
  const title = normalizeTitle(jobTitle)
  if (!title) return "UNKNOWN"
  const targets = new Set(targetTitles.map(normalizeTitle).filter(Boolean))
  if (targets.has(title)) return "MATCH"
  for (const target of targets) {
    if (title.includes(target) || target.includes(title)) return "MATCH"
  }
  if (targetSeniorities.length > 0 && targetSeniorities.includes(seniorityOf(jobTitle))) return "MATCH"
  if (targets.size === 0 && targetSeniorities.length === 0) return "UNKNOWN"
  return "MISMATCH"
}

// §29: keyword tiers — more coverage means more points, but keep it simple.
export function keywordMatchCount(texts: readonly (string | null | undefined)[], keywords: readonly string[]): number {
  const haystack = texts.map((t) => (t ?? "").toLowerCase()).join(" \n ")
  return keywords.filter((k) => {
    const kw = k.trim().toLowerCase()
    if (!kw) return false
    return haystack.includes(kw)
  }).length
}

export function keywordCredit(matches: number, total: number): number {
  if (total === 0) return 0
  if (matches === 0) return 0
  const ratio = matches / total
  if (ratio >= 1) return 1
  if (ratio >= 0.6) return 0.7
  return 0.4
}

// §23: generic email hosts are not company domains.
export function normalizeDomain(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/^www\./, "").replace(/^https?:\/\//, "").split(/[/?#]/)[0] ?? ""
}

export function domainFit(companyDomain: string | null | undefined, email: string | null | undefined, patterns: readonly string[]): CriterionStatus {
  const domain = normalizeDomain(companyDomain)
  if (!domain && !email) return "UNKNOWN"
  const emailHost = email ? email.split("@")[1]?.toLowerCase() ?? "" : ""
  const evaluated = domain || emailHost
  if (!evaluated) return "UNKNOWN"
  if (isGenericEmailDomain(evaluated)) return "UNKNOWN"
  const cleaned = patterns.map(normalizeDomain).filter(Boolean)
  if (cleaned.length === 0) return "PARTIAL"
  const domainMatch = (candidate: string) => cleaned.some((p) => candidate === p || candidate.endsWith(`.${p}`))
  if (domainMatch(evaluated)) return "MATCH"
  return "MISMATCH"
}

// §31: company size ranges. Unknown sizes are never assumed to match.
export interface SizeRange { min?: number; max?: number }

export function sizeMatch(employeeCount: number | null | undefined, range: SizeRange | null | undefined): CriterionStatus {
  if (employeeCount === null || employeeCount === undefined) return "UNKNOWN"
  if (!range || (range.min === undefined && range.max === undefined)) return "PARTIAL"
  if (range.min !== undefined && employeeCount < range.min) return "MISMATCH"
  if (range.max !== undefined && employeeCount > range.max) return "MISMATCH"
  return "MATCH"
}

/**
 * §15: overall = 90% ICP fit + 10% data confidence.
 * icpScore already contains the quality weight (§8); the extra confidence
 * contribution keeps the formula transparent and bounded 0-100.
 */
export function overallScore(icpScore: number, dataQuality: number | null | undefined): number {
  const dq = dataQuality === null || dataQuality === undefined ? 0 : Math.max(0, Math.min(100, dataQuality))
  return Math.round(icpScore * 0.9 + dq * 0.1)
}

export function creditFor(status: CriterionStatus, weight: number, unknownCredit = DEFAULT_UNKNOWN_CREDIT): number {
  if (status === "MATCH") return weight
  if (status === "PARTIAL") return Math.round((weight * 75) / 100)
  if (status === "UNKNOWN") return Math.round((weight * Math.max(0, Math.min(100, unknownCredit))) / 100)
  return 0
}

export interface EngineResult {
  icpScore: number
  overallScore: number
  breakdown: CriterionResult[]
  qualification: ScoreBundle["qualification"]
  reasons: string[]
  weights: WeightConfig
}

export function evaluate(input: ScoreInput): EngineResult {
  const weights = normalizeWeights(input.weights)
  const thresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds }
  const unknownCredit = input.unknownCredit ?? DEFAULT_UNKNOWN_CREDIT

  const reasons: string[] = []
  const breakdown: CriterionResult[] = []

  const build = (criterion: string, customReason: string) => (status: CriterionStatus, score: number, maxScore: number, reason: string) => {
    breakdown.push({ criterion, status, score, maxScore, reason })
    if (status === "MATCH") reasons.push(`✓ ${customReason}`)
    else if (status === "MISMATCH") reasons.push(`⚠ ${customReason}`)
    else if (status === "UNKNOWN") reasons.push(`? ${customReason}`)
    return score
  }

  let total = 0

  // Industry (§24)
  const industryStatus = industryMatch(input.industry, input.industries ?? [])
  const industryReason = industryStatus === "MATCH"
    ? `Industry matches configured target industry (${input.industry}).`
    : industryStatus === "MISMATCH"
      ? `Industry "${input.industry}" is not in the configured target industries.`
      : "Industry is unknown."
  total += build("industry", `Industry matches target (${input.industry})`)(industryStatus, creditFor(industryStatus, weights.industry, unknownCredit), weights.industry, industryReason)

  // Company size (§31)
  const sizeStatus = sizeMatch(input.employeeCount, input.sizeRange ?? null)
  const sizeReason = sizeStatus === "MATCH"
    ? `Company size (${input.employeeCount} employees) is within the configured range.`
    : sizeStatus === "MISMATCH"
      ? `Company size (${input.employeeCount} employees) is outside the configured range.`
      : sizeStatus === "PARTIAL"
        ? "No configured company-size range to compare against."
        : "No verified company-size data."
  total += build("companySize", "Company size is within target range")(sizeStatus, creditFor(sizeStatus, weights.companySize, unknownCredit), weights.companySize, sizeReason)

  // Location (§25)
  const locationStatus = locationMatch(input.country, input.city, input.countries ?? [], input.cities ?? [])
  const locationReason = locationStatus === "MATCH"
    ? `Location ${[input.country, input.city].filter(Boolean).join(", ")} matches a configured target location.`
    : locationStatus === "MISMATCH"
      ? `Location ${[input.country, input.city].filter(Boolean).join(", ")} is not in the configured target locations.`
      : locationStatus === "PARTIAL"
        ? "Location data is partially known; could not confirm a match."
        : "No location data."
  total += build("location", "Location matches ICP")(locationStatus, creditFor(locationStatus, weights.location, unknownCredit), weights.location, locationReason)

  // Job title (§26-§27)
  const titleStatus = titleMatch(input.jobTitle, input.jobTitles ?? [], input.seniorities ?? [])
  const titleReason = titleStatus === "MATCH"
    ? `Title "${input.jobTitle}" matches a configured target title or seniority group.`
    : titleStatus === "MISMATCH"
      ? `Title "${input.jobTitle}" does not match configured targets.`
      : "No job title data."
  total += build("title", "Contact title is a target role")(titleStatus, creditFor(titleStatus, weights.title, unknownCredit), weights.title, titleReason)

  // Keywords (§28-§29)
  const keywordSources = [input.companyName, input.description, input.industry, input.jobTitle, input.companyDomain]
  const keywordHits = keywordMatchCount(keywordSources, input.keywords ?? [])
  const keywordTotal = (input.keywords ?? []).filter((k) => k.trim()).length
  const keywordRatio = keywordCredit(keywordHits, keywordTotal)
  const keywordStatus: CriterionStatus = keywordRatio === 1 ? "MATCH" : keywordRatio >= 0.4 ? "PARTIAL" : keywordTotal === 0 ? "UNKNOWN" : "MISMATCH"
  const keywordReason = keywordTotal === 0
    ? "No target keywords configured."
    : keywordHits === 0
      ? "No configured keywords found in company name, description, industry or title."
      : `${keywordHits} of ${keywordTotal} target keywords found.`
  total += build("keywords", `Keywords match (${keywordHits} found)`)(keywordStatus, Math.round(weights.keyword * keywordRatio), weights.keyword, keywordReason)

  // Domain (§23, §30)
  const domainStatus = domainFit(input.companyDomain, input.email, input.domains ?? [])
  const domainReason = domainStatus === "MATCH"
    ? `Domain "${input.companyDomain}" matches a configured target domain pattern.`
    : domainStatus === "MISMATCH"
      ? `Domain "${input.companyDomain ?? input.email}" does not match configured target domains.`
      : domainStatus === "PARTIAL"
        ? "No target domains configured."
        : "No domain or a generic email domain (unknown company fit)."
  total += build("domain", "Domain/business fit matches")(domainStatus, creditFor(domainStatus, weights.domain, unknownCredit), weights.domain, domainReason)

  // Data quality confidence (§8, §15): quality is 10% of the ICP score and
  // reflects confidence, not completeness copied from TASK 009.
  const dq = input.dataQualityScore ?? 0
  const qualityEarned = Math.round((weights.quality * Math.max(0, Math.min(100, dq))) / 100)
  const qualityStatus: CriterionStatus = dq >= 70 ? "MATCH" : dq > 0 ? "PARTIAL" : "UNKNOWN"
  const qualityReason = dq > 0
    ? `Data confidence is ${dq}/100 (quality of the evaluated attributes).`
    : "No data-quality assessment available."
  breakdown.push({ criterion: "quality", status: qualityStatus, score: qualityEarned, maxScore: weights.quality, reason: qualityReason })
  total += qualityEarned

  const icpScore = Math.max(0, Math.min(100, total))
  const overall = overallScore(icpScore, input.dataQualityScore)
  const qualification = qualificationOf(overall, thresholds)

  if (icpScore >= thresholds.hot) reasons.push(`✓ Score classifies as HOT (${overall}/100).`)
  else if (icpScore >= thresholds.good) reasons.push(`✓ Score classifies as GOOD (${overall}/100).`)
  else if (icpScore >= thresholds.maybe) reasons.push(`? Score classifies as MAYBE (${overall}/100).`)
  else reasons.push(`? Score is LOW (${overall}/100) — deprioritized.`)

  return { icpScore, overallScore: overall, breakdown, qualification, reasons, weights }
}