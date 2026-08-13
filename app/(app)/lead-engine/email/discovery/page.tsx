import Link from "next/link"
import { requireSession } from "@/lib/auth"
import { PageHeader } from "@/components/crm/page-header"
import { EmptyState, ErrorState } from "@/components/crm/states"
import { Pagination } from "@/components/crm/pagination"
import { EmailDiscoveryStatusBadge } from "@/components/crm/email-badges"
import { listDiscoveryJobs } from "@/lib/lead-engine/email/service"
import { formatDateTime } from "@/lib/format"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type SearchParams = Record<string, string | string[] | undefined>

export default async function EmailDiscoveryQueuePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireSession()
  const sp = await searchParams
  let result
  try {
    result = await listDiscoveryJobs(session.organization.id, {
      page: typeof sp.page === "string" ? sp.page : undefined,
      pageSize: typeof sp.pageSize === "string" ? sp.pageSize : undefined,
      status: typeof sp.status === "string" ? sp.status : undefined,
    })
  } catch {
    return <ErrorState message="We couldn't load the discovery queue." />
  }

  return (
    <div>
      <PageHeader title="Email discovery" description="Requests to find public business emails from existing evidence." />
      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Status
          <select name="status" defaultValue={typeof sp.status === "string" ? sp.status : ""} className="rounded-md border bg-background px-2 py-1.5 text-sm">
            <option value="">All</option>
            <option value="QUEUED">Queued</option>
            <option value="RUNNING">Running</option>
            <option value="COMPLETED">Completed</option>
            <option value="PARTIAL">Partial</option>
            <option value="FAILED">Failed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </label>
        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">Filter</button>
      </form>
      {result.data.length === 0 ? (
        <EmptyState
          title="No discovery jobs yet"
          description="Run Find public email on a lead or candidate to start discovering emails."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead / Company</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Emails found</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead>Errors</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <Link href={job.candidate ? `/lead-engine/candidates/${job.candidateId}` : `/leads/${job.leadId}`} className="font-medium hover:underline">
                      {job.candidate ? job.candidate.companyName : `${job.lead?.company?.name ?? ""} · ${job.lead?.title ?? ""}`}
                    </Link>
                  </TableCell>
                  <TableCell>{job.providerId}</TableCell>
                  <TableCell><EmailDiscoveryStatusBadge status={job.status} /></TableCell>
                  <TableCell>{job.emailsFound}</TableCell>
                  <TableCell>{job.startedAt ? formatDateTime(job.startedAt) : "—"}</TableCell>
                  <TableCell>{job.completedAt ? formatDateTime(job.completedAt) : "—"}</TableCell>
                  <TableCell className="max-w-56 truncate text-xs" title={job.errorMessage ?? undefined}>{job.errorMessage ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination pathname="/lead-engine/email/discovery" params={sp} page={result.page} totalPages={result.totalPages} total={result.total} />
        </>
      )}
    </div>
  )
}