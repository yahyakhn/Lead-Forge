// TASK 023: CRM analytics — a read model over existing CRM data. No AI, no
// scraping, no enrichment, no scoring, no schema changes. Every query is
// organization-scoped (orgId always comes from the authenticated session,
// never from the client). Aggregation happens server-side in a handful of
// consolidated queries; charts render the summaries only.
//
// Metric definitions (all deterministic):
//   Total leads      = org Lead records matching non-date filters (all time)
//   New leads        = org Lead records created within the selected range
//   Qualified leads  = leads in range whose current status is QUALIFIED
//   ICP-fit leads    = leads in range with a CURRENT LeadScore qualified
//                      HOT or GOOD (the existing qualification enum)
//   Avg lead score   = mean overallScore of each in-range lead's newest
//                      CURRENT LeadScore (one score per lead; mirrors the
//                      "scores[0]" convention used across the CRM)
//   Pipeline         = open&closed deals grouped by PipelineStage (deals are
//                      the schema's stage-bound entity), current state
//   Sources/industry/location/size = distribution of the in-range leads,
//                      missing values bucketed as "Unknown"
//   Funnel           = cumulative current-status cohorts of the in-range
//                      leads: New → Qualified → Opportunity → Converted
//   Conversion rate  = CONVERTED / in-range total, null when denominator is 0
//   Signals          = canonical signal buckets counted over
//                      AccountResearch.relevantSignals of the in-range
//                      leads' companies (research is unique per company)

import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import { Qualification, LeadStatus } from "@/generated/prisma/enums"
import { humanize } from "@/lib/crm/icp-shared"

const DAY = 24 * 60 * 60 * 1000
const MAX_CUSTOM_SPAN_DAYS = 5 * 365
export const EMPLOYEE_BUCKETS: { label: string; min: number; max?: number }[] = [
  { label: "1–10", min: 1, max: 10 },
  { label: "11–50", min: 11, max: 50 },
  { label: "51–200", min: 51, max: 200 },
  { label: "201–500", min: 201, max: 500 },
  { label: "501–1,000", min: 501, max: 1_000 },
  { label: "1,001+", min: 1_001 },
] as const

// Midnight in the server's local timezone — the convention used by
// lib/lead-engine/dashboard.ts (UTC-safe day boundaries, §61).
function dayStart(d: Date): Date {
  const start = new Date(d)
  start.setHours(0, 0, 0, 0)
  return start
}

export type AnalyticsRangeKey = "today" | "7d" | "30d" | "90d" | "year" | "all" | "custom"

export interface AnalyticsFilters {
  range: AnalyticsRangeKey
  from: Date
  to: Date
  status?: string
  source?: string
  industry?: string
  ownerId?: string
  icpId?: string
  minScore?: number
  maxScore?: number
}

export function parseAnalyticsFilters(raw: Record<string, string | string[] | undefined>): AnalyticsFilters {
  const first = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined)
  const key = (first("range") ?? "30d") as AnalyticsRangeKey
  const now = new Date()
  const from = dayStart(now)
  const to = new Date(from.getTime() + DAY)
  let range: AnalyticsRangeKey = key
  if (key === "today") {
    // from already set
  } else if (key === "7d") {
    from.setTime(from.getTime() - 6 * DAY)
  } else if (key === "30d") {
    from.setTime(from.getTime() - 29 * DAY)
  } else if (key === "90d") {
    from.setTime(from.getTime() - 89 * DAY)
  } else if (key === "year") {
    from.setTime(from.getTime() - 364 * DAY)
  } else if (key === "all") {
    from.setTime(0)
  } else if (key === "custom") {
    range = "custom"
    const rawFrom = first("from")
    const rawTo = first("to")
    const parsedFrom = rawFrom ? new Date(`${rawFrom}T00:00:00`) : null
    const parsedTo = rawTo ? new Date(`${rawTo}T00:00:00`) : null
    // Validate: both or neither, start before end, no future end, bounded span.
    if (
      parsedFrom &&
      parsedTo &&
      !Number.isNaN(parsedFrom.getTime()) &&
      !Number.isNaN(parsedTo.getTime()) &&
      parsedFrom < parsedTo &&
      parsedTo.getTime() <= now.getTime() + DAY &&
      parsedTo.getTime() - parsedFrom.getTime() <= MAX_CUSTOM_SPAN_DAYS * DAY
    ) {
      from.setTime(dayStart(parsedFrom).getTime())
      to.setTime(dayStart(parsedTo).getTime() + DAY)
    } else {
      range = "30d"
      from.setTime(from.getTime() - 29 * DAY)
    }
  } else {
    range = "30d"
    from.setTime(from.getTime() - 29 * DAY)
  }

  const numberOr = (v: string | undefined) =>
    v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : undefined
  return {
    range,
    from,
    to,
    status: first("status") || undefined,
    source: first("source") || undefined,
    industry: first("industry") || undefined,
    ownerId: first("owner") || undefined,
    icpId: first("icp") || undefined,
    minScore: numberOr(first("minScore")),
    maxScore: numberOr(first("maxScore")),
  }
}

