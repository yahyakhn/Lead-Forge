import Link from "next/link"
import { notFound } from "next/navigation"
import { requireSession } from "@/lib/auth"
import { getRun, listRawLeads, listRunEvents, listRawPages } from "@/lib/lead-engine/runs"
import { PageHeader } from "@/components/crm/page-header"
import { ErrorState } from "@/components/crm/states"
import { Pagination } from "@/components/crm/pagination"
import { RunStatusBadge, EventLevelBadge } from "@/components/crm/scrapers/scraper-badges"
import { CancelRunButton } from "@/components/crm/scrapers/cancel-run-button"
import { RunStatusPoller } from "@/components/crm/scrapers/run-status-poller"
import { RawLeadDialog } from "@/components/crm/scrapers/raw-lead-dialog"
import { RawPageDialog } from "@/components/crm/scrapers/raw-page-dialog"
import { formatDateTime, formatDuration } from "@/lib/format"
import { ScraperRunEventLevel, ScraperRunStatus } from "@/generated/prisma/enums"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type SearchParams = Record<string, string | string[] | undefined>

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value.toLocaleString()}</dd>
    </div>
  )
}

export default async function RunDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const session = await requireSession()
  const { id } = await params
  const sp = await searchParams
  const first = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined)

  let run
  try {
    run = await getRun(session.organization.id, id)
  } catch {
    return <ErrorState message="We couldn't load this run." />
  }
  if (!run) notFound()

  const [rawPage, eventsPage, errorPage, pagesPage] = await Promise.all([
    listRawLeads(session.organization.id, run.id, {
      page: Number(first("page") ?? 1),
      pageSize: Number(first("pageSize") ?? 25),
    }),
    listRunEvents(session.organization.id, run.id, {
      page: Number(first("events") ?? 1),
      pageSize: Number(first("eventsSize") ?? 25),
    }),
    listRunEvents(session.organization.id, run.id, { level: ScraperRunEventLevel.ERROR, page: 1, pageSize: 10 }),
    listRawPages(session.organization.id, run.id, {
      page: Number(first("pages") ?? 1),
      pageSize: Number(first("pagesSize") ?? 25),
    }),
  ])

  const running = run.status === ScraperRunStatus.QUEUED || run.status === ScraperRunStatus.RUNNING
  const recentErrors = errorPage ? errorPage.data : []

  return (
    <div>
      <RunStatusPoller status={run.status} />
      <PageHeader
        title={`Run #${run.id.slice(-6)}`}
        description={`${run.source.name} · ${formatDateTime(run.createdAt)}`}
        actions={
          <div className="flex items-center gap-2">
            <RunStatusBadge status={run.status} />
            {running ? <CancelRunButton runId={run.id} /> : null}
          </div>
        }
      />

      {run.errorMessage ? (
        <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {run.errorMessage}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="rounded-xl border bg-card p-5">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Pages</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Discovered" value={run.pagesDiscovered} />
              <Stat label="Queued" value={run.pagesQueued} />
              <Stat label="Processed" value={run.pagesProcessed} />
              <Stat label="Succeeded" value={run.pagesSucceeded} />
              <Stat label="Failed" value={run.pagesFailed} />
              <Stat label="Skipped" value={run.pagesSkipped} />
            </dl>
          </section>

          <section className="rounded-xl border bg-card p-5">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Records</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Found" value={run.recordsFound} />
              <Stat label="Processed" value={run.recordsProcessed} />
              <Stat label="Created" value={run.recordsCreated} />
              <Stat label="Updated" value={run.recordsUpdated} />
              <Stat label="Duplicates" value={run.recordsDuplicate} />
              <Stat label="Failed" value={run.recordsFailed} />
            </dl>
          </section>

          {recentErrors.length > 0 ? (
            <section className="rounded-xl border border-destructive/30 bg-card p-5">
              <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Recent Errors</h2>
              <ul className="mt-3 space-y-1.5">
                {recentErrors.map((event) => {
                  const meta = (event.metadata ?? {}) as Record<string, unknown>
                  return (
                    <li key={event.id} className="flex items-start gap-3 text-sm">
                      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                        {formatDateTime(event.createdAt).slice(-5)}
                      </span>
                      <span className="w-24 shrink-0 font-mono text-xs text-destructive">
                        {typeof meta.category === "string" ? meta.category : "ERROR"}
                      </span>
                      <span className="break-all">{event.message}</span>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}

          <section className="rounded-xl border bg-card p-5">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Run Events</h2>
            {eventsPage && eventsPage.data.length > 0 ? (
              <>
                <ul className="mt-3 space-y-1.5">
                  {eventsPage.data.map((event) => (
                    <li key={event.id} className="flex items-center gap-3 text-sm">
                      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                        {formatDateTime(event.createdAt).slice(-5)}
                      </span>
                      <EventLevelBadge level={event.level} />
                      <span className="break-all">{event.message}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3">
                  <Pagination
                    pathname={`/scrapers/runs/${run.id}`}
                    params={{ ...sp, events: undefined }}
                    param="events"
                    page={eventsPage.page}
                    totalPages={eventsPage.totalPages}
                    total={eventsPage.total}
                  />
                  <span className="ml-2 text-xs text-muted-foreground">(events)</span>
                </div>
              </>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">No events recorded yet.</p>
            )}
          </section>
        </div>

        <aside className="space-y-3">
          <div className="h-fit rounded-xl border bg-card p-5">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Run</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Source</dt>
                <dd>
                  <Link href={`/scrapers/sources/${run.source.id}`} className="font-medium hover:underline">
                    {run.source.name}
                  </Link>
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">ICP</dt>
                <dd>{run.icp ? <Link href={`/icp/${run.icp.id}`} className="font-medium hover:underline">{run.icp.name}</Link> : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Started</dt>
                <dd className="tabular-nums">{formatDateTime(run.startedAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Finished</dt>
                <dd className="tabular-nums">{formatDateTime(run.finishedAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Duration</dt>
                <dd className="tabular-nums">{formatDuration(run.startedAt, run.finishedAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Test run</dt>
                <dd>{(run.metadata as { test?: boolean } | null)?.test ? "Yes" : "No"}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>

      <section className="mt-6 rounded-xl border bg-card p-5">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Pages ({(run._count.rawPages ?? 0).toLocaleString()})
        </h2>
        {pagesPage.data.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No pages stored for this run.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>URL</TableHead>
                  <TableHead className="w-20 text-right">Status</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Content Type</TableHead>
                  <TableHead className="text-right">Fetched</TableHead>
                  <TableHead className="w-16 text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagesPage.data.map((page) => (
                  <TableRow key={page.id} className="hover:bg-muted/50">
                    <TableCell className="max-w-72 truncate font-mono text-xs">{page.url}</TableCell>
                    <TableCell className="text-right">
                      <span className={`font-mono text-xs ${page.errorCategory ? "text-destructive" : ""}`}>
                        {page.statusCode ?? page.errorCategory ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-48 truncate">{page.title ?? "—"}</TableCell>
                    <TableCell className="max-w-32 truncate text-xs text-muted-foreground">{page.contentType ?? "—"}</TableCell>
                    <TableCell className="text-right whitespace-nowrap text-muted-foreground">{formatDateTime(page.fetchedAt)}</TableCell>
                    <TableCell className="text-right">
                      <RawPageDialog pageId={page.id} url={page.url} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="mt-3">
          <Pagination
            pathname={`/scrapers/runs/${run.id}`}
            params={{ ...sp, pages: undefined }}
            param="pages"
            page={pagesPage.page}
            totalPages={pagesPage.totalPages}
            total={pagesPage.total}
          />
          <span className="ml-2 text-xs text-muted-foreground">(pages)</span>
        </div>
      </section>

      <section className="mt-6 rounded-xl border bg-card p-5">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Raw Records ({run._count.rawLeads.toLocaleString()})
        </h2>
        {rawPage.data.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No raw records stored for this run.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>External ID</TableHead>
                  <TableHead>Source URL</TableHead>
                  <TableHead className="text-right">Discovered</TableHead>
                  <TableHead className="w-16 text-right">Inspect</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rawPage.data.map((lead) => (
                  <TableRow key={lead.id} className="hover:bg-muted/50">
                    <TableCell className="font-mono text-xs">{lead.externalId ?? "—"}</TableCell>
                    <TableCell>
                      {lead.sourceUrl ? (
                        <a href={lead.sourceUrl} target="_blank" rel="noreferrer" className="text-sm hover:underline">
                          {lead.sourceUrl}
                        </a>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap text-muted-foreground">{formatDateTime(lead.discoveredAt)}</TableCell>
                    <TableCell className="text-right">
                      <RawLeadDialog externalId={lead.externalId} rawData={lead.rawData as Record<string, unknown>} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="mt-3">
          <Pagination pathname={`/scrapers/runs/${run.id}`} params={sp} page={rawPage.page} totalPages={rawPage.totalPages} total={rawPage.total} />
        </div>
      </section>
    </div>
  )
}