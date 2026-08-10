"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { getRawPageAction } from "@/lib/actions"
import { EyeIcon } from "lucide-react"
import { useState } from "react"

export interface RawPagePreview {
  url: string
  statusCode: number | null
  errorCategory: string | null
  title: string | null
  contentType: string | null
  canonicalUrl: unknown
  language: unknown
  headings: unknown
  textPreview: string
  metadata: Record<string, unknown>
  fetchedAt: string
  hasHtml: boolean
  truncatedText: boolean
  pageTooLarge: boolean
}

const TEXT_PREVIEW_MAX = 3000

export function RawPageDialog({ pageId, url }: { pageId: string; url: string }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<RawPagePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const load = async () => {
    setLoading(true)
    setError("")
    const result = await getRawPageAction(pageId)
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setData(result.page)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next && !data) void load()
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="icon" className="size-8" aria-label={`View page ${url}`} />}>
        <EyeIcon className="size-4" />
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="break-all text-sm">{data?.title ?? url}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading page…</p>
        ) : error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : data ? (
          <div className="max-h-[65vh] space-y-3 overflow-auto pr-1">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">URL</dt>
                <dd className="break-all">
                  <a href={data.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    {data.url}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd className="font-mono">{data.statusCode ?? (data.errorCategory ?? "—")}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Content type</dt>
                <dd className="break-all">{data.contentType ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Canonical</dt>
                <dd className="break-all">{typeof data.canonicalUrl === "string" ? data.canonicalUrl : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Language</dt>
                <dd>{typeof data.language === "string" ? data.language : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Fetched</dt>
                <dd className="tabular-nums">{data.fetchedAt}</dd>
              </div>
            </dl>

            {Array.isArray(data.headings) && data.headings.length > 0 ? (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground">Headings</h4>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm">
                  {data.headings.map((heading, i) => (
                    <li key={i}>{heading}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div>
              <h4 className="text-xs font-medium text-muted-foreground">Text preview</h4>
              <pre className="mt-1 max-h-48 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap">
                {data.textPreview || "No visible text extracted."}
              </pre>
              {data.truncatedText ? (
                <p className="mt-1 text-xs text-muted-foreground">Text truncated at {TEXT_PREVIEW_MAX.toLocaleString()} characters in this view.</p>
              ) : null}
              {data.pageTooLarge ? <p className="mt-1 text-xs text-muted-foreground">Raw HTML exceeded the size limit and was truncated at storage time.</p> : null}
              {data.hasHtml ? null : <p className="mt-1 text-xs text-muted-foreground">Raw HTML is not shown; stored for this page though.</p>}
            </div>

            <details className="rounded-lg border bg-muted/30 p-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Metadata</summary>
              <pre className="mt-2 max-h-48 overflow-auto text-xs leading-relaxed">{JSON.stringify(data.metadata, null, 2)}</pre>
            </details>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}