const ICP_FIT_QUALIFICATIONS = [Qualification.HOT, Qualification.GOOD]
const REACHED_QUALIFIED = [LeadStatus.QUALIFIED, LeadStatus.CONTACTED, LeadStatus.ENGAGED, LeadStatus.OPPORTUNITY, LeadStatus.CONVERTED]
const REACHED_OPPORTUNITY = [LeadStatus.OPPORTUNITY, LeadStatus.CONVERTED]

// One where builder for every lead metric — filters apply identically to all
// sections (filter consistency, §63).
function leadWhere(orgId: string, filters: AnalyticsFilters, dateScoped: boolean): Prisma.LeadWhereInput {
  return {
    organizationId: orgId,
    ...(dateScoped ? { createdAt: { gte: filters.from, lt: filters.to } } : {}),
    ...(filters.status ? { status: filters.status as LeadStatus } : {}),
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
    ...(filters.icpId ? { scores: { some: { scoreStatus: "CURRENT", icpProfileId: filters.icpId } } } : {}),
    ...(filters.minScore !== undefined || filters.maxScore !== undefined
      ? {
          scores: {
            some: {
              scoreStatus: "CURRENT",
              ...(filters.minScore !== undefined ? { overallScore: { gte: filters.minScore } } : {}),
              ...(filters.maxScore !== undefined ? { overallScore: { lte: filters.maxScore } } : {}),
            },
          },
        }
      : {}),
    ...(filters.industry
      ? { company: { industry: { contains: filters.industry, mode: "insensitive" } } }
      : {}),
  }
}

// Latest CURRENT LeadScore per lead in the filtered population — mirrors the
// CRM's "scores[0]" convention (LEAD_INCLUDE_WITH_SCORES in lib/crm/leads.ts).
async function currentScoresByLead(orgId: string, filters: AnalyticsFilters): Promise<Map<string, { icpScore: number; overallScore: number; qualification: Qualification }>> {
  const scores = await prisma.leadScore.findMany({
    where: { organizationId: orgId, scoreStatus: "CURRENT", leadId: { not: null }, lead: leadWhere(orgId, filters, true) },
    select: { leadId: true, icpScore: true, overallScore: true, qualification: true, scoredAt: true },
    orderBy: { scoredAt: "desc" },
  })
  const byLead = new Map<string, { icpScore: number; overallScore: number; qualification: Qualification }>()
  for (const s of scores) {
    if (s.leadId && !byLead.has(s.leadId)) byLead.set(s.leadId, { icpScore: s.icpScore, overallScore: s.overallScore, qualification: s.qualification })
  }
  return byLead
}

function bucketScore(score: number): string {
  if (score >= 81) return "81–100"
  if (score >= 61) return "61–80"
  if (score >= 41) return "41–60"
  if (score >= 21) return "21–40"
  return "0–20"
}

function employeeBucket(count: number | null): string {
  if (count === null || count === undefined) return "Unknown"
  for (const b of EMPLOYEE_BUCKETS) {
    if (count >= b.min) return b.label
  }
  return "Unknown"
}

