import { formatDate } from "@/lib/format"
import type { AccountResearchResult } from "@/lib/lead-engine/research/service"
import type { ResolvedReference } from "@/lib/lead-engine/intelligence/service"
import type { ResearchEvidenceItem } from "@/lib/lead-engine/research/service"

function List({ title, values }: { title: string; values: string[] }) {
  if (values.length === 0) return null
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <ul className="mt-1.5 space-y-1 text-sm">
        {values.map((value) => (
          <li key={value} className="list-inside list-disc">
            {value}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ResearchSection({
  research,
  refs,
}: {
  research: AccountResearchResult | null
  refs: ResolvedReference<ResearchEvidenceItem>[]
}) {
  if (!research) return null
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">Account Research</h2>
        <p className="text-xs text-muted-foreground">
          AI-generated company research — informational only, never written to
          CRM facts.
        </p>
      </div>
      <p className="text-sm leading-relaxed">{research.companySummary}</p>
      <div className="mt-4 space-y-3">
        <List title="Key facts" values={research.keyFacts} />
        <div>
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Signals of interest
          </h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {research.relevantSignals.length > 0 ? (
              research.relevantSignals.map((signal) => (
                <span
                  key={signal}
                  className="rounded-full border bg-muted/50 px-2 py-0.5 text-xs"
                >
                  {signal}
                </span>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">
                None identified.
              </span>
            )}
          </div>
        </div>
        <List title="Insights" values={research.researchInsights} />
        <List title="Unknowns" values={research.unknowns} />
        {refs.length > 0 ? (
          <div>
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Evidence
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {refs.map((r) =>
                r.item ? (
                  <span
                    key={r.ref}
                    title={r.item.text}
                    className="rounded-full border px-2 py-0.5 font-mono text-[11px]"
                  >
                    {r.ref}
                  </span>
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
      <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
        Model: {research.model || "—"} · Researched:{" "}
        {formatDate(research.updatedAt)}
      </p>
    </section>
  )
}
