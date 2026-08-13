// TASK 011: Lead Engine dashboard aggregation. All queries org-scoped and
// period-bounded; heavy math stays server-side (§55-§56).

import { prisma } from "@/lib/db"
import { listRuns, runDisplayName } from "@/lib/lead-engine/runs"
import { ScraperRunStatus, CandidateStatus, ConversionStatus, Qualification } from "@/generated/prisma/enums"

export const QUALITY_HIGH = 70
export const QUALITY_MEDIUM = 40

export type DashboardRangeKey = "today" | "7d" | "30d"

export interface DashboardRange {
  key: DashboardRangeKey
  from: Date
  to: Date
  prevFrom: Date
  prevTo: Date
  label: string
}

const DAY = 24 * 60 * 60 * 1000

function dayStart(d: Date): Date {
  const start = new Date(d)
  start.setHours(0, 0, 0, 0)
  return start
}

// §4: Today | Last 7 days | Last 30 days | Custom. Default: last 7 days.
export function parseDashboardRange(raw: Record<string, string | string[] | undefined>): DashboardRange {
  const first = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined)
  const key = (first("range") ?? "7d") as DashboardRangeKey
  const now = new Date()
  if (key === "today") {
    const from = dayStart(now)
    return { key, from, to: new Date(from.getTime() + DAY), prevFrom: new Date(from.getTime() - DAY), prevTo: from, label: "Today" }
  }
  if (key === "30d") {
    const from = dayStart(new Date(now.getTime() - 29 * DAY))
    const to = dayStart(new Date(now.getTime() + DAY))
    return { key, from, to, prevFrom: new Date(from.getTime() - 30 * DAY), prevTo: from, label: "Last 30 days" }
  }
  const from = dayStart(new Date(now.getTime() - 6 * DAY))
  const to = dayStart(new Date(now.getTime() + DAY))
  return { key, from, to, prevFrom: new Date(from.getTime() - 7 * DAY), prevTo: from, label: "Last 7 days" }
}

// guard: no fake percentages when the denominator is undefined (§7).
export function pct(part: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null
  return Math.round((part / total) * 100)
}

export interface DashboardData {
  range: DashboardRange
  generatedAt: Date
  cards: {
    leadsFound: number
    foundDeltaPct: number | null
    highQuality: number
    qualityPct: number | null
    duplicates: number
    converted: number
    conversionPct: number | null
    needsReview: number
    activeRuns: number
    pages: number
  }
  funnel: Array<{ stage: string; count: number; pctOfPrev: number | null }>
  sources: Array<{
    id: string
    name: string
    createdAt: Date
    found: number
    unique: number
    highQuality: number
    converted: number
    qualityPct: number | null
    conversionPct: number | null
  }>
  recentRuns: Array<{
    id: string
    name: string
    sourceName: string
    status: ScraperRunStatus
    startedAt: Date | null
    finishedAt: Date | null
    pages: number
    candidates: number
    unique: number
    converted: number
  }>
  workQueue: {
    duplicatesPending: number
    highQualityUnconverted: number
    needsReviewCandidates: number
    failedRuns: number
  }
  activity: Array<{ time: Date; kind: "run" | "conversion" | "failed"; text: string }>
  scoreDistribution: {
    hot: number
    good: number
    maybe: number
    low: number
    unqualified: number
    avgIcpScore: number | null
    avgOverallScore: number | null
  }
}