// Canonical signal labels (the repo's ICP SIGNALS vocabulary) matched against
// stored research observations. Deterministic aggregation only.
const SIGNAL_BUCKETS: { label: string; match: RegExp }[] = [
  { label: "Hiring", match: /hiring|job|vacanc|career|recruit|position/i },
  { label: "Growth", match: /growth|growing|expand/i },
  { label: "Funding", match: /fund|invest|round|raise|ventur|v\.?c\b/i },
  { label: "New product", match: /product|launch|release|feature/i },
  { label: "Technology change", match: /technolog|tech|software|platform|migration|cloud|\bai\b/i },
  { label: "Expansion", match: /expansion|new market|international|office|location/i },
]

export interface AnalyticsData {
  filters: AnalyticsFilters
  generatedAt: Date
  kpis: {
    totalLeads: number
    newLeads: number
    qualifiedLeads: number
    icpFitLeads: number
    icpFitPct: number | null
    avgScore: number | null
    scoredLeads: number
    activities: number
  }
  trend: { label: string; count: number }[]
  pipeline: { stage: string; isClosed: boolean; isWon: boolean; deals: number; value: string }[]
  sources: { source: string; count: number }[]
  industries: { industry: string; count: number }[]
  countries: { country: string; count: number }[]
  sizes: { size: string; count: number }[]
  scoreDistribution: { bucket: string; count: number }[]
  qualification: { HOT: number; GOOD: number; MAYBE: number; LOW: number; UNQUALIFIED: number }
  classification: { label: string; count: number }[]
  unclassifiedLeads: number
  signals: { signal: string; count: number; pct: number | null }[]
  funnel: { stage: string; count: number; pctOfPrev: number | null }[]
  conversionRate: number | null
  research: { researched: number; totalCompanies: number }
}

