import type { CriterionResult } from "@/lib/lead-engine/scoring/engine"

export function ScoreBreakdown({ breakdown, reasons }: { breakdown: CriterionResult[]; reasons: string[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">ICP Fit Breakdown</h3>
        <dl className="mt-2 grid gap-y-1 sm:grid-cols-2 text-sm">
          {breakdown.map((item) => (
            <div key={item.criterion} className="flex items-center justify-between gap-2 border-b border-muted/50 py-1">
              <span className="capitalize">{item.criterion}</span>
              <span className="font-medium tabular-nums">
                {item.score}/{item.maxScore} ({item.status})
              </span>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Reasons</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {reasons.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="shrink-0 text-xs">{r.startsWith("✓") || r.startsWith("⚠") || r.startsWith("?") ? r[0] : "•"}</span>
              <span className={r.startsWith("⚠") ? "text-amber-600" : r.startsWith("?") ? "text-muted-foreground" : ""}>{r.slice(1).trim()}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}