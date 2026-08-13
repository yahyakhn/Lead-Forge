"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { updateEnrichmentSettingsAction } from "@/lib/actions"

interface SettingsInput {
  enabled: boolean
  maxPagesPerCompany: number
  maxDepth: number
  requestDelayMs: number
  requestTimeoutMs: number
  freshnessDays: number
  batchMaxLeads: number
  allowedDomains: string[]
}

function NumberField({ label, value, onChange, min, max, hint }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 rounded-md border bg-background px-3 text-sm text-foreground"
      />
      {hint ? <span className="text-[0.7rem]">{hint}</span> : null}
    </label>
  )
}

export function EnrichmentSettingsForm({ initial }: { initial: SettingsInput }) {
  const router = useRouter()
  const [form, setForm] = useState<SettingsInput>(initial)
  const [domains, setDomains] = useState(initial.allowedDomains.join(", "))
  const [pending, startTransition] = useTransition()

  const save = () =>
    startTransition(async () => {
      const r = await updateEnrichmentSettingsAction({
        enabled: form.enabled,
        maxPagesPerCompany: form.maxPagesPerCompany,
        maxDepth: form.maxDepth,
        requestDelayMs: form.requestDelayMs,
        requestTimeoutMs: form.requestTimeoutMs,
        freshnessDays: form.freshnessDays,
        batchMaxLeads: form.batchMaxLeads,
        allowedDomains: domains.split(",").map((d) => d.trim()).filter(Boolean),
      })
      if (!r.ok) {
        toast.error(r.error ?? "Settings update failed")
        return
      }
      toast.success("Enrichment settings saved.")
      router.refresh()
    })

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="size-4" />
        Enable lead enrichment
      </label>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <NumberField label="Max pages per company" value={form.maxPagesPerCompany} onChange={(v) => setForm({ ...form, maxPagesPerCompany: v })} min={1} max={20} />
        <NumberField label="Crawl depth" value={form.maxDepth} onChange={(v) => setForm({ ...form, maxDepth: v })} min={0} max={2} hint="0 = home page only" />
        <NumberField label="Delay between requests (ms)" value={form.requestDelayMs} onChange={(v) => setForm({ ...form, requestDelayMs: v })} min={0} max={60000} />
        <NumberField label="Request timeout (ms)" value={form.requestTimeoutMs} onChange={(v) => setForm({ ...form, requestTimeoutMs: v })} min={1000} max={60000} />
        <NumberField label="Freshness window (days)" value={form.freshnessDays} onChange={(v) => setForm({ ...form, freshnessDays: v })} min={0} max={90} hint="0 = always re-enrich" />
        <NumberField label="Bulk batch max" value={form.batchMaxLeads} onChange={(v) => setForm({ ...form, batchMaxLeads: v })} min={1} max={500} />
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Allowed domains (comma-separated, in addition to the company&apos;s own domain)
        <input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="linkedin.com, crunchbase.com" className="h-9 rounded-md border bg-background px-3 text-sm text-foreground" />
      </label>

      <p className="text-xs text-muted-foreground">
        Enrichment crawls the company website using the Lead Engine crawler. robots.txt and rate limits are always respected.
      </p>

      <Button disabled={pending} onClick={save}>
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </div>
  )
}
