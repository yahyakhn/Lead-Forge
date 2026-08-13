import { requireSession } from "@/lib/auth"
import { PageHeader } from "@/components/crm/page-header"
import { EmptyState, ErrorState } from "@/components/crm/states"
import { Pagination } from "@/components/crm/pagination"
import { EmailVerificationStatusBadge } from "@/components/crm/email-badges"
import { listVerificationJobs } from "@/lib/lead-engine/email/service"
import { formatDateTime } from "@/lib/format"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type SearchParams = Record<string, string | string[] | undefined>

export default async function EmailVerificationQueuePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireSession()
  const sp = await searchParams
  let result
  try {
    result = await listVerificationJobs(session.organization.id, {
      page: typeof sp.page === "string" ? sp.page : undefined,
      pageSize: typeof sp.pageSize === "string" ? sp.pageSize : undefined,
      status: typeof sp.status === "string" ? sp.status : undefined,
    })
  } catch {
    return <ErrorState message="We couldn't load the verification queue." />
  }

  return (
    <div>
      <PageHeader title="Email verification" description="Syntax, domain and mail-server checks. No email is ever sent." />
      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Status
          <select name="status" defaultValue={typeof sp.status === "string" ? sp.status : ""} className="rounded-md border bg-background px-2 py-1.5 text-sm">
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="RUNNING">Running</option>
            <option value="COMPLETED">Completed</option>
            <option value="FAILED">Failed</option>
          </select>
        </label>
        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">Filter</button>
      </form>
      {result.data.length === 0 ? (
        <EmptyState
          title="No verification jobs yet"
          description="Click Verify on a discovered email to run a verification check."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Lead / Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Checked</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">{job.email.email}</TableCell>
                  <TableCell>
                    {job.email.lead
                      ? `${job.email.lead.company?.name ?? ""} · ${job.email.lead.title}`
                      : job.email.candidate?.companyName ?? "—"}
                  </TableCell>
                  <TableCell><EmailVerificationStatusBadge status={job.status} /></TableCell>
                  <TableCell>{job.providerId}</TableCell>
                  <TableCell>{job.checkedAt ? formatDateTime(job.checkedAt) : "—"}</TableCell>
                  <TableCell className="max-w-56 truncate text-xs" title={job.errorMessage ?? undefined}>{job.errorMessage ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination pathname="/lead-engine/email/verification" params={sp} page={result.page} totalPages={result.totalPages} total={result.total} />
        </>
      )}
    </div>
  )
}