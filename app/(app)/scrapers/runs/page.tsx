import Link from "next/link"
import { requireSession } from "@/lib/auth"
import { listRuns, runDisplayName } from "@/lib/lead-engine/runs"
import { PageHeader } from "@/components/crm/page-header"
import { FilterSelect } from "@/components/crm/search-bar"
import { EmptyState, ErrorState } from "@/components/crm/states"
import { Pagination } from "@/components/crm/pagination"
import { RunStatusBadge, SourceTypeLabel } from "@/components/crm/scrapers/scraper-badges"
import { formatDateTime, formatDuration } from "@/lib/format"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ScraperRunStatus } from "@/generated/prisma/enums"

type SearchParams = Record<string, string | string[] | undefined>

const STATUS_OPTIONS = Object.values(ScraperRunStatus).map((s) => ({ value: s, label: s }))

export default async function ScraperRunsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireSession()
  const sp = await searchParams
  const first = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined)

  const status = Object.values(ScraperRunStatus).includes(first("status") as ScraperRunStatus)
    ? (first("status") as ScraperRunStatus)
    : undefined

  let result
  try {
    result = await listRuns(session.organization.id, {
      page: Number(first("page") ?? 1),
      pageSize: Number(first("pageSize") ?? 25),
      status,
    })
  } catch {
    return <ErrorState message="We couldn't load your scraper runs." />
  }

  return (
    <div>
      <PageHeader title="Scraper Runs" description={`${result.total.toLocaleString()} runs`} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterSelect param="status" placeholder="All statuses" options={STATUS_OPTIONS} className="h-8 w-44" />
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title={status ? `No ${status.toLowerCase()} runs` : "No scraper runs yet"}
          description={status ? "Try a different status." : "Run a source test from a source page to see runs here."}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>ICP</TableHead>
                <TableHead className="text-right">Started</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="text-right">Found</TableHead>
                <TableHead className="text-right">Processed</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="text-right">Duplicates</TableHead>
                <TableHead className="text-right">Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((run) => (
                <TableRow key={run.id} className="hover:bg-muted/50">
                  <TableCell>
                    <Link href={`/scrapers/runs/${run.id}`} className="font-medium hover:underline">
                      {runDisplayName(run, `${run.source.name} `)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <RunStatusBadge status={run.status} />
                  </TableCell>
                  <TableCell>
                    <Link href={`/scrapers/sources/${run.source.id}`} className="text-sm hover:underline">
                      {run.source.name}
                      <span className="ml-1 text-muted-foreground">
                        <SourceTypeLabel type={run.source.type} />
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>{run.icp ? <span className="text-sm">{run.icp.name}</span> : <span className="text-sm text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right whitespace-nowrap text-muted-foreground">{formatDateTime(run.startedAt)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap text-muted-foreground">{formatDuration(run.startedAt, run.finishedAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{run.recordsFound}</TableCell>
                  <TableCell className="text-right tabular-nums">{run.recordsProcessed}</TableCell>
                  <TableCell className="text-right tabular-nums">{run.recordsCreated}</TableCell>
                  <TableCell className="text-right tabular-nums">{run.recordsDuplicate}</TableCell>
                  <TableCell className="text-right tabular-nums text-destructive/70">{run.recordsFailed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-3">
        <Pagination pathname="/scrapers/runs" params={sp} page={result.page} totalPages={result.totalPages} total={result.total} />
      </div>
    </div>
  )
}