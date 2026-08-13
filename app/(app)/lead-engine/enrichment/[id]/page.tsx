import Link from "next/link"
import { notFound } from "next/navigation"
import { requireSession } from "@/lib/auth"
import { PageHeader } from "@/components/crm/page-header"
import { EnrichmentStatusBadge, ConflictStatusBadge } from "@/components/crm/badges"
import { EnrichmentRequestActions } from "@/components/crm/lead-engine/enrichment-request-actions"
import { ResolveConflictButtons } from "@/components/crm/lead-engine/resolve-conflict-buttons"
import { getRequest } from "@/lib/lead-engine/enrichment/service"
import { FIELD_LABELS } from "@/lib/lead-engine/enrichment/fields"
import { formatDateTime } from "@/lib/format"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{value}</dd>
    </div>
  )
}

const RESULT_STATUS_STYLE: Record<string, string> = {
  NEW: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  CONFIRMED: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  CONFLICT: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  REJECTED: "bg-destructive/10 text-destructive",
}

export default async function EnrichmentRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const { id } = await params
  const request = await getRequest(session.organization.id, id)
  if (!request) notFound()

  const name = request.candidateId !== null ? request.candidate?.companyName ?? request.candidate?.contactFullName ?? "Candidate" : request.lead?.title ?? request.lead?.company?.name ?? "Lead"
  const entityHref = request.candidateId !== null ? `/lead-engine/candidates/${request.candidateId}` : `/leads/${request.leadId}`

  return (
    <div>
      <PageHeader
        title={`Enrichment #${request.id.slice(-6)}`}
        description={
          <>
            for <Link href={entityHref} className="underline-offset-4 hover:underline">{name}</Link> · {formatDateTime(request.requestedAt)}
          </>
        }
      />

      <div className="mb-4 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 md:grid-cols-3">
            <Field label="Status" value={<EnrichmentStatusBadge status={request.status} errorCode={request.errorCode} />} />
            <Field label="Provider" value={request.providerId} />
            <Field label="Requested by" value={request.requestedBy?.name ?? "System"} />
            <Field label="Pages visited" value={request.pagesVisited} />
            <Field label="Fields found" value={request.fieldsFound} />
            <Field label="Fields updated" value={request.fieldsUpdated} />
            <Field label="Conflicts" value={request.conflictsCount} />
            <Field label="Force refresh" value={request.forceRefresh ? "Yes" : "No"} />
            <Field label="Retries" value={request.retries} />
          </dl>
          <div className="flex items-center gap-2">
            <EnrichmentRequestActions requestId={request.id} status={request.status} />
          </div>
        </div>
        {request.errorMessage ? (
          <p className="mt-3 rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {request.errorCode ? `${request.errorCode}: ` : ""}
            {request.errorMessage}
          </p>
        ) : null}
        {request.startedAt ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Started {formatDateTime(request.startedAt)}
            {request.completedAt ? ` · finished ${formatDateTime(request.completedAt)}` : ""}
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border bg-card p-5">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Extracted fields</h2>
        {request.results.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No fields extracted.</p>
        ) : (
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Confidence</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Observed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {request.results.map((result) => (
                <TableRow key={result.id}>
                  <TableCell className="font-mono text-xs">{FIELD_LABELS[result.field as keyof typeof FIELD_LABELS] ?? result.field}</TableCell>
                  <TableCell className="break-all">{result.value}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {result.source}
                    {result.sourceUrl ? (
                      <a href={result.sourceUrl} target="_blank" rel="noreferrer" className="ml-1 text-primary underline-offset-4 hover:underline">
                        source
                      </a>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{Math.round(result.confidence * 100)}%</TableCell>
                  <TableCell>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${RESULT_STATUS_STYLE[result.status] ?? "bg-muted text-muted-foreground"}`}>
                      {result.status === "NEW" ? "New" : result.status[0] + result.status.slice(1).toLowerCase()}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(result.observedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="mt-4 rounded-xl border bg-card p-5">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Conflicts</h2>
        {request.conflicts.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No conflicts recorded.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {request.conflicts.map((conflict) => (
              <li key={conflict.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs">{FIELD_LABELS[conflict.field as keyof typeof FIELD_LABELS] ?? conflict.field}</span>
                  <ConflictStatusBadge status={conflict.status} />
                </div>
                <div className="mt-1.5 grid gap-1 text-xs">
                  <p className="text-muted-foreground">
                    Existing <span className="text-foreground">{conflict.existingValue}</span> · {conflict.existingSource}
                  </p>
                  <p className="text-muted-foreground">
                    Enriched <span className="text-foreground">{conflict.enrichedValue}</span> · {conflict.enrichedSource} · {Math.round(conflict.confidence * 100)}% conf.
                  </p>
                </div>
                {conflict.status === "OPEN" ? (
                  <div className="mt-2">
                    <ResolveConflictButtons conflictId={conflict.id} />
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {conflict.resolution?.replaceAll("_", " ").toLowerCase()}
                    {conflict.resolvedAt ? ` · ${formatDateTime(conflict.resolvedAt)}` : ""}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