export async function getCrmAnalytics(orgId: string, raw: Record<string, string | string[] | undefined>): Promise<AnalyticsData> {
  const filters = parseAnalyticsFilters(raw)
  const { from, to } = filters

  // ── KPI population (one shared where for every lead metric) ─────────────
  const [totalLeads, newLeads, qualifiedLeads, icpFitLeads, activities, statusCounts] = await Promise.all([
    prisma.lead.count({ where: leadWhere(orgId, filters, false) }),
    prisma.lead.count({ where: leadWhere(orgId, filters, true) }),
    prisma.lead.count({ where: { ...leadWhere(orgId, filters, true), status: LeadStatus.QUALIFIED } }),
    prisma.lead.count({ where: { ...leadWhere(orgId, filters, true), scores: { some: { scoreStatus: "CURRENT", qualification: { in: ICP_FIT_QUALIFICATIONS } } } } }),
    prisma.activity.count({ where: { organizationId: orgId, createdAt: { gte: from, lt: to } } }),
    prisma.lead.groupBy({
      by: ["status"],
      where: leadWhere(orgId, filters, true),
      _count: { _all: true },
    }),
  ])

  // ── Scores (avg + distribution, one score per lead) ────────────────────
  const scoresByLead = await currentScoresByLead(orgId, filters)
  const scores = [...scoresByLead.values()]
  const avgScore = scores.length > 0 ? Math.round((scores.reduce((a, s) => a + s.overallScore, 0) / scores.length) * 10) / 10 : null
  const scoreBuckets = ["0–20", "21–40", "41–60", "61–80", "81–100"].map((bucket) => ({
    bucket,
    count: scores.filter((s) => bucketScore(s.overallScore) === bucket).length,
  }))
  const qualification = {
    HOT: scores.filter((s) => s.qualification === Qualification.HOT).length,
    GOOD: scores.filter((s) => s.qualification === Qualification.GOOD).length,
    MAYBE: scores.filter((s) => s.qualification === Qualification.MAYBE).length,
    LOW: scores.filter((s) => s.qualification === Qualification.LOW).length,
    UNQUALIFIED: scores.filter((s) => s.qualification === Qualification.UNQUALIFIED).length,
  }

  // ── Trend (bounded single-column fetch, bucketed server-side) ──────────
  const trendLeads = await prisma.lead.findMany({
    where: leadWhere(orgId, filters, true),
    select: { createdAt: true },
  })
  const trend = bucketTrend(trendLeads.map((l) => l.createdAt), from, to)

  // ── Distributions via one grouped lead query + company lookup ──────────
  const [companyCounts, sourceCounts] = await Promise.all([
    prisma.lead.groupBy({ by: ["companyId"], where: leadWhere(orgId, filters, true), _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["source"], where: leadWhere(orgId, filters, true), _count: { _all: true } }),
  ])
  const companies = companyCounts.length > 0
    ? await prisma.company.findMany({
        where: { organizationId: orgId, id: { in: companyCounts.map((c) => c.companyId).filter((c): c is string => c !== null) } },
        select: { id: true, industry: true, country: true, employeeCount: true },
      })
    : []
  const companyById = new Map(companies.map((c) => [c.id, c]))
  const industries = new Map<string, number>()
  const countries = new Map<string, number>()
  const sizes = new Map<string, number>()
  for (const row of companyCounts) {
    const company = row.companyId ? companyById.get(row.companyId) : undefined
    const industry = company?.industry?.trim() || "Unknown"
    industries.set(industry, (industries.get(industry) ?? 0) + row._count._all)
    const country = company?.country?.trim() || "Unknown"
    countries.set(country, (countries.get(country) ?? 0) + row._count._all)
    const size = employeeBucket(company?.employeeCount ?? null)
    sizes.set(size, (sizes.get(size) ?? 0) + row._count._all)
  }

  // ── Pipeline: deals are the stage-bound entity (§18) ────────────────────
  const [stages, deals] = await Promise.all([
    prisma.pipelineStage.findMany({ where: { organizationId: orgId }, orderBy: { position: "asc" }, select: { id: true, name: true, isClosed: true, isWon: true } }),
    prisma.deal.groupBy({ by: ["stageId"], where: { organizationId: orgId }, _count: { _all: true }, _sum: { value: true } }),
  ])
  const dealByStage = new Map(deals.map((d) => [d.stageId, d]))
  const pipeline = stages.map((s) => {
    const d = dealByStage.get(s.id)
    return { stage: s.name, isClosed: s.isClosed, isWon: s.isWon, deals: d?._count._all ?? 0, value: d?._sum.value?.toString() ?? "0" }
  })

  // ── AI classification (one row per lead+ICP, replaced in place) ─────────
  const [classificationRows, unclassifiedLeads] = await Promise.all([
    prisma.leadClassification.groupBy({
      by: ["classification"],
      where: { organizationId: orgId, icpId: filters.icpId ? filters.icpId : undefined, lead: leadWhere(orgId, filters, true) },
      _count: { _all: true },
    }),
    prisma.lead.count({
      where: {
        ...leadWhere(orgId, filters, true),
        classifications: filters.icpId ? { none: { icpId: filters.icpId } } : { none: {} },
      },
    }),
  ])
  const classification = classificationRows.map((r) => ({ label: r.classification, count: r._count._all }))

  // ── Signals from stored account research (unique per company) ──────────
  const researchCompanies = new Set(companyCounts.map((c) => c.companyId).filter((c): c is string => c !== null))
  const researchRows = researchCompanies.size > 0
    ? await prisma.accountResearch.findMany({
        where: { organizationId: orgId, companyId: { in: [...researchCompanies] } },
        select: { companyId: true, relevantSignals: true },
      })
    : []
  const signals = new Map<string, number>()
  for (const row of researchRows) {
    const observed = Array.isArray(row.relevantSignals) ? (row.relevantSignals as unknown[]).filter((s): s is string => typeof s === "string") : []
    const matched = new Set<string>()
    for (const text of observed) {
      for (const bucket of SIGNAL_BUCKETS) {
        if (!matched.has(bucket.label) && bucket.match.test(text)) {
          signals.set(bucket.label, (signals.get(bucket.label) ?? 0) + 1)
          matched.add(bucket.label)
        }
      }
    }
  }
  const researchedCompanies = researchRows.length
  const signalList = [...signals.entries()]
    .map(([signal, count]) => ({ signal, count, pct: researchedCompanies > 0 ? Math.round((count / researchedCompanies) * 100) : null }))
    .sort((a, b) => b.count - a.count)

  // ── Funnel + conversion (cumulative cohorts of the in-range population) ─
  const statusMap = new Map(statusCounts.map((s) => [s.status, s._count._all]))
  const countOf = (...statuses: LeadStatus[]) => statuses.reduce((a, s) => a + (statusMap.get(s) ?? 0), 0)
  const funnel: { stage: string; count: number; pctOfPrev: number | null }[] = [
    { stage: "New", count: newLeads, pctOfPrev: null },
    { stage: "Qualified", count: countOf(...REACHED_QUALIFIED), pctOfPrev: null },
    { stage: "Opportunity", count: countOf(...REACHED_OPPORTUNITY), pctOfPrev: null },
    { stage: "Converted", count: countOf(LeadStatus.CONVERTED), pctOfPrev: null },
  ]
  for (let i = funnel.length - 1; i > 0; i -= 1) {
    funnel[i].pctOfPrev = funnel[i - 1].count > 0 ? Math.round((funnel[i].count / funnel[i - 1].count) * 100) : null
  }
  const conversionRate = newLeads > 0 ? Math.round((countOf(LeadStatus.CONVERTED) / newLeads) * 1000) / 10 : null

  const sourcesList = sourceCounts
    .map((s) => ({ source: s.source?.trim() || "Unknown", count: s._count._all }))
    .sort((a, b) => b.count - a.count)

  return {
    filters,
    generatedAt: new Date(),
    kpis: {
      totalLeads,
      newLeads,
      qualifiedLeads,
      icpFitLeads,
      icpFitPct: newLeads > 0 ? Math.round((icpFitLeads / newLeads) * 100) : null,
      avgScore,
      scoredLeads: scores.length,
      activities,
    },
    trend,
    pipeline,
    sources: sourcesList,
    industries: [...industries.entries()].map(([industry, count]) => ({ industry, count })).sort((a, b) => b.count - a.count),
    countries: [...countries.entries()].map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count),
    sizes: [...sizes.entries()].map(([size, count]) => ({ size, count })).sort((a, b) => b.count - a.count),
    scoreDistribution: scoreBuckets,
    qualification,
    classification,
    unclassifiedLeads,
    signals: signalList,
    funnel,
    conversionRate,
    research: { researched: researchedCompanies, totalCompanies: researchCompanies.size },
  }
}

