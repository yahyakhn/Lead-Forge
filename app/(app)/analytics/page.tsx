import Link from "next/link"
import { requireSession } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getCrmAnalytics, sourceLabel } from "@/lib/crm/analytics"
import { listUsers } from "@/lib/crm/options"
import { PageHeader } from "@/components/crm/page-header"
import { EmptyState, ErrorState } from "@/components/crm/states"
import { FilterSelect } from "@/components/crm/search-bar"
import { LEAD_STATUS_OPTIONS } from "@/components/crm/forms"
import { RangePicker } from "@/components/crm/analytics/range-picker"
import { CategoryBars, EmptySection, FunnelView, KpiCard, SectionCard, TrendChart } from "@/components/crm/analytics/charts"
import { formatMoney } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ActivityIcon, BarChart3Icon, Building2Icon, CrosshairIcon, FlagIcon, GaugeIcon, GlobeIcon, RadarIcon, SparklesIcon, TargetIcon, TrendingUpIcon, Users2Icon } from "lucide-react"

type SearchParams = Record<string, string | string[] | undefined>

const CLASSIFICATION_LABELS: Record<string, string> = {
  HIGH_FIT: "High fit",
  MEDIUM_FIT: "Medium fit",
  LOW_FIT: "Low fit",
  INSUFFICIENT_DATA: "Insufficient data",
}

