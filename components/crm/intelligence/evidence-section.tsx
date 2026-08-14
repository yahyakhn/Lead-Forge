import type { EvidenceItem } from "@/lib/lead-engine/classification/service"
import type { JobPosting } from "@/lib/lead-engine/extraction/types"

export function EvidenceSection({
  evidence,
  hiringSignals,
}: {
  evidence: EvidenceItem[]
  hiringSignals: JobPosting[]
}) {
  const activeJobs = hiringSignals.filter((job) => job.title?.trim())
  return (
    <section id="evidence" className="rounded-xl border bg-card p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">Evidence</h2>
        <p className="text-xs text-muted-foreground">
          Deterministic facts gathered from the company profile, contacts,
          enrichment and extraction — the numbered items AI findings cite (E1,
          E2, …).
        </p>
      </div>
      {evidence.length === 0 && activeJobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No evidence recorded for this lead yet.
        </p>
      ) : (
        <div className="space-y-3">
          {evidence.length > 0 ? (
            <ol className="space-y-1.5">
              {evidence.map((item, index) => (
                <li key={index} className="flex items-baseline gap-2 text-sm">
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    E{index + 1}
                  </span>
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground bg-muted">
                    {item.source.replace(/_/g, " ")}
                  </span>
                  <span className="text-muted-foreground">{item.text}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {activeJobs.length > 0 ? (
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Observed hiring signals
              </h3>
              <ul className="mt-1.5 space-y-1 text-sm">
                {activeJobs.map((job, index) => (
                  <li
                    key={`${job.title}-${index}`}
                    className="flex items-baseline gap-2"
                  >
                    <span className="text-emerald-600 dark:text-emerald-400">
                      ●
                    </span>
                    <span className="font-medium">{job.title}</span>
                    <span className="text-muted-foreground">
                      {[job.hiringOrganization, job.location]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
