import Link from "next/link"
import { requireSession } from "@/lib/auth"
import { getLeadEngineDashboard, QUALITY_HIGH } from "@/lib/lead-engine/dashboard"
import type { DashboardData } from "@/lib/lead-engine/dashboard"
import { RunStatusBadge } from "@/components/crm/scrapers/scraper-badges"
import { PageHeader } from "@/components/crm/page-header"
import { ErrorState } from "@/components/crm/states"
import { relativeDay } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  ActivityIcon,
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CrosshairIcon,
  FingerprintIcon,
  FlagIcon,
  GaugeIcon,
  PlayCircleIcon,
  RadioIcon,
  SearchXIcon,
  TimerIcon,
  TriangleAlertIcon,
  UsersIcon,
  TrendingUpIcon,
  TargetIcon,
  TrophyIcon,
  AlertTriangleIcon,
  SparklesIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

type SearchParams = Record<string, string | string[] | undefined>

function MetricCard({ label, value, delta, icon: Icon, href, hint }: { label: string; value: number | string; delta?: number | null; icon: LucideIcon; href: string; hint?: string }) {
  return (
    <Link href={href} className="group">
      <div className="flex h-full flex-col justify-between rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className="size-4 text-muted-foreground/60" />
        </div>
        <div className="mt-2">
          <p className="text-2xl font-semibold tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</p>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            {delta !== undefined && delta !== null ? (
              <span className={cn("flex items-center gap-0.5 tabular-nums", delta > 0 ? "text-emerald-600" : delta < 0 ? "text-destructive" : "")}>
                {delta > 0 ? <ArrowUpRightIcon className="size-3" /> : <ArrowDownRightIcon className="size-3" />}
                {delta}%
              </span>
            ) : null}
            {hint ?? "vs previous period"}
          </div>
        </div>
      </div>
    </Link>
  )
}