const SCORE_OPTIONS = [
  { value: "90", label: "90+" },
  { value: "75", label: "75+" },
  { value: "60", label: "60+" },
  { value: "40", label: "40+" },
]

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireSession()
  const sp = await searchParams

  let data
  let users
  let sourceOptions
  let industryOptions
  let icpOptions
  try {
    ;[data, users, sourceOptions, industryOptions, icpOptions] = await Promise.all([
      getCrmAnalytics(session.organization.id, sp),
      listUsers(session.organization.id),
      prisma.lead.findMany({ where: { organizationId: session.organization.id }, distinct: ["source"], select: { source: true } }),
      prisma.company.findMany({ where: { organizationId: session.organization.id, industry: { not: null } }, distinct: ["industry"], select: { industry: true } }),
      prisma.iCPProfile.findMany({ where: { organizationId: session.organization.id }, select: { id: true, name: true } }),
    ])
  } catch {
    return <ErrorState message="We couldn't load your analytics." />
  }

  const { filters, kpis } = data
  const rangeLabel =
    filters.range === "custom"
      ? `${filters.from.toLocaleDateString()} – ${new Date(filters.to.getTime() - 1).toLocaleDateString()}`
      : filters.range === "today"
        ? "Today"
        : filters.range === "all"
          ? "All time"
          : `${filters.from.toLocaleDateString()} – ${new Date(filters.to.getTime() - 1).toLocaleDateString()}`

  const hasLeads = kpis.totalLeads > 0 || kpis.newLeads > 0

  return (
    <div>
      <PageHeader
        title="Analytics"
        description={`${session.organization.name} · ${rangeLabel}`}
        actions={<RangePicker />}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterSelect param="status" placeholder="Status" options={LEAD_STATUS_OPTIONS} />
        <FilterSelect
          param="source"
          placeholder="Source"
          options={sourceOptions
            .filter((s): s is { source: string } => s.source !== null)
            .map((s) => ({ value: s.source, label: sourceLabel(s.source) }))}
        />
        <FilterSelect
          param="industry"
          placeholder="Industry"
          options={industryOptions
            .filter((i): i is { industry: string } => i.industry !== null)
            .map((i) => ({ value: i.industry, label: i.industry }))}
        />
        <FilterSelect param="owner" placeholder="Owner" options={users.map((u) => ({ value: u.id, label: u.name }))} />
        <FilterSelect param="icp" placeholder="ICP" options={icpOptions.map((i) => ({ value: i.id, label: i.name }))} />
        <FilterSelect param="minScore" placeholder="Min score" options={SCORE_OPTIONS} />
        {(filters.status || filters.source || filters.industry || filters.ownerId || filters.icpId || filters.minScore !== undefined) && (
          <Link href="/analytics" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
            Clear filters
          </Link>
        )}
      </div>

      {!hasLeads ? (
        <EmptyState
          title="No leads yet"
          description="Once you import, scrape or add leads manually, your CRM analytics will appear here."
          action={<Link href="/leads" className="text-sm text-primary underline-offset-4 hover:underline">Go to Leads</Link>}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard label="Total leads" value={kpis.totalLeads} hint="all time" icon={<Users2Icon />} />
            <KpiCard label="New leads" value={kpis.newLeads} hint="in period" accent="emerald" icon={<TrendingUpIcon />} />
            <KpiCard label="Qualified" value={kpis.qualifiedLeads} hint="status QUALIFIED" icon={<FlagIcon />} />
            <KpiCard
              label="ICP fit"
              value={kpis.icpFitLeads}
              hint={kpis.icpFitPct !== null ? `${kpis.icpFitPct}% of period leads` : "no scored leads"}
              icon={<CrosshairIcon />}
            />
            <KpiCard label="Avg lead score" value={kpis.avgScore} hint={kpis.scoredLeads > 0 ? `${kpis.scoredLeads} scored leads` : "no scores yet"} icon={<GaugeIcon />} />
            <KpiCard label="Activities" value={kpis.activities} hint="in period" icon={<ActivityIcon />} />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <SectionCard title="Lead trend" action={<span className="text-xs text-muted-foreground">leads created over time</span>}>
              {data.trend.every((t) => t.count === 0) ? (
                <EmptySection message="No leads created in this period." />
              ) : (
                <TrendChart points={data.trend} />
              )}
            </SectionCard>

            <SectionCard title="Conversion funnel" action={<span className="text-xs text-muted-foreground">current status cohorts</span>}>
              {data.funnel.every((f) => f.count === 0) ? (
                <EmptySection message="No pipeline data available." />
              ) : (
                <>
                  <FunnelView funnel={data.funnel} />
                  <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-xs">
                    <div>
                      <p className="text-muted-foreground">Conversion rate</p>
                      <p className="mt-0.5 font-semibold tabular-nums">
                        {data.conversionRate !== null ? `${data.conversionRate}%` : "Not enough data"}
                      </p>
                      <p className="text-muted-foreground">converted / new in period</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Account research</p>
                      <p className="mt-0.5 font-semibold tabular-nums">
                        {data.research.researched} / {data.research.totalCompanies}
                      </p>
                      <p className="text-muted-foreground">companies with research</p>
                    </div>
                  </div>
                </>
              )}
            </SectionCard>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <SectionCard title="Pipeline" action={<Link href="/pipeline" className="text-xs text-muted-foreground hover:underline">Open pipeline →</Link>}>
              {data.pipeline.every((p) => p.deals === 0) ? (
                <EmptySection message="No pipeline data available." />
              ) : (
                <ul className="space-y-2">
                  {data.pipeline.map((p) => (
                    <li key={p.stage} className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className={cn("size-1.5 rounded-full", p.isWon ? "bg-emerald-500" : p.isClosed ? "bg-slate-400" : "bg-sky-500")} />
                        {p.stage}
                      </span>
                      <span className="tabular-nums text-xs">
                        <span className="font-semibold">{p.deals.toLocaleString()} deals</span>
                        <span className="ml-2 text-muted-foreground">{formatMoney(p.value)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard title="Lead sources" action={<span className="text-xs text-muted-foreground">in period</span>}>
              {data.sources.length === 0 ? (
                <EmptySection message="No leads in this period." />
              ) : (
                <CategoryBars items={data.sources.map((s) => ({ label: sourceLabel(s.source), count: s.count }))} />
              )}
            </SectionCard>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <SectionCard title="Industries" action={<Building2Icon className="size-4 text-muted-foreground/60" />}>
              {data.industries.length === 0 ? <EmptySection message="No companies yet." /> : <CategoryBars items={data.industries.map((i) => ({ label: i.industry, count: i.count }))} />}
            </SectionCard>
            <SectionCard title="Locations" action={<GlobeIcon className="size-4 text-muted-foreground/60" />}>
              {data.countries.length === 0 ? <EmptySection message="No location data yet." /> : <CategoryBars items={data.countries.map((c) => ({ label: c.country, count: c.count }))} />}
            </SectionCard>
            <SectionCard title="Company size" action={<BarChart3Icon className="size-4 text-muted-foreground/60" />}>
              {data.sizes.length === 0 ? <EmptySection message="No companies yet." /> : <CategoryBars items={data.sizes.map((s) => ({ label: s.size, count: s.count }))} />}
            </SectionCard>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <SectionCard title="Lead score distribution" action={<GaugeIcon className="size-4 text-muted-foreground/60" />}>
              {kpis.scoredLeads === 0 ? (
                <EmptySection message="No scored leads available." />
              ) : (
                <>
                  <CategoryBars items={data.scoreDistribution.map((b) => ({ label: b.bucket, count: b.count }))} />
                  <div className="mt-3 border-t pt-3">
                    <p className="mb-1 text-xs text-muted-foreground">ICP qualification</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(["HOT", "GOOD", "MAYBE", "LOW", "UNQUALIFIED"] as const).map((q) => (
                        <span key={q} className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium",
                          q === "HOT" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40"
                            : q === "GOOD" ? "bg-green-100 text-green-800 dark:bg-green-900/40"
                              : q === "MAYBE" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40"
                                : q === "LOW" ? "bg-red-100 text-red-800 dark:bg-red-900/40"
                                  : "bg-slate-100 text-slate-800 dark:bg-slate-900/40",
                        )}>
                          {q} {data.qualification[q]}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </SectionCard>

            <SectionCard title="AI classification" action={<SparklesIcon className="size-4 text-muted-foreground/60" />}>
              {data.classification.length === 0 && data.unclassifiedLeads === 0 ? (
                <EmptySection message="No AI classifications yet." />
              ) : (
                <CategoryBars
                  items={[
                    ...data.classification.map((c) => ({ label: CLASSIFICATION_LABELS[c.label] ?? c.label, count: c.count })),
                    { label: "Unclassified", count: data.unclassifiedLeads },
                  ]}
                />
              )}
            </SectionCard>

            <SectionCard title="Signals" action={<RadarIcon className="size-4 text-muted-foreground/60" />}>
              {data.signals.length === 0 ? (
                <EmptySection message="No signals detected in this period." />
              ) : (
                <CategoryBars items={data.signals.map((s) => ({ label: s.signal, count: s.count }))} />
              )}
            </SectionCard>
          </div>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            <TargetIcon className="mr-1 inline size-3" />
            Analytics are computed live from your CRM data. Filters apply to every section consistently.
          </p>
        </>
      )}
    </div>
  )
}