interface Bucket {
  label: string
  count: number
}

// Granularity adapts to the span: daily up to ~9 weeks, weekly up to ~2
// years, monthly beyond. Buckets always start at the earlier of the range
// start or the first data point, so "all" never renders empty centuries.
function bucketTrend(dates: Date[], from: Date, to: Date): Bucket[] {
  const spanDays = Math.round((to.getTime() - from.getTime()) / DAY)
  const granularity = spanDays <= 62 ? "day" : spanDays <= 730 ? "week" : "month"
  const start = dates.length > 0 && from.getTime() === 0 ? dayStart(new Date(Math.min(...dates.map((d) => d.getTime())))) : from
  const stepMs = granularity === "day" ? DAY : granularity === "week" ? 7 * DAY : 30 * DAY
  const labelFor = (d: Date) => {
    if (granularity === "day") return `${d.getMonth() + 1}/${d.getDate()}`
    if (granularity === "week") {
      const weekStart = new Date(d)
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))
      return `${weekStart.getMonth() + 1}/${weekStart.getDate()}`
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  }
  const buckets = new Map<string, number>()
  for (let t = start.getTime(); t < to.getTime(); t += stepMs) {
    buckets.set(labelFor(new Date(t)), 0)
  }
  for (const d of dates) {
    const key = labelFor(d)
    if (buckets.has(key)) buckets.set(key, buckets.get(key)! + 1)
  }
  return [...buckets.entries()].map(([label, count]) => ({ label, count }))
}

export const SOURCE_LABELS: Record<string, string> = { MANUAL: "Manual", WEBSITE: "Website", SCRAPER: "Scraper", IMPORT: "Import", REFERRAL: "Referral" }

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? humanize(source)
}