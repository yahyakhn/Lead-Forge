import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/format"
import type {
  ClassificationView,
  ResolvedReference,
} from "@/lib/lead-engine/intelligence/service"
import type { EvidenceItem } from "@/lib/lead-engine/classification/service"

const LABEL_STYLE: Record<string, string> = {
  HIGH_FIT: "bg-green-100 text-green-800 dark:bg-green-900/40",
  MEDIUM_FIT: "bg-blue-100 text-blue-800 dark:bg-blue-900/40",
  LOW_FIT: "bg-amber-100 text-amber-800 dark:bg-amber-900/40",
  INSUFFICIENT_DATA: "bg-slate-200 text-slate-600 dark:bg-slate-700",
}

export function ClassificationBadge({ label }: { label: string }) {
  return (
    <Badge
      variant="outline"
      className={LABEL_STYLE[label] ?? LABEL_STYLE.INSUFFICIENT_DATA}
    >
      {label.replace(/_/g, " ")}
    </Badge>
  )
}

function List({
  title,
  values,
  mark,
}: {
  title: string
  values: string[]
  mark: "check" | "warn"
}) {
  if (values.length === 0) return null
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <ul className="mt-1.5 space-y-1 text-sm">
        {values.map((value) => (
          <li
            key={value}
            className={
              mark === "warn" ? "text-amber-700 dark:text-amber-400" : undefined
            }
          >
            {mark === "check" ? "✓" : "⚠"} {value}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ClassificationSection({
  view,
  refs,
}: {
  view: ClassificationView | null
  refs: ResolvedReference<EvidenceItem>[]
}) {
  if (!view) return null
  const { result } = view
  const criteria = [
    ...result.matchedCriteria.map((c) => ({ text: c, matched: true })),
    ...result.unmatchedCriteria.map((c) => ({ text: c, matched: false })),
  ]

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">AI Classification</h2>
        <ClassificationBadge label={result.classification} />
      </div>
      <p className="text-xs text-muted-foreground">
        AI-generated assessment against the active ICP — informational only,
        never written to CRM facts.
      </p>
      <div className="mt-3 grid gap-4 text-sm sm:grid-cols-[1fr_120px]">
        <div className="space-y-3">
          <List title="Reasons" values={result.reasons} mark="check" />
          <List title="Concerns" values={result.concerns} mark="warn" />
          {criteria.length > 0 ? (
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Criteria verdicts
              </h3>
              <ul className="mt-1.5 space-y-1">
                {criteria.map((c) => (
                  <li
                    key={c.text}
                    className="flex items-baseline gap-2 text-sm"
                  >
                    <span
                      className={
                        c.matched
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }
                    >
                      {c.matched ? "✓ matched" : "✗ not matched"}
                    </span>
                    <span>{c.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {refs.length > 0 ? (
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Evidence
              </h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {refs.map((r) =>
                  r.item ? (
                    <a
                      key={r.ref}
                      href="#evidence"
                      title={r.item.text}
                      className="rounded-full border px-2 py-0.5 font-mono text-[11px] hover:bg-muted"
                    >
                      {r.ref}
                    </a>
                  ) : (
                    <span
                      key={r.ref}
                      className="rounded-full border border-dashed px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                    >
                      {r.ref} (unavailable)
                    </span>
                  ),
                )}
              </div>
            </div>
          ) : null}
        </div>
        <div className="rounded-lg border bg-muted/50 p-3 text-center sm:self-start">
          <dt className="text-xs text-muted-foreground">Fit Score</dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums">
            {result.fitScore}
          </dd>
        </div>
      </div>
      <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
        Model: {result.model || "—"} · Classified: {formatDate(view.updatedAt)}
      </p>
    </section>
  )
}