export async function getLeadEngineDashboard(orgId: string, raw: Record<string, string | string[] | undefined>): Promise<DashboardData> {
  const range = parseDashboardRange(raw)
  const period = { gte: range.from, lt: range.to }
  const prevPeriod = { gte: range.prevFrom, lt: range.prevTo }

  const [
    leadsFound,
    prevFound,
    highQuality,
    duplicates,
    needsReview,
    converted,
    pagesCrawled,
    activeRuns,
    sourcesUsedIds,
  ] = await Promise.all([
    prisma.leadCandidate.count({ where: { organizationId: orgId, createdAt: period } }),
    prisma.leadCandidate.count({ where: { organizationId: orgId, createdAt: prevPeriod } }),
    prisma.leadCandidate.count({ where: { organizationId: orgId, createdAt: period, dataQualityScore: { gte: QUALITY_HIGH } } }),
    prisma.leadCandidate.count({ where: { organizationId: orgId, createdAt: period, status: CandidateStatus.DUPLICATE } }),
    prisma.leadCandidate.count({ where: { organizationId: orgId, status: CandidateStatus.REVIEW } }),
    prisma.leadCandidateConversion.count({ where: { organizationId: orgId, status: ConversionStatus.CONVERTED, convertedAt: period } }),
    prisma.rawPage.count({ where: { organizationId: orgId, createdAt: period } }),
    prisma.scraperRun.count({ where: { organizationId: orgId, status: { in: [ScraperRunStatus.QUEUED, ScraperRunStatus.RUNNING] } } }),
    prisma.leadCandidate.groupBy({ by: ["sourceId"], where: { organizationId: orgId, createdAt: period }, _count: { _all: true } }),
  ])

  const highQualityPct = pct(highQuality, leadsFound)
  const conversionPct = pct(converted, leadsFound)
  const foundDeltaPct = prevFound > 0 ? pct(Math.max(0, leadsFound - prevFound), prevFound) : null
  const uniqueCandidates = leadsFound - duplicates

  const funnel = [
    { stage: "Sources", count: sourcesUsedIds.length },
    { stage: "Pages crawled", count: pagesCrawled },
    { stage: "Candidates extracted", count: leadsFound },
    { stage: "Unique candidates", count: uniqueCandidates },
    { stage: "High quality", count: highQuality },
    { stage: "CRM converted", count: converted },
  ].map((s, i, all) => ({
    ...s,
    pctOfPrev: i === 0 ? null : pct(s.count, all[i - 1].count),
  }))

  // Source performance (§8-§9): found/unique/high/converted per source + rates.
  const [perSource, perSourceDup, perSourceHigh, sourceRows, convertedCandidates] = await Promise.all([
    prisma.leadCandidate.groupBy({ by: ["sourceId"], where: { organizationId: orgId, createdAt: period }, _count: { _all: true } }),
    prisma.leadCandidate.groupBy({
      by: ["sourceId"],
      where: { organizationId: orgId, createdAt: period, status: CandidateStatus.DUPLICATE },
      _count: { _all: true },
    }),
    prisma.leadCandidate.groupBy({
      by: ["sourceId"],
      where: { organizationId: orgId, createdAt: period, dataQualityScore: { gte: QUALITY_HIGH } },
      _count: { _all: true },
    }),
    prisma.leadSource.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
    prisma.leadCandidateConversion.groupBy({
      by: ["candidateId"],
      where: { organizationId: orgId, status: ConversionStatus.CONVERTED, convertedAt: period },
      _count: { _all: true },
    }),
  ])

  const nots = (rows: Array<{ sourceId: string; _count: { _all: number } }>) => new Map(rows.map((r) => [r.sourceId, r._count._all]))
  const bySource = nots(perSource)
  const bySourceDup = nots(perSourceDup)
  const bySourceHigh = nots(perSourceHigh)
  const convCandidateIds = convertedCandidates.map((c) => c.candidateId)
  let sourceOfCandidate = new Map<string, string>()
  if (convCandidateIds.length > 0) {
    const mapped = await prisma.leadCandidate.groupBy({ by: ["id", "sourceId"], where: { id: { in: convCandidateIds }, organizationId: orgId } })
    sourceOfCandidate = new Map(mapped.map((m) => [m.id, m.sourceId]))
  }
  const convBySource = new Map<string, number>()
  for (const row of convertedCandidates) {
    const sourceId = sourceOfCandidate.get(row.candidateId)
    if (sourceId) convBySource.set(sourceId, (convBySource.get(sourceId) ?? 0) + row._count._all)
  }

  const sources = sourceRows
    .map((s) => {
      const found = bySource.get(s.id) ?? 0
      const high = bySourceHigh.get(s.id) ?? 0
      const conv = convBySource.get(s.id) ?? 0
      return {
        id: s.id,
        name: s.name,
        createdAt: s.createdAt,
        found,
        unique: found - (bySourceDup.get(s.id) ?? 0),
        highQuality: high,
        converted: conv,
        qualityPct: pct(high, found),
        conversionPct: pct(conv, found),
      }
    })
    .filter((s) => s.found > 0 || s.converted > 0)
    .sort((a, b) => b.found - a.found)

  // Could stream prev-period source deltas; skipped — deltas only on the top
  // metric cards for now.

  const [recentRuns, workQueue, activityRows, conversions, scoreDist] = await Promise.all([
    listRuns(orgId, { page: 1, pageSize: 8 }),
    Promise.all([
      prisma.duplicateGroup.count({ where: { organizationId: orgId, status: "PENDING_REVIEW" } }),
      prisma.leadCandidate.count({
        where: { organizationId: orgId, dataQualityScore: { gte: QUALITY_HIGH }, status: { in: [CandidateStatus.EXTRACTED, CandidateStatus.READY] } },
      }),
      prisma.leadCandidate.count({ where: { organizationId: orgId, status: CandidateStatus.REVIEW } }),
      prisma.scraperRun.count({ where: { organizationId: orgId, status: ScraperRunStatus.FAILED } }),
    ]),
    prisma.scraperRun.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, status: true, createdAt: true, finishedAt: true, metadata: true, source: { select: { name: true } } },
    }),
    prisma.leadCandidateConversion.findMany({
      where: { organizationId: orgId, status: ConversionStatus.CONVERTED },
      orderBy: { convertedAt: "desc" },
      take: 6,
      select: { convertedAt: true, lead: { select: { title: true, id: true } } },
    }),
    prisma.leadScore.groupBy({
      by: ["qualification"],
      where: { organizationId: orgId, scoreStatus: "CURRENT" },
      _count: { _all: true },
      _avg: { icpScore: true, overallScore: true },
    }),
  ])

  const runCounts = await summarizeRunCandidates(
    orgId,
    recentRuns.data.map((r) => r.id),
  )
  const recentRunsMapped = recentRuns.data.map((run) => {
    const counts = runCounts.get(run.id)
    return {
      id: run.id,
      name: runDisplayName(run, `${run.source.name} `),
      sourceName: run.source.name,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      pages: run.pagesProcessed,
      candidates: counts?.candidates ?? 0,
      unique: counts?.unique ?? 0,
      converted: counts?.converted ?? 0,
    }
  })

