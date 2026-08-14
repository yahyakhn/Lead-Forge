// TASK 019: minimal "Research Account" trigger on the company detail page
// (spec §42). Runs researchAccount via the server action and shows the latest
// research result in a compact card.

"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { researchAccountAction, type ActionResult } from "@/lib/actions"
import type { AccountResearchResult } from "@/lib/lead-engine/research/service"
import { SparklesIcon } from "lucide-react"

interface Props {
  companyId: string
  existing: AccountResearchResult | null
}

export function AccountResearchCard({ companyId, existing }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const run = () =>
    startTransition(async () => {
      const result: ActionResult | { ok: true; result: AccountResearchResult } = await researchAccountAction({ companyId })
      if (result.ok) {
        toast.success("Research updated")
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })

  const research = existing

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Account research</h2>
        <Button variant="outline" size="sm" onClick={run} disabled={pending}>
          <SparklesIcon />
          {pending ? "Researching…" : existing ? "Research again" : "Research account"}
        </Button>
      </div>

      {!research ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          No research yet. Run account research to summarize what we know about this company.
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          <p>{research.companySummary}</p>
          {research.keyFacts.length > 0 && (
            <List label="Key facts" items={research.keyFacts} />
          )}
          {research.relevantSignals.length > 0 && (
            <List label="Signals" items={research.relevantSignals} />
          )}
          {research.researchInsights.length > 0 && (
            <ol className="space-y-1.5">
              <li className="text-xs font-semibold text-muted-foreground">Insights</li>
              {research.researchInsights.map((i, idx) => (
                <li key={idx} className="text-muted-foreground">
                  {i}
                </li>
              ))}
            </ol>
          )}
          {research.unknowns.length > 0 && (
            <List label="Unknowns" items={research.unknowns} />
          )}
          {research.evidenceReferences.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Evidence: {research.evidenceReferences.join(", ")}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function List({ label, items }: { label: string; items: string[] }) {
  return (
    <ul className="space-y-1">
      <li className="text-xs font-semibold text-muted-foreground">{label}</li>
      {items.map((item, idx) => (
        <li key={idx} className="text-muted-foreground">
          {item}
        </li>
      ))}
    </ul>
  )
}