function FunnelCard({ funnel }: { funnel: DashboardData["funnel"] }) {
  const max = Math.max(1, ...funnel.map((s) => s.count))
  const colors = ["bg-slate-400", "bg-sky-400", "bg-blue-500", "bg-indigo-500", "bg-violet-500", "bg-fuchsia-500"]
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <GaugeIcon className="size-4 text-muted-foreground" /> Funnel
        </h2>
        <Link href="/lead-engine/candidates" className="text-xs text-muted-foreground hover:underline">
          Candidates →
        </Link>
      </div>
      <div className="space-y-3">
        {funnel.map((s, i) => (
          <div key={s.stage}>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">{s.stage}</span>
              <span className="tabular-nums">
                <span className="font-semibold text-foreground">{s.count.toLocaleString()}</span>
                {s.pctOfPrev !== null && <span className="text-muted-foreground"> / {s.pctOfPrev}% of prev</span>}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full", colors[i])} style={{ width: `${(s.count / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function WorkQueue({ queue }: { queue: DashboardData["workQueue"] }) {
  const items = [
    { label: "Duplicate groups to review", value: queue.duplicatesPending, href: "/lead-engine/duplicates" },
    { label: "High-quality candidates not converted", value: queue.highQualityUnconverted, href: "/lead-engine/candidates" },
    { label: "Candidates in review", value: queue.needsReviewCandidates, href: "/lead-engine/candidates?status=REVIEW" },
    { label: "Failed runs", value: queue.failedRuns, href: "/scrapers/runs" },
  ]
  return (
    <div className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <TimerIcon className="size-4 text-muted-foreground" /> Work queue
      </h2>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.label}>
            <Link href={item.href} className="flex items-center gap-3 rounded-lg px-1 py-1 text-sm hover:bg-muted/50">
              <span className="flex-1 text-muted-foreground">{item.label}</span>
              <span className="font-semibold tabular-nums">{item.value.toLocaleString()}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SourceCard({ s }: { s: DashboardData["sources"][number] }) {
  const bar = (n: number, max: number) => `${Math.max(2, (n / Math.max(1, max)) * 100)}%`
  const max = Math.max(1, s.found, s.highQuality, s.converted)
  return (
    <Link href="/scrapers/sources" className="block rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50">
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-semibold">{s.name}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">{relativeDay(s.createdAt)}</span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <div>
          <p className="text-sm font-semibold tabular-nums">{s.found.toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">found</p>
        </div>
        <div>
          <p className="text-sm font-semibold tabular-nums">{s.unique.toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">unique</p>
        </div>
        <div>
          <p className="text-sm font-semibold tabular-nums">{s.highQuality.toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">high</p>
        </div>
        <div>
          <p className="text-sm font-semibold tabular-nums">{s.conversionPct !== null ? `${s.conversionPct}%` : "—"}</p>
          <p className="text-[10px] text-muted-foreground">conv</p>
        </div>
      </div>
      <div className="mt-3 flex h-1 gap-0.5 overflow-hidden rounded-full">
        <div className="bg-blue-500" style={{ width: bar(s.found, max) }} />
        <div className="bg-violet-500" style={{ width: bar(s.highQuality, max) }} />
        <div className="bg-fuchsia-500" style={{ width: bar(s.converted, max) }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>found</span>
        <span>quality ≥{QUALITY_HIGH}</span>
        <span>converted</span>
      </div>
    </Link>
  )
}

function ScoreDistributionCard({ dist }: { dist: DashboardData["scoreDistribution"] }) {
  const items = [
    { label: "HOT", value: dist.hot, icon: TrophyIcon, color: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/40" },
    { label: "GOOD", value: dist.good, icon: TrendingUpIcon, color: "text-green-600 bg-green-100 dark:bg-green-900/40" },
    { label: "MAYBE", value: dist.maybe, icon: TargetIcon, color: "text-amber-600 bg-amber-100 dark:bg-amber-900/40" },
    { label: "LOW", value: dist.low, icon: AlertTriangleIcon, color: "text-red-600 bg-red-100 dark:bg-red-900/40" },
  ]
  const total = dist.hot + dist.good + dist.maybe + dist.low + dist.unqualified

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <TargetIcon className="size-4 text-muted-foreground" /> Lead Scores
        </h2>
        <Link href="/leads" className="text-xs text-muted-foreground hover:underline">
          View all \u2192
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <Link key={item.label} href={`/leads?qualification=${item.label}`} className="group flex items-center gap-3 rounded-lg p-3 transition-colors hover:bg-muted/50">
            <item.icon className={`size-5 shrink-0 ${item.color}`} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="font-semibold tabular-nums">{item.value.toLocaleString()}</p>
            </div>
            {total > 0 && (
              <div className="w-24 text-right text-xs text-muted-foreground">
                {Math.round((item.value / total) * 100)}%
              </div>
            )}
          </Link>
        ))}
        <div className="col-span-2 sm:col-span-2 rounded-lg border bg-muted/50 p-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Avg ICP Score</p>
              <p className="font-semibold tabular-nums">{dist.avgIcpScore ?? "\u2014"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Avg Overall Score</p>
              <p className="font-semibold tabular-nums">{dist.avgOverallScore ?? "\u2014"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">Total scored leads: {total.toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function RunCard({ run }: { run: DashboardData["recentRuns"][number] }) {
  return (
    <Link
      href={`/scrapers/runs/${run.id}`}
      className="flex items-center gap-4 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50"
    >
      <RunStatusBadge status={run.status} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{run.name}</p>
        <p className="text-xs text-muted-foreground">
          {run.sourceName}
          {run.pages > 0 ? ` · ${run.pages} pages` : ""}
          {run.finishedAt ? ` · ${relativeDay(run.finishedAt)}` : run.startedAt ? ` · started ${relativeDay(run.startedAt)}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 gap-5 text-right text-xs">
        <div>
          <p className="text-sm font-semibold tabular-nums">{run.candidates.toLocaleString()}</p>
          <p className="text-muted-foreground">candidates</p>
        </div>
        <div>
          <p className="text-sm font-semibold tabular-nums">{run.unique.toLocaleString()}</p>
          <p className="text-muted-foreground">unique</p>
        </div>
        <div>
          <p className="text-sm font-semibold tabular-nums">{run.converted.toLocaleString()}</p>
          <p className="text-muted-foreground">converted</p>
        </div>
      </div>
    </Link>
  )
}

const kindIcon = { run: PlayCircleIcon, conversion: UsersIcon, failed: TriangleAlertIcon } as const

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireSession()

  let data: DashboardData
  let enrichment
  try {
    ;[data, enrichment] = await Promise.all([
      getLeadEngineDashboard(session.organization.id, await searchParams),
      import("@/lib/lead-engine/enrichment/service").then((m) => m.enrichmentStats(session.organization.id)),
    ])
  } catch {
    return <ErrorState message="We couldn't load your dashboard." />
  }

  const metrics: Array<{ label: string; value: number | string; delta?: number | null; icon: LucideIcon; href: string; hint?: string }> = [
    { label: "Leads found", value: data.cards.leadsFound, delta: data.cards.foundDeltaPct, icon: CrosshairIcon, href: "/lead-engine/candidates", hint: "vs previous period" },
    { label: "High quality", value: data.cards.highQuality, delta: data.cards.qualityPct, icon: FlagIcon, href: "/lead-engine/candidates", hint: "% of leads found" },
    { label: "Duplicates", value: data.cards.duplicates, icon: SearchXIcon, href: "/lead-engine/duplicates" },
    { label: "Conversion rate", value: data.cards.conversionPct !== null ? `${data.cards.conversionPct}%` : "—", icon: FingerprintIcon, href: "/lead-engine/candidates" },
    { label: "Converted to CRM", value: data.cards.converted, icon: UsersIcon, href: "/leads", hint: "in this period" },
    { label: "Needs review", value: data.cards.needsReview, icon: RadioIcon, href: "/lead-engine/candidates?status=REVIEW", hint: "now" },
    { label: "Active runs", value: data.cards.activeRuns, icon: ActivityIcon, href: "/scrapers/runs", hint: "queued or running" },
    { label: "Pages crawled", value: data.cards.pages, icon: GaugeIcon, href: "/scrapers/runs" },
  ]

  const ranges = [
    { key: "today", label: "Today" },
    { key: "7d", label: "7 days" },
    { key: "30d", label: "30 days" },
  ]

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`${session.organization.name} · ${data.range.label} · generated ${data.generatedAt.toLocaleTimeString()}`}
        actions={
          <nav className="flex items-center gap-1 rounded-lg border p-0.5 text-xs">
            {ranges.map((r) => (
              <Link
                key={r.key}
                href={`?range=${r.key}`}
                className={cn(
                  "rounded-md px-2.5 py-1 transition-colors",
                  data.range.key === r.key ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50",
                )}
              >
                {r.label}
              </Link>
            ))}
          </nav>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {metrics.map((m) => (
          <MetricCard key={m.label} {...m} />
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <FunnelCard funnel={data.funnel} />
        <WorkQueue queue={data.workQueue} />
        <ScoreDistributionCard dist={data.scoreDistribution} />
      </div>

      <section className="mt-6 rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <SparklesIcon className="size-4 text-muted-foreground" /> Enrichment coverage
          </h2>
          <Link href="/lead-engine/enrichment" className="text-xs text-muted-foreground hover:underline">
            Queue →
          </Link>
        </div>
        {enrichment.eligibleCandidates === 0 ? (
          <p className="text-sm text-muted-foreground">No candidates with a website or domain yet.</p>
        ) : (
          <>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">Candidates with enriched data</span>
              <span className="tabular-nums">
                <span className="font-semibold text-foreground">
                  {enrichment.enrichedCandidates} / {enrichment.eligibleCandidates}
                </span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-violet-500" style={{ width: `${enrichment.coveragePct}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span>
                <span className="font-medium text-foreground tabular-nums">{enrichment.recentlyEnriched}</span> enriched in freshness window
              </span>
              <span>
                <span className="font-medium text-foreground tabular-nums">{enrichment.failedLast7d}</span> failed (7d)
              </span>
              <span>
                <span className="font-medium text-foreground tabular-nums">{enrichment.openConflicts}</span>{" "}
                <Link href="/lead-engine/candidates?enrichment=HAS_CONFLICTS" className="underline-offset-4 hover:underline">
                  open conflicts
                </Link>
              </span>
            </div>
          </>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <ActivityIcon className="size-4 text-muted-foreground" /> Recent activity
        </h2>
          <ul className="space-y-2 text-sm">
            {data.activity.map((a, i) => {
              const Icon = kindIcon[a.kind]
              return (
                <li key={i} className="flex items-start gap-2">
                  <Icon className={cn("mt-0.5 size-3.5 shrink-0", a.kind === "failed" ? "text-destructive" : "text-muted-foreground")} />
                  <span className="min-w-0 flex-1 truncate">{a.text}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeDay(a.time)}</span>
                </li>
              )
            })}
            {data.activity.length === 0 && <li className="text-xs text-muted-foreground">No activity yet.</li>}
          </ul>
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Source performance</h2>
        </div>
        {data.sources.length === 0 ? (
          <div className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
            No sources produced candidates in this period.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.sources.slice(0, 6).map((s) => (
              <SourceCard key={s.id} s={s} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent runs</h2>
          <Link href="/scrapers/runs" className="text-xs text-muted-foreground hover:underline">
            All runs →
          </Link>
        </div>
        <div className="space-y-2">
          {data.recentRuns.map((r) => (
            <RunCard key={r.id} run={r} />
          ))}
        </div>
      </section>
    </div>
  )
}