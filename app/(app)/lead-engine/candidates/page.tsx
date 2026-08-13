import Link from "next/link"
import { requireSession } from "@/lib/auth"
import { listCandidates } from "@/lib/lead-engine/extraction/service"
import { prisma } from "@/lib/db"
import { PageHeader } from "@/components/crm/page-header"
import { ErrorState, EmptyState } from "@/components/crm/states"
import { Pagination } from "@/components/crm/pagination"
import { CandidateStatusBadge, ExtractionMethodBadge } from "@/components/crm/lead-engine/candidate-badges"
import { ConvertSelectedBar } from "@/components/crm/lead-engine/convert-selected-bar"
import { ScoreSelectedBar } from "@/components/crm/lead-engine/score-selected-bar"
import { EnrichSelectedBar } from "@/components/crm/lead-engine/enrich-selected-bar"
import { isConvertibleStatus } from "@/lib/lead-engine/conversion/service"
import { formatDateTime } from "@/lib/format"
import { CandidateStatus, ExtractionMethod } from "@/generated/prisma/enums"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ScanSearchIcon } from "lucide-react"
import { ScoreBadge, EnrichmentStatusBadge } from "@/components/crm/badges"

type SearchParams = Record<string, string | string[] | undefined>

const selectOptions = (values: readonly string[]) => (
  <>
    <option value="">Any</option>
    {values.map((value) => (
      <option key={value} value={value}>
        {value}
      </option>
    ))}
  </>
)

