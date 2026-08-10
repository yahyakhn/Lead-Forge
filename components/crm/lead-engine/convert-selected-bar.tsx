"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ArrowRightLeftIcon, CheckIcon } from "lucide-react"
import { previewBulkAction, bulkConvertAction } from "@/lib/actions"
import type { PreviewPlan, BulkSummary } from "@/lib/lead-engine/conversion/service"

interface Row {
  id: string
  label: string
  eligible: boolean
}

const actionLabel = (action: string | undefined) =>
  action === "CREATE" ? "create" : action === "REUSE" ? "reuse" : action === "BLOCKED" ? "blocked" : "—"

export function ConvertSelectedBar({ candidates }: { candidates: Row[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [plan, setPlan] = useState<PreviewPlan[] | null>(null)
  const [summary, setSummary] = useState<BulkSummary | null>(null)
  const [pending, startTransition] = useTransition()

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  const checkedIds = [...selected]

  const preview = () =>
    startTransition(async () => {
      if (checkedIds.length === 0) return
      const result = await previewBulkAction(checkedIds)
      if (result.ok && result.plan) {
        setPlan(result.plan)
        setSummary(null)
      } else {
        toast.error(result.error ?? "Preview failed")
      }
    })

  const convert = () =>
    startTransition(async () => {
      if (checkedIds.length === 0) return
      const result = await bulkConvertAction(checkedIds)
      if (result.ok && result.summary) {
        setSummary(result.summary)
        setPlan(null)
        setSelected(new Set())
      } else {
        toast.error(result.error ?? "Conversion failed")
      }
    })

  const creates = (plan ?? []).filter((p) => p.status !== "ALREADY_CONVERTED" && p.status !== "BLOCKED")

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {candidates.length} eligible candidates · {selected.size} selected
        </span>
        <Button size="sm" variant="outline" disabled={pending || selected.size === 0} onClick={preview}>
          Preview conversion
        </Button>
        <Button size="sm" disabled={pending || selected.size === 0} onClick={convert}>
          <ArrowRightLeftIcon className="size-4" /> Convert selected
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {candidates.map((c) => (
          <label
            key={c.id}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${selected.has(c.id) ? "border-primary bg-primary/10" : "bg-muted/40"}`}
          >
            <input type="checkbox" className="size-3.5 accent-primary" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
            {c.label}
          </label>
        ))}
      </div>

      {plan ? (
        <div className="mt-4 border-t pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversion preview (no changes made)</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {plan.map((p) => (
              <li key={p.candidateId} className="flex flex-wrap gap-x-3">
                <span className="font-medium">{p.company.name ?? p.candidateId.slice(-6)}</span>
                <span className="text-muted-foreground">
                  company {actionLabel(p.company.action)} · contact {actionLabel(p.contact.action)} · lead {actionLabel(p.lead.action)}
                </span>
                <span className={p.status === "BLOCKED" || p.status === "NEEDS_REVIEW" ? "text-amber-600" : "text-muted-foreground"}>
                  {p.status === "ALREADY_CONVERTED" ? "already converted" : p.status === "NEEDS_REVIEW" ? "needs review" : p.error ?? ""}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-xs text-muted-foreground">
            Will create: {creates.filter((p) => p.company.action === "CREATE").length} companies,{" "}
            {creates.filter((p) => p.contact.action === "CREATE").length} contacts, {creates.filter((p) => p.lead.action === "CREATE").length} leads · Reuse:{" "}
            {creates.filter((p) => p.company.action === "REUSE").length} companies, {creates.filter((p) => p.contact.action === "REUSE").length} contacts
          </div>
          <Button size="sm" className="mt-3" disabled={pending} onClick={convert}>
            <CheckIcon className="size-4" /> Confirm conversion
          </Button>
        </div>
      ) : null}

      {summary ? (
        <div className="mt-4 border-t pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversion results</h3>
          <p className="mt-2 text-sm">
            Processed <span className="font-medium">{summary.selected}</span> ·{" "}
            <span className="font-medium text-emerald-600">{summary.converted} converted</span> ·{" "}
            <span className="text-muted-foreground">{summary.alreadyConverted} already converted</span> ·{" "}
            <span className="text-amber-600">{summary.needsReview} needs review</span> ·{" "}
            <span className="text-destructive">{summary.failed.length - summary.needsReview} skipped/failed</span>
          </p>
          {summary.failed.length > 0 ? (
            <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto text-xs text-muted-foreground">
              {summary.failed.map((f) => (
                <li key={f.candidateId}>
                  #{f.candidateId.slice(-6)} — {f.code}: {f.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}