// TASK 020: Lead Finder — server page. Two states:
//   - no ?run=    → setup form (existing ICP / describe-with-AI + source choice)
//   - ?run=       → live run: status card, run-scoped candidate results,
//                   filters/sort/pagination (server-backed), add-to-CRM.
// Everything is organization-scoped; the client never queries the database.

import Link from "next/link"
import { requireSession } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getRun, runDisplayName } from "@/lib/lead-engine/runs"
import { listCandidates } from "@/lib/lead-engine/extraction/service"
import { listICPs } from "@/lib/crm/icp"
import { listSources } from "@/lib/lead-engine/sources"
import { FINDER_PAGE_SIZE } from "@/lib/lead-engine/finder"
import { PageHeader } from "@/components/crm/page-header"
import { RunStatusBadge } from "@/components/crm/scrapers/scraper-badges"
import { RunStatusPoller } from "@/components/crm/scrapers/run-status-poller"
import { CancelRunButton } from "@/components/crm/scrapers/cancel-run-button"
import { RunExtractionButton } from "@/components/crm/lead-engine/run-extraction-button"
import { LeadFinderSetup } from "@/components/crm/find-leads/lead-finder-setup"
import { FinderResults, type FinderCandidate } from "@/components/crm/find-leads/finder-results"
import { ScraperRunStatus } from "@/generated/prisma/enums"
import { FolderIcon, UsersIcon } from "lucide-react"

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined)