const activity: DashboardData["activity"] = [
    ...activityRows.map((r) => ({
      time: r.finishedAt ?? r.createdAt,
      kind: (r.status === ScraperRunStatus.FAILED ? "failed" : "run") as "run" | "conversion" | "failed",
      text: r.status === ScraperRunStatus.FAILED ? `Run #${r.id.slice(-6)} failed (${r.source.name})` : `Run ${runDisplayName(r, `${r.source.name} `)} completed`,
    })),
    ...conversions.map((c) => ({
      time: c.convertedAt ?? new Date(0),
      kind: "conversion" as const,
      text: `Converted: ${c.lead?.title ?? "lead"} \u2192 CRM`,
    })),
  ]
    .sort((a, b) => b.time.getTime() - a.time.getTime())
    .slice(0, 8)

  const scoreDistMap = new Map(scoreDist.map((s) => [s.qualification, s._count._all]))
  const avgIcp = scoreDist[0]?._avg.icpScore ?? null
  const avgOverall = scoreDist[0]?._avg.overallScore ?? null

  return {
    range,
    generatedAt: new Date(),
    cards: {
      leadsFound,
      foundDeltaPct,
      highQuality,
      qualityPct: highQualityPct,
      duplicates,
      converted,
      conversionPct,
      needsReview,
      activeRuns,
      pages: pagesCrawled,
    },
    funnel,
    sources,
    recentRuns: recentRunsMapped,
    workQueue: {
      duplicatesPending: workQueue[0],
      highQualityUnconverted: workQueue[1],
      needsReviewCandidates: workQueue[2],
      failedRuns: workQueue[3],
    },
    activity,
    scoreDistribution: {
      hot: scoreDistMap.get(Qualification.HOT) ?? 0,
      good: scoreDistMap.get(Qualification.GOOD) ?? 0,
      maybe: scoreDistMap.get(Qualification.MAYBE) ?? 0,
      low: scoreDistMap.get(Qualification.LOW) ?? 0,
      unqualified: scoreDistMap.get(Qualification.UNQUALIFIED) ?? 0,
      avgIcpScore: avgIcp ? Math.round(avgIcp) : null,
      avgOverallScore: avgOverall ? Math.round(avgOverall) : null,
    },
  }
}

// Candidate counts per run (candidates/unique/high quality/converted) for a}

// Candidate counts per run (candidates/unique/high quality/converted) for a
// bounded set of run ids — used by the runs list and dashboard recent runs.
export async function summarizeRunCandidates(orgId: string, runIds: string[]): Promise<Map<string, { candidates: number; unique: number; converted: number }>> {
  if (runIds.length === 0) return new Map()
  const [all, dups, convRows] = await Promise.all([
    prisma.leadCandidate.groupBy({ by: ["runId"], where: { organizationId: orgId, runId: { in: runIds } }, _count: { _all: true } }),
    prisma.leadCandidate.groupBy({
      by: ["runId"],
      where: { organizationId: orgId, runId: { in: runIds }, status: CandidateStatus.DUPLICATE },
      _count: { _all: true },
    }),
    prisma.leadCandidateConversion.groupBy({
      by: ["candidateId"],
      where: { organizationId: orgId, status: ConversionStatus.CONVERTED, candidate: { runId: { in: runIds } } },
      _count: { _all: true },
    }),
  ])
  const count = (rows: Array<{ runId: string; _count: { _all: number } }>) => new Map(rows.map((r) => [r.runId, r._count._all]))
  const allMap = count(all)
  const dupMap = count(dups)
  const convIds = convRows.map((r) => r.candidateId)
  let runOfId = new Map<string, string>()
  if (convIds.length > 0) {
    const mapped = await prisma.leadCandidate.groupBy({ by: ["id", "runId"], where: { id: { in: convIds }, organizationId: orgId } })
    runOfId = new Map(mapped.map((m) => [m.id, m.runId]))
  }
  const convMap = new Map<string, number>()
  for (const row of convRows) {
    const runId = runOfId.get(row.candidateId)
    if (runId) convMap.set(runId, (convMap.get(runId) ?? 0) + row._count._all)
  }
  const result = new Map<string, { candidates: number; unique: number; converted: number }>()
  for (const runId of runIds) {
    const candidates = allMap.get(runId) ?? 0
    result.set(runId, { candidates, unique: candidates - (dupMap.get(runId) ?? 0), converted: convMap.get(runId) ?? 0 })
  }
  return result
}