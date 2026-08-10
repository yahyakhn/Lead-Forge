import Link from "next/link"
import { notFound } from "next/navigation"
import { requireSession } from "@/lib/auth"
import { getSource } from "@/lib/lead-engine/sources"
import { listICPs } from "@/lib/crm/icp"
import { PageHeader } from "@/components/crm/page-header"
import { ErrorState } from "@/components/crm/states"
import { SourceTypeLabel, CapabilityChips } from "@/components/crm/scrapers/scraper-badges"
import { SourceActions } from "@/components/crm/scrapers/source-actions"
import { TestSourceButton } from "@/components/crm/scrapers/test-source-button"
import { formatDate } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export default async function SourceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const { id } = await params

  let source
  try {
    source = await getSource(session.organization.id, id)
  } catch {
    return <ErrorState message="We couldn't load this source." />
  }
  if (!source) notFound()

  const icpPage = await listICPs(session.organization.id, { pageSize: 100 })

  return (
    <div>
      <PageHeader
        title={source.name}
        description={`${source.type} source`}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={source.isActive ? "default" : "secondary"} className={source.isActive ? "" : "bg-muted text-muted-foreground"}>
              {source.isActive ? "Active" : "Inactive"}
            </Badge>
            <Link href={`/scrapers/sources/${source.id}/edit`} className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}>
              Edit
            </Link>
            <SourceActions sourceId={source.id} name={source.name} isActive={source.isActive} showLabels />
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="rounded-xl border bg-card p-5">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Source</h2>
            <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Type</dt>
                <dd className="mt-1">
                  <SourceTypeLabel type={source.type} />
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Capabilities</dt>
                <dd className="mt-1">
                  <CapabilityChips capabilities={source.capabilities} />
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Description</dt>
                <dd className="mt-1 text-sm">{source.description ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Slug</dt>
                <dd className="mt-1 text-sm font-mono">{source.slug}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Created</dt>
                <dd className="mt-1 text-sm">{formatDate(source.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Updated</dt>
                <dd className="mt-1 text-sm">{formatDate(source.updatedAt)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border bg-card p-5">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Configuration</h2>
            <pre className="mt-3 max-h-64 overflow-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed">
              {JSON.stringify(source.config, null, 2)}
            </pre>
          </section>

          {source.lastRun.length > 0 ? (
            <section className="rounded-xl border bg-card p-5">
              <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Last Run</h2>
              <Link href={`/scrapers/runs/${source.lastRun[0].id}`} className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
                View last run → ({formatDate(source.lastRun[0].createdAt)})
              </Link>
            </section>
          ) : null}
        </div>

        <aside className="h-fit space-y-4 rounded-xl border bg-card p-5 lg:sticky lg:top-20">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Test Source</h2>
          <p className="text-sm text-muted-foreground">
            Run a scraper now to test this source. Test runs are always small and bounded (3 pages max, depth 1). Optionally associate an ICP
            for attribution.
          </p>
          <TestSourceButton sourceId={source.id} icpOptions={icpPage.data.map((icp) => ({ value: icp.id, label: icp.name }))} />
        </aside>
      </div>
    </div>
  )
}