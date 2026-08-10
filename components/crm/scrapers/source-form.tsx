"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import type { ActionResult } from "@/lib/actions"
import { SearchableSelect, type SearchOption } from "@/components/crm/searchable-select"

export interface SourceFormInitial {
  name: string
  description: string
  type: string
  isActive: boolean
  config: unknown
}

// Keep in sync with CRAWL_DEFAULTS in lib/lead-engine/crawler/defaults.ts;
// the server re-validates everything against the real limits.
const WEBSITE_DEFAULTS = {
  maxPages: 100,
  maxDepth: 2,
  concurrencyMin: 1,
  concurrencyMax: 3,
  delayMs: 0,
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

export function SourceForm({
  action,
  submitLabel,
  adapterOptions,
  initial,
}: {
  action: (input: unknown) => Promise<ActionResult>
  submitLabel: string
  adapterOptions: { id: string; name: string; type: string; description: string }[]
  initial?: SourceFormInitial
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState("")

  const [name, setName] = useState(initial?.name ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [type, setType] = useState(initial?.type ?? adapterOptions[0]?.type ?? "")
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)

  const initialConfig = (initial?.config ?? {}) as Record<string, unknown>
  const [maxResults, setMaxResults] = useState(() =>
    typeof initialConfig.maxResults === "number" ? String(initialConfig.maxResults) : "",
  )
  const [startUrls, setStartUrls] = useState(() => {
    const urls = initialConfig.startUrls
    return Array.isArray(urls) ? urls.join("\n") : ""
  })
  const [allowedDomains, setAllowedDomains] = useState(() => {
    const domains = initialConfig.allowedDomains
    return Array.isArray(domains) ? domains.join("\n") : ""
  })
  const [maxPages, setMaxPages] = useState(() => String(initialConfig.maxPages ?? WEBSITE_DEFAULTS.maxPages))
  const [maxDepth, setMaxDepth] = useState(() => String(initialConfig.maxDepth ?? WEBSITE_DEFAULTS.maxDepth))
  const [concurrencyMin, setConcurrencyMin] = useState(() => {
    const c = initialConfig.concurrency as { min?: number } | undefined
    return String(c?.min ?? WEBSITE_DEFAULTS.concurrencyMin)
  })
  const [concurrencyMax, setConcurrencyMax] = useState(() => {
    const c = initialConfig.concurrency as { max?: number } | undefined
    return String(c?.max ?? WEBSITE_DEFAULTS.concurrencyMax)
  })
  const [delayMs, setDelayMs] = useState(() => String(initialConfig.delayMs ?? WEBSITE_DEFAULTS.delayMs))
  const [respectRobotsTxt, setRespectRobotsTxt] = useState(() =>
    typeof initialConfig.respectRobotsTxt === "boolean" ? initialConfig.respectRobotsTxt : true,
  )

  const typeOptions: SearchOption[] = adapterOptions.map((a) => ({ value: a.type, label: a.name }))
  const adapter = adapterOptions.find((a) => a.type === type)

  const submit = () => {
    setError("")
    let config: unknown = {}
    if (adapter?.id === "demo") {
      config = maxResults.trim() ? { maxResults: Number(maxResults) } : {}
    } else if (adapter?.id === "website") {
      const domainLines = lines(allowedDomains)
      config = {
        startUrls: lines(startUrls),
        ...(domainLines.length > 0 ? { allowedDomains: domainLines } : {}),
        maxPages: Number(maxPages) || WEBSITE_DEFAULTS.maxPages,
        maxDepth: Number(maxDepth) || WEBSITE_DEFAULTS.maxDepth,
        concurrency: {
          min: Number(concurrencyMin) || WEBSITE_DEFAULTS.concurrencyMin,
          max: Number(concurrencyMax) || WEBSITE_DEFAULTS.concurrencyMax,
        },
        delayMs: Number(delayMs) || 0,
        respectRobotsTxt,
      }
    }
    startTransition(async () => {
      const result = await action({
        name,
        type,
        description: description.trim() || undefined,
        isActive,
        config,
      })
      if (result.ok) {
        toast.success(submitLabel === "Create Source" ? "Source created." : "Source updated.")
        router.push("/scrapers/sources")
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <form
      className="max-w-2xl space-y-6"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium">Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="e.g. Example Corp Website" />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium">Source Type *</Label>
            <SearchableSelect options={typeOptions} value={type} onValueChange={setType} placeholder="Select a source type" />
            <p className="text-xs text-muted-foreground">
              {adapter?.id === "website"
                ? "Crawls public pages of a website. Only fetch, discovery and basic extraction — lead normalization comes later."
                : adapter?.id === "demo"
                  ? adapter?.description
                  : "This source type is not available yet. Sources appear here as adapters become available."}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium">Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} placeholder="What does this source provide?" />
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Configuration</h2>
        {adapter?.id === "demo" ? (
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium">Max results per run</Label>
            <Input
              type="number"
              min={1}
              max={50}
              value={maxResults}
              onChange={(e) => setMaxResults(e.target.value)}
              placeholder="12"
              className="w-40"
              inputMode="numeric"
            />
            <p className="text-xs text-muted-foreground">Number of deterministic sample records the demo source returns (1–50).</p>
          </div>
        ) : adapter?.id === "website" ? (
          <div className="space-y-4">
            <div className="grid gap-1.5">
              <Label className="text-xs font-medium">Start URLs *</Label>
              <Textarea
                value={startUrls}
                onChange={(e) => setStartUrls(e.target.value)}
                rows={3}
                placeholder={"https://example.com\nhttps://example.com/team"}
              />
              <p className="text-xs text-muted-foreground">One URL per line. The crawl starts here (http/https only).</p>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs font-medium">Allowed domains</Label>
              <Textarea
                value={allowedDomains}
                onChange={(e) => setAllowedDomains(e.target.value)}
                rows={2}
                placeholder={"example.com\napi.example.com"}
              />
              <p className="text-xs text-muted-foreground">
                Optional. If empty, only links on the start URLs&apos; hosts are crawled. Subdomains of an allowed domain are included.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="grid gap-1.5">
                <Label className="text-xs font-medium">Max pages</Label>
                <Input type="number" min={1} max={1000} value={maxPages} onChange={(e) => setMaxPages(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-medium">Max depth</Label>
                <Input type="number" min={0} max={5} value={maxDepth} onChange={(e) => setMaxDepth(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-medium">Rate delay (ms)</Label>
                <Input type="number" min={0} max={120000} value={delayMs} onChange={(e) => setDelayMs(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs font-medium">Concurrency</Label>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Input type="number" min={1} max={10} value={concurrencyMin} onChange={(e) => setConcurrencyMin(e.target.value)} className="w-16" />
                  –
                  <Input type="number" min={1} max={10} value={concurrencyMax} onChange={(e) => setConcurrencyMax(e.target.value)} className="w-16" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="respectRobotsTxt"
                checked={respectRobotsTxt}
                onChange={(e) => setRespectRobotsTxt(e.target.checked)}
                className="size-4 accent-primary"
              />
              <Label htmlFor="respectRobotsTxt" className="text-sm font-medium">
                Respect robots.txt
              </Label>
            </div>
            <details className="rounded-lg border bg-muted/30 p-3 text-sm">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Advanced settings</summary>
              <p className="mt-2 text-xs text-muted-foreground">
                Conservatve defaults apply when fields are empty or out of range: {WEBSITE_DEFAULTS.maxPages} pages, depth{" "}
                {WEBSITE_DEFAULTS.maxDepth}, concurrency {WEBSITE_DEFAULTS.concurrencyMin}–{WEBSITE_DEFAULTS.concurrencyMax}. Server-side
                hard limits cap pages at 1000, depth at 5, concurrency at 10.
              </p>
            </details>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">This source type is not available yet.</p>
        )}
      </section>

      <section className="flex items-center gap-2 rounded-xl border bg-card p-4">
        <input
          type="checkbox"
          id="isActive"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="size-4 accent-primary"
        />
        <Label htmlFor="isActive" className="text-sm font-medium">
          Active
        </Label>
      </section>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push("/scrapers/sources")}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  )
}