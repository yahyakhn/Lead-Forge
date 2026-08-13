import Link from "next/link"
import { requireSession } from "@/lib/auth"
import { PageHeader } from "@/components/crm/page-header"
import { EmptyState, ErrorState } from "@/components/crm/states"
import { Pagination } from "@/components/crm/pagination"
import { EnrichmentStatusBadge } from "@/components/crm/badges"
import { EnrichmentRequestActions } from "@/components/crm/lead-engine/enrichment-request-actions"
import { listRequests } from "@/lib/lead-engine/enrichment/service"
import { formatDateTime } from "@/lib/format"
import { EnrichmentRequestStatus } from "@/generated/prisma/enums"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SparklesIcon } from "lucide-react"

type SearchParams = Record<string, string | string[] | undefined>

export default async function EnrichmentQueuePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireSession()
  const sp = await searchParams
  let result
  try {
    result = await listRequests(session.organization.id, {
      page: typeof sp.page === "string" ? sp.page : undefined,
      pageSize: typeof sp.pageSize === "string" ? sp.pageSize : undefined,
      status: typeof sp.status === "string" ? sp.status : undefined,
    })
  } catch {
    return <ErrorState message="We couldn't load the enrichment queue." />
  }

  return (
    <div>
      <PageHeader title="Enrichment queue" description="Requests to enrich candidates and leads from public sources." />
      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Status
          <select name="status" defaultValue={typeof sp.status === "string" ? sp.status : ""} className="h-9 rounded-md border bg-background px-3 text-sm">
            <option value="">Any</option>
            {Object.values(EnrichmentRequestStatus).map((value) => (
              <option key={value} value={value}>
                {value[0] + value.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
          Filter
        </button>
      </form>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Target</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Fields</TableHead>
              <TableHead className="text-right">Updated</TableHead>
              <TableHead className="text-right">Conflicts</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <EmptyState
                    title="No enrichment requests yet"
                    description="Enrich candidates from the candidates page or a candidate detail page to start filling data gaps."
                    action={
                      <Link href="/lead-engine/candidates" className="text-sm font-medium underline-offset-4 hover:underline">
                        <SparklesIcon className="mr-1 inline size-4" /> Go to Candidates
                      </Link>
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              result.data.map((request) => {
                const name =
                  request.candidateId !== null
                    ? request.candidate?.companyName ?? request.candidate?.contactFullName ?? "Candidate"
                    : request.lead?.title ?? request.lead?.company?.name ?? "Lead"
                const href = request.candidateId !== null ? `/lead-engine/candidates/${request.candidateId}` : `/leads/${request.leadId}`
                return (
                  <TableRow key={request.id}>
                    <TableCell>
                      <Link href={href} className="font-medium underline-offset-4 hover:underline">
                        {name}
                      </Link>
                      <Link href={`/lead-engine/enrichment/${request.id}`} className="ml-2 text-xs text-muted-foreground underline-offset-4 hover:underline">
                        #{request.id.slice(-6)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{request.providerId}</TableCell>
                    <TableCell>
                      <EnrichmentStatusBadge status={request.status} errorCode={request.errorCode} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{request.fieldsFound}</TableCell>
                    <TableCell className="text-right tabular-nums">{request.fieldsUpdated}</TableCell>
                    <TableCell className="text-right tabular-nums">{request.conflictsCount}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(request.requestedAt)}</TableCell>
                    <TableCell className="text-right">
                      <EnrichmentRequestActions requestId={request.id} status={request.status} />
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4">
        <Pagination pathname="/lead-engine/enrichment" params={{ ...sp }} page={result.page} totalPages={result.totalPages} total={result.total} />
      </div>
    </div>
  )
}
