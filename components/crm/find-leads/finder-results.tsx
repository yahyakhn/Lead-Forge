// TASK 020: Lead Finder results — run-scoped candidate table with selection,
// add-to-CRM (backend deduplicates), signals/classification/score columns.
// Filters are server-backed: the component pushes search params; the page
// re-renders the list. No AI classification is triggered from this screen.

"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Pagination } from "@/components/crm/pagination"
import { CandidateStatusBadge } from "@/components/crm/lead-engine/candidate-badges"
import { ScoreBadge } from "@/components/crm/badges"
import { bulkConvertAction } from "@/lib/actions"
import { candidateSignals } from "@/lib/lead-engine/finder"
import type { JobPosting } from "@/lib/lead-engine/extraction/types"
import type { ScraperRunStatus } from "@/generated/prisma/enums"
import { InboxIcon, SearchIcon } from "lucide-react"

export interface FinderCandidate {
  id: string
  companyName: string | null
  companyDomain: string | null
  contactFullName: string | null
  contactJobTitle: string | null
  location: string
  industry: string | null
  status: string
  jobs: JobPosting[]
  signals: string[]
  classification: { label: string; fitScore: number } | null
  score: { icpScore: number; overallScore: number; qualification: string } | null
}

interface Props {
  runId: string
  runStatus: ScraperRunStatus
  candidates: FinderCandidate[]
  total: number
  page: number
  totalPages: number
  q: string
  status: string
  qualification: string
  minScore: string
  sort: string
}

const STATUS_OPTIONS = ["READY", "PENDING", "EXTRACTED", "REVIEW", "CONVERTED", "SKIPPED", "DUPLICATE", "FAILED"]
const QUAL_OPTIONS = ["HOT", "GOOD", "MAYBE", "LOW", "UNQUALIFIED"]
const SORT_OPTIONS = [
  ["newest", "Newest first"],
  ["icpScore", "ICP score"],
  ["overallScore", "Overall score"],
] as const

export function FinderResults({
  runId,
  runStatus,
  candidates,
  total,
  page,
  totalPages,
  q,
  status,
  qualification,
  minScore,
  sort,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState(q)

  const push = (patch: Record<string, string>) => {
    const params = new URLSearchParams({ run: runId })
    const next = { q, status, qualification, minScore, sort, ...patch }
    if (next.q) params.set("q", next.q)
    if (next.status) params.set("status", next.status)
    if (next.qualification) params.set("qualification", next.qualification)
    if (next.minScore) params.set("minScore", next.minScore)
    if (next.sort !== "newest") params.set("sort", next.sort)
    if (page > 1) params.set("page", String(page))
    router.push(`/find-leads?${params.toString()}`)
  }

  useEffect(() => {
    const id = setTimeout(() => {
      if (query !== q) push({ q: query })
    }, 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, q])

  const running = runStatus === "QUEUED" || runStatus === "RUNNING"

  const selectAllVisible = candidates.length > 0 && candidates.every((c) => selected.has(c.id))
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (selectAllVisible) candidates.forEach((c) => next.delete(c.id))
      else candidates.forEach((c) => next.add(c.id))
      return next
    })

  const addToCrm = () =>
    startTransition(async () => {
      if (selected.size === 0) return
      const result = await bulkConvertAction([...selected])
      if (result.ok && result.summary) {
        const parts = [
          `${result.summary.converted} added to CRM`,
          result.summary.alreadyConverted > 0 && `${result.summary.alreadyConverted} already in CRM`,
          result.summary.needsReview > 0 && `${result.summary.needsReview} need review`,
        ].filter(Boolean)
        toast.success(parts.join(" · "))
        setSelected(new Set())
        router.refresh()
      } else {
        toast.error(result.error || "Could not add to CRM")
      }
    })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Candidates ({total})</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, domain, title…"
              className="w-56 pl-8"
            />
          </div>
          <select
            className="rounded-lg border bg-background px-2 py-1.5 text-sm"
            value={status}
            onChange={(e) => push({ status: e.target.value })}
          >
            <option value="">Any status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            className="rounded-lg border bg-background px-2 py-1.5 text-sm"
            value={qualification}
            onChange={(e) => push({ qualification: e.target.value })}
          >
            <option value="">Any qualification</option>
            {QUAL_OPTIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            className="rounded-lg border bg-background px-2 py-1.5 text-sm"
            value={minScore}
            onChange={(e) => push({ minScore: e.target.value })}
          >
            <option value="">Any score</option>
            <option value="70">Score ≥ 70</option>
            <option value="50">Score ≥ 50</option>
          </select>
          <select className="rounded-lg border bg-background px-2 py-1.5 text-sm" value={sort} onChange={(e) => push({ sort: e.target.value })}>
            {SORT_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {running && <p className="text-xs text-muted-foreground">Discovery is still running — results refresh automatically.</p>}

      {candidates.length === 0 ? (
        <div className="grid place-items-center rounded-xl border bg-card py-16 text-center">
          <InboxIcon className="mx-auto mb-3 size-8 text-muted-foreground" />
          <h3 className="text-base font-semibold">No candidates found</h3>
          <p className="mt-1 text-sm text-muted-foreground">Try different filters, or adjust the ICP and run discovery again.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input type="checkbox" aria-label="Select all" checked={selectAllVisible} onChange={toggleAll} />
                  </TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead>Signals</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((c) => {
                  const signals = c.signals.length > 0 ? c.signals : candidateSignals(c.jobs)
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.companyName ?? "candidate"}`}
                          checked={selected.has(c.id)}
                          onChange={() =>
                            setSelected((prev) => {
                              const next = new Set(prev)
                              if (next.has(c.id)) next.delete(c.id)
                              else next.add(c.id)
                              return next
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {c.companyName ?? "Unknown"}
                        {c.companyDomain && <span className="block text-xs text-muted-foreground">{c.companyDomain}</span>}
                      </TableCell>
                      <TableCell>
                        {c.contactFullName ?? "—"}
                        {c.contactJobTitle && <span className="block text-xs text-muted-foreground">{c.contactJobTitle}</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{c.location || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{c.industry || "—"}</TableCell>
                      <TableCell>{signals.length > 0 ? signals.join(" · ") : "—"}</TableCell>
                      <TableCell>
                        {c.score ? (
                          <div className="flex flex-col items-start gap-0.5">
                            <ScoreBadge score={c.score.overallScore} />
                            <span className="text-xs text-muted-foreground">
                              ICP {c.score.icpScore} · {c.score.qualification}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Unscored</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {c.classification ? (
                          <span className="text-xs text-muted-foreground">
                            {c.classification.label} ({c.classification.fitScore})
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Not classified</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <CandidateStatusBadge status={c.status as never} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {selected.size > 0 ? `${selected.size} selected across pages` : "Use checkboxes to add candidates to your CRM"}
            </p>
            <div className="flex items-center gap-2">
              {selected.size > 0 && (
                <Button size="sm" variant="outline" onClick={() => setSelected(new Set())} disabled={pending}>
                  Clear selection
                </Button>
              )}
              <Button size="sm" onClick={addToCrm} disabled={pending || selected.size === 0}>
                {pending ? "Adding…" : `Add selected to CRM (${selected.size})`}
              </Button>
            </div>
          </div>

          <Pagination
            pathname="/find-leads"
            params={{ run: runId, q, status, qualification, minScore, sort }}
            page={page}
            totalPages={totalPages}
            total={total}
          />
        </>
      )}
    </div>
  )
}