const enumOptions = (enumObject: Record<string, string>) => selectOptions(Object.values(enumObject))
const qualificationOptions = selectOptions(["HOT", "GOOD", "MAYBE", "LOW", "UNQUALIFIED"])

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireSession()
  const sp = await searchParams
  const first = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined)

  let candidates
  try {
    candidates = await listCandidates(session.organization.id, {
      page: typeof sp.page === "string" ? sp.page : undefined,
      pageSize: typeof sp.pageSize === "string" ? sp.pageSize : undefined,
      method: first("method"),
      status: first("status"),
      sourceId: first("source"),
      runId: first("run"),
      hasEmail: first("hasEmail"),
      hasContact: first("hasContact"),
      hasPhone: first("hasPhone"),
      hasLinkedIn: first("hasLinkedIn"),
      companyDomain: first("domain"),
      minQuality: first("minQuality"),
      sort: first("sort"),
      q: first("q"),
      minIcpScore: first("minIcpScore"),
      minOverallScore: first("minOverallScore"),
      qualification: first("qualification"),
      enrichment: first("enrichment") as "NOT_ENRICHED" | "RECENTLY_ENRICHED" | "NEEDS_REFRESH" | "FAILED" | "ACTIVE" | "HAS_CONFLICTS" | undefined,
    })
  } catch {
    return <ErrorState message="We couldn't load lead candidates." />
  }

  const [sources, runs] = await Promise.all([
    prisma.leadSource.findMany({ where: { organizationId: session.organization.id }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.scraperRun.findMany({
      where: { organizationId: session.organization.id },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ])

  return (
    <div>
      <PageHeader title="Lead Candidates" description="Extracted from scraped pages — not yet verified CRM leads." />

      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Query
          <input name="q" defaultValue={first("q") ?? ""} placeholder="Company, contact, email…" className="h-9 w-56 rounded-md border bg-background px-3 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Method
          <select name="method" defaultValue={first("method") ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm">
            {enumOptions(ExtractionMethod)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Status
          <select name="status" defaultValue={first("status") ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm">
            {enumOptions(CandidateStatus)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Source
          <select name="source" defaultValue={first("source") ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm">
            <option value="">Any</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Run
          <select name="run" defaultValue={first("run") ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm">
            <option value="">Any</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                #{run.id.slice(-6)} · {formatDateTime(run.createdAt)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="hasEmail" value="1" defaultChecked={first("hasEmail") !== undefined} className="size-4" />
          Has email
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="hasContact" value="1" defaultChecked={first("hasContact") !== undefined} className="size-4" />
          Has contact
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="hasPhone" value="1" defaultChecked={first("hasPhone") !== undefined} className="size-4" />
          Has phone
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="hasLinkedIn" value="1" defaultChecked={first("hasLinkedIn") !== undefined} className="size-4" />
          Has LinkedIn
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Min quality
          <input type="number" name="minQuality" min={0} max={100} defaultValue={first("minQuality") ?? ""} placeholder="0-100" className="h-9 w-24 rounded-md border bg-background px-3 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Domain
          <input name="domain" defaultValue={first("domain") ?? ""} placeholder="acme.com" className="h-9 w-36 rounded-md border bg-background px-3 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Sort
          <select name="sort" defaultValue={first("sort") ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm">
            <option value="">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="quality">Quality</option>
            <option value="company">Company</option>
            <option value="confidence">Confidence</option>
            <option value="icpScore">ICP Score</option>
            <option value="overallScore">Overall Score</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Min ICP Score
          <input type="number" name="minIcpScore" min={0} max={100} defaultValue={first("minIcpScore") ?? ""} placeholder="0-100" className="h-9 w-24 rounded-md border bg-background px-3 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Min Overall Score
          <input type="number" name="minOverallScore" min={0} max={100} defaultValue={first("minOverallScore") ?? ""} placeholder="0-100" className="h-9 w-24 rounded-md border bg-background px-3 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Qualification
          <select name="qualification" defaultValue={first("qualification") ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm">
            {qualificationOptions}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Enrichment
          <select name="enrichment" defaultValue={first("enrichment") ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm">
            <option value="">Any</option>
            <option value="NOT_ENRICHED">Not enriched</option>
            <option value="RECENTLY_ENRICHED">Recently enriched</option>
            <option value="NEEDS_REFRESH">Needs refresh</option>
            <option value="FAILED">Failed</option>
            <option value="ACTIVE">In progress</option>
            <option value="HAS_CONFLICTS">Has conflicts</option>
          </select>
        </label>
        <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
          Filter
        </button>
      </form>

      <div className="mb-4 space-y-4">
        <ConvertSelectedBar
          candidates={candidates.data
            .filter((c) => isConvertibleStatus(c.status))
            .map((c) => ({
              id: c.id,
              label: c.companyName ?? c.contactFullName ?? c.id.slice(-6),
              eligible: true,
            }))}
        />
        <ScoreSelectedBar
          candidates={candidates.data.map((c) => ({
            id: c.id,
            label: c.companyName ?? c.contactFullName ?? c.id.slice(-6),
          }))}
        />
        <EnrichSelectedBar
          candidates={candidates.data.map((c) => ({
            id: c.id,
            label: c.companyName ?? c.contactFullName ?? c.id.slice(-6),
          }))}
        />
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Quality</TableHead>
              <TableHead className="text-right">ICP Score</TableHead>
              <TableHead className="text-right">Overall</TableHead>
              <TableHead>Qualification</TableHead>
              <TableHead>Enrichment</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12}>
                  <EmptyState
                    title="No candidates yet"
                    description="Run a scraper and then start extraction on the run page to generate lead candidates."
                    action={
                      <Link href="/scrapers" className="text-sm font-medium underline-offset-4 hover:underline">
                        <ScanSearchIcon className="mr-1 inline size-4" /> Go to Scrapers
                      </Link>
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              candidates.data.map((candidate) => {
                const score = candidate.scores?.[0]
                return (
                  <TableRow key={candidate.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell>
                      <Link href={`/lead-engine/candidates/${candidate.id}`} className="font-medium underline-offset-4 hover:underline">
                        {candidate.companyName ?? "—"}
                      </Link>
                      {candidate.pageClassification ? (
                        <span className="ml-2 text-xs text-muted-foreground">{candidate.pageClassification.toLowerCase()}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>{candidate.contactFullName ?? "—"}</TableCell>
                    <TableCell>{candidate.contactJobTitle ?? "—"}</TableCell>
                    <TableCell>{candidate.email ?? "—"}</TableCell>
                    <TableCell>{candidate.companyDomain ?? "—"}</TableCell>
                    <TableCell>
                      <ExtractionMethodBadge method={candidate.extractionMethod} />
                    </TableCell>
                    <TableCell>
                      {candidate.dataQualityScore !== null ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
                            candidate.dataQualityScore >= 70
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              : candidate.dataQualityScore >= 40
                                ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                : "bg-destructive/10 text-destructive"
                          }`}
                        >
                          {candidate.dataQualityScore}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {score ? <ScoreBadge score={score.icpScore} /> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {score ? <ScoreBadge score={score.overallScore} /> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {score ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            score.qualification === "HOT"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40"
                              : score.qualification === "GOOD"
                                ? "bg-green-100 text-green-800 dark:bg-green-900/40"
                                : score.qualification === "MAYBE"
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40"
                                  : score.qualification === "LOW"
                                    ? "bg-red-100 text-red-800 dark:bg-red-900/40"
                                    : "bg-slate-100 text-slate-800 dark:bg-slate-900/40"
                          }`}
                        >
                          {score.qualification}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not scored</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <EnrichmentStatusBadge status={candidate.enrichmentRequests?.[0]?.status ?? "—"} errorCode={candidate.enrichmentRequests?.[0]?.errorCode} />
                    </TableCell>
                    <TableCell>
                      <CandidateStatusBadge status={candidate.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(candidate.createdAt)}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4">
        <Pagination
          pathname="/lead-engine/candidates"
          params={{ ...sp }}
          page={candidates.page}
          totalPages={candidates.totalPages}
          total={candidates.total}
        />
      </div>
    </div>
  )
}