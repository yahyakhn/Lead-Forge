// TASK 023: presentational analytics primitives. Pure CSS bars/funnels in the
// existing design system (the lead-engine dashboard does the same — no chart
// library needed). Every chart carries an accessible text summary (§45).

import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

export function KpiCard({
  label,
  value,
  hint,
  accent,
  icon,
}: {
  label: string
  value: string | number | null
  hint?: ReactNode
  accent?: "default" | "emerald"
  icon?: ReactNode
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        {icon ? <span className="text-muted-foreground/60">{icon}</span> : null}
      </div>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", accent === "emerald" && "text-emerald-600 dark:text-emerald-500")}>
        {value === null || value === undefined ? "—" : typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function SectionCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function EmptySection({ message }: { message: string }) {
  return <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{message}</p>
}

// Horizontal category bars with labels, values and percentages. The long tail
// beyond `maxItems` is folded deterministically into "Other" (§21).
export function CategoryBars({
  items,
  maxItems = 8,
  valueSuffix = "",
}: {
  items: { label: string; count: number }[]
  maxItems?: number
  valueSuffix?: string
}) {
  const total = items.reduce((a, i) => a + i.count, 0)
  const shown = items.slice(0, maxItems)
  const rest = items.slice(maxItems)
  const rows =
    rest.length > 0
      ? [...shown, { label: "Other", count: rest.reduce((a, i) => a + i.count, 0) }]
      : shown
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <div aria-label="Category distribution">
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{row.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${(row.count / max) * 100}%` }} />
              </div>
            </div>
            <span className="text-right text-xs tabular-nums">
              <span className="font-semibold">{row.count.toLocaleString()}</span>
              {total > 0 && <span className="ml-1 text-muted-foreground">{Math.round((row.count / total) * 100)}%</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="sr-only">
        {rows.map((r) => `${r.label}: ${r.count}${valueSuffix}`).join(". ")}
      </p>
    </div>
  )
}

// Time-series bars; granularity (day/week/month) is decided server-side.
export function TrendChart({ points }: { points: { label: string; count: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.count))
  const step = points.length > 40 ? Math.ceil(points.length / 12) : 1
  return (
    <div role="img" aria-label={`Lead trend: ${points.map((p) => `${p.label}: ${p.count}`).join(", ")}`}>
      <div className="flex h-40 items-end gap-px">
        {points.map((p) => (
          <div key={p.label} className="group relative flex h-full flex-1 items-end" title={`${p.label}: ${p.count}`}>
            <div className="w-full rounded-t bg-primary/70 transition-colors group-hover:bg-primary" style={{ height: `${(p.count / max) * 100}%` }} />
            <span className="pointer-events-none absolute -top-5 left-1/2 hidden -translate-x-1/2 rounded bg-popover px-1 text-[10px] text-popover-foreground ring-1 ring-foreground/10 group-hover:block">
              {p.count}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-px">
        {points.map((p, i) => (
          <span key={p.label} className={cn("flex-1 text-center text-[10px] text-muted-foreground", i % step !== 0 && "invisible")}>
            {p.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export function FunnelView({ funnel }: { funnel: { stage: string; count: number; pctOfPrev: number | null }[] }) {
  const max = Math.max(1, ...funnel.map((s) => s.count))
  const colors = ["bg-slate-400", "bg-sky-400", "bg-blue-500", "bg-indigo-500"]
  return (
    <div>
      <ul className="space-y-3">
        {funnel.map((s, i) => (
          <li key={s.stage}>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">{s.stage}</span>
              <span className="tabular-nums">
                <span className="font-semibold">{s.count.toLocaleString()}</span>
                {s.pctOfPrev !== null && <span className="text-muted-foreground"> / {s.pctOfPrev}% of previous</span>}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full", colors[i])} style={{ width: `${(s.count / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="sr-only">{funnel.map((s) => `${s.stage}: ${s.count}`).join(", ")}</p>
    </div>
  )
}