export default async function FindLeadsPage({ searchParams }: PageProps) {
  const session = await requireSession()
  const orgId = session.organization.id
  const sp = await searchParams
  const runId = str(sp.run)

  if (!runId) {
    const [icps, sources] = await Promise.all([
      listICPs(orgId, { pageSize: 100 }),
      listSources(orgId, { pageSize: 100 }),
    ])
    const activeIcp = icps.data.find((icp) => icp.isActive) ?? null
    return (
      <div className="space-y-6">
        <PageHeader
          title="Find Leads"
          description="Describe your ideal customer, pick where to look, and start discovery."
        />
        <LeadFinderSetup
          icps={icps.data.map((icp) => ({ id: icp.id, name: icp.name, criteria: (icp.criteria ?? null) as never }))}
          sources={sources.data.filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.name }))}
          activeIcpId={activeIcp?.id ?? null}
        />
        <p className="text-sm text-muted-foreground">
          <Link href="/icp" className="underline underline-offset-4 hover:text-foreground">
            Manage ICPs
          </Link>
          {" · "}
          <Link href="/scrapers/sources" className="underline underline-offset-4 hover:text-foreground">
            Manage sources
          </Link>
        </p>
      </div>
    )
  }

  const run = await getRun(orgId, runId)
  if (!run) {
    return (
      <div className="space-y-6">
        <PageHeader title="Find Leads" description="Discovery run not found." />
        <p className="text-sm text-muted-foreground">
          <Link href="/find-leads" className="underline underline-offset-4 hover:text-foreground">
            Start a new search
          </Link>
        </p>
      </div>
    )
  }

  const page = Math.max(1, Number(str(sp.page)) || 1)
  const minScore = str(sp.minScore)
  const { data, total, totalPages } = await listCandidates(orgId, {
    runId,
    page: String(page),
    pageSize: String(FINDER_PAGE_SIZE),
    q: str(sp.q),
    status: str(sp.status),
    qualification: str(sp.qualification),
    minOverallScore: minScore,
    sort: str(sp.sort),
  })

  const ids = data.map((c) => c.id)
  const extras = ids.length
    ? await prisma.leadCandidate.findMany({
        where: { id: { in: ids }, organizationId: orgId },
        select: {
          id: true,
          jobs: true,
          convertedLeads: {
            select: {
              classifications: {
                orderBy: { updatedAt: "desc" },
                take: 1,
                select: { classification: true, fitScore: true },
              },
            },
          },
        },
      })
    : []

  const extrasById = new Map(extras.map((e) => [e.id, e]))
  const candidates: FinderCandidate[] = data.map((c) => {
    const extra = extrasById.get(c.id)
    const latestClassification = extra?.convertedLeads[0]?.classifications[0] ?? null
    return {
      id: c.id,
      companyName: c.companyName,
      companyDomain: c.companyDomain,
      contactFullName: c.contactFullName,
      contactJobTitle: c.contactJobTitle,
      location: [c.city, c.region, c.country].filter(Boolean).join(", "),
      industry: c.industry,
      status: c.status,
      jobs: c.jobs as never,
      signals: [],
      classification: latestClassification ? { label: latestClassification.classification, fitScore: latestClassification.fitScore } : null,
      score: c.scores[0]
        ? { icpScore: c.scores[0].icpScore, overallScore: c.scores[0].overallScore, qualification: c.scores[0].qualification }
        : null,
    }
  })

  const running = run.status === ScraperRunStatus.QUEUED || run.status === ScraperRunStatus.RUNNING
  const completed = run.status === ScraperRunStatus.COMPLETED
  const failed = run.status === ScraperRunStatus.FAILED

  return (
    <div className="space-y-6">
      <PageHeader
        title="Find Leads"
        description="Discovery run in progress — results appear here after extraction."
        actions={
          <div className="flex gap-2">
            {running && <CancelRunButton runId={run.id} />}
            {completed && total === 0 && <RunExtractionButton runId={run.id} running={false} />}
          </div>
        }
      />

      <section className="rounded-xl border bg-card p-4">
        <RunStatusPoller status={run.status} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <RunStatusBadge status={run.status} />
            <div className="text-sm">
              <p className="font-medium">
                {runDisplayName(run, "Discovery run")}
                <span className="ml-2 font-normal text-muted-foreground">from {run.source?.name ?? "unknown source"}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {run.icp ? `Targeting ${run.icp.name}` : "No ICP attached"} · {run._count.rawLeads.toLocaleString()} records found
              </p>
            </div>
          </div>
          {run.startedAt && (
            <p className="text-xs text-muted-foreground">
              Started {run.startedAt.toLocaleString()}
              {run.finishedAt ? ` · finished ${run.finishedAt.toLocaleString()}` : ""}
            </p>
          )}
        </div>

        {failed && (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {run.errorMessage || "Discovery failed — check the source configuration and try again."}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span>
            <strong className="text-foreground">{total.toLocaleString()}</strong> candidates
          </span>
          <span>
            <strong className="text-foreground">{run.recordsFound.toLocaleString()}</strong> records found
          </span>
          <span>
            <strong className="text-foreground">{run.pagesSucceeded.toLocaleString()}</strong> pages
          </span>
          {run.icp && <span>ICP: {run.icp.name}</span>}
          {run.source?.type && <span>Source type: {run.source.type}</span>}
        </div>
      </section>

      {completed && total === 0 && (
        <section className="rounded-xl border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Discovery found {run._count.rawLeads.toLocaleString()} records but no candidates yet. Run extraction to turn them into
            candidates.
          </p>
        </section>
      )}

      <FinderResults
        runId={run.id}
        runStatus={run.status}
        candidates={candidates}
        total={total}
        page={page}
        totalPages={totalPages}
        q={str(sp.q) ?? ""}
        status={str(sp.status) ?? ""}
        qualification={str(sp.qualification) ?? ""}
        minScore={minScore ?? ""}
        sort={str(sp.sort) ?? "newest"}
      />

      <p className="text-sm text-muted-foreground">
        <Link href="/lead-engine/candidates" className="inline-flex items-center gap-1.5 underline underline-offset-4 hover:text-foreground">
          <UsersIcon className="size-4" /> Manage all candidates
        </Link>
        {" · "}
        <Link href="/find-leads" className="inline-flex items-center gap-1.5 underline underline-offset-4 hover:text-foreground">
          <FolderIcon className="size-4" /> Start a new search
        </Link>
      </p>
    </div>
  )
}