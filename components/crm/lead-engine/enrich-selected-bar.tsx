"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SparklesIcon } from "lucide-react"
import { bulkPreviewEnrichmentAction, bulkEnrichCandidatesAction } from "@/lib/actions"

interface Row {
  id: string
  label: string
}

interface Preview {
  eligible: number
  recentlyEnriched: number
  missingWebsite: number
  active: number
  queued: number
}

export function EnrichSelectedBar({ candidates }: { candidates: Row[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<{ queued: number; skippedRecent: number; skippedActive: number; ineligible: number; failed: number } | null>(null)
  const [pending, startTransition] = useTransition()

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  const checkedIds = [...selected]

  const openPreview = () =>
    startTransition(async () => {
      const r = await bulkPreviewEnrichmentAction(checkedIds)
      if (!r.ok || !r.preview) {
        toast.error(r.error ?? "Preview failed")
        return
      }
      setPreview(r.preview)
    })

  const run = () =>
    startTransition(async () => {
      if (!preview) return
      const r = await bulkEnrichCandidatesAction(checkedIds)
      if (!r.ok || !r.summary) {
        toast.error(r.error ?? "Bulk enrichment failed")
        return
      }
      setResult(r.summary)
      setSelected(new Set())
      router.refresh()
    })

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {candidates.length} candidates · {selected.size} selected
        </span>
        <Button size="sm" variant="outline" disabled={pending || selected.size === 0} onClick={openPreview}>
          Preview enrichment
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

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enrichment preview</DialogTitle>
          </DialogHeader>
          {preview ? (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">{preview.eligible}</span> of {checkedIds.length} candidates are eligible for website enrichment.
              </p>
              <ul className="space-y-1 text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">{preview.queued}</span> will be queued now
                </li>
                <li>
                  <span className="font-medium text-foreground">{preview.recentlyEnriched}</span> enriched recently (freshness window) — skipped
                </li>
                <li>
                  <span className="font-medium text-foreground">{preview.active}</span> already queued or running — skipped
                </li>
                <li>
                  <span className="font-medium text-foreground">{preview.missingWebsite}</span> missing a website or domain — skipped
                </li>
              </ul>
              {preview.eligible > 0 ? (
                <Button className="mt-2 w-full" disabled={pending} onClick={run}>
                  <SparklesIcon className="size-4" /> Enrich {preview.eligible} candidates
                </Button>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={result !== null} onOpenChange={(open) => !open && setResult(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Bulk enrichment started</DialogTitle>
          </DialogHeader>
          {result ? (
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">{result.queued}</span> queued
              </li>
              <li>
                <span className="font-medium text-foreground">{result.skippedRecent}</span> skipped (recently enriched)
              </li>
              <li>
                <span className="font-medium text-foreground">{result.skippedActive}</span> skipped (already active)
              </li>
              <li>
                <span className="font-medium text-foreground">{result.ineligible}</span> skipped (no website or domain)
              </li>
              {result.failed > 0 ? (
                <li>
                  <span className="font-medium text-foreground">{result.failed}</span> failed to queue
                </li>
              ) : null}
            </ul>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
