import Link from "next/link"
import { requireSession } from "@/lib/auth"
import { listSources } from "@/lib/lead-engine/sources"
import { listSourceAdapters } from "@/lib/lead-engine/registry"
import { PageHeader } from "@/components/crm/page-header"
import { SearchInput } from "@/components/crm/search-bar"
import { EmptyState, ErrorState } from "@/components/crm/states"
import { Pagination } from "@/components/crm/pagination"
import { RunStatusBadge, SourceTypeLabel, CapabilityChips } from "@/components/crm/scrapers/scraper-badges"
import { SourceActions } from "@/components/crm/scrapers/source-actions"
import { formatDate } from "@/lib/format"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PlusIcon } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

type SearchParams = Record<string, string | string[] | undefined>

export default async function SourcesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireSession()
  const sp = await searchParams
  const first = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined)

  let result
  try {
    result = await listSources(session.organization.id, {
      page: Number(first("page") ?? 1),
      pageSize: Number(first("pageSize") ?? 25),
      search: first("search"),
    })
  } catch {
    return <ErrorState message="We couldn't load your lead sources." />
  }

  const adapters = listSourceAdapters()

  return (
    <div>
      <PageHeader
        title="Lead Sources"
        description={`${result.total.toLocaleString()} sources · ${adapters.length} adapter installed`}
        actions={
          <Link href="/scrapers/sources/new" className={cn(buttonVariants({}), "gap-1.5")}>
            <PlusIcon className="size-4" />
            Add Source
          </Link>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Search sources..." />
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title={sp.search ? "No sources match your search" : "No lead sources yet"}
          description={sp.search ? "Try a different search." : "Add a source to start collecting raw lead data."}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="w-16 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((source) => (
                <TableRow key={source.id} className="hover:bg-muted/50">
                  <TableCell>
                    <Link href={`/scrapers/sources/${source.id}`} className="font-medium hover:underline">
                      {source.name}
                    </Link>
                    {!source.isActive ? <span className="ml-2 text-xs text-muted-foreground">(inactive)</span> : null}
                  </TableCell>
                  <TableCell>
                    <SourceTypeLabel type={source.type} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={source.isActive ? "default" : "secondary"} className={source.isActive ? "" : "bg-muted text-muted-foreground"}>
                      {source.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <CapabilityChips capabilities={source.capabilities} />
                  </TableCell>
                  <TableCell>
                    {source.lastRun.length > 0 ? (
                      <Link href={`/scrapers/runs/${source.lastRun[0].id}`} className="inline-flex items-center gap-2 hover:underline">
                        <RunStatusBadge status={source.lastRun[0].status} />
                        <span className="text-xs text-muted-foreground">{formatDate(source.lastRun[0].createdAt)}</span>
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">Never</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap text-muted-foreground">{formatDate(source.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <SourceActions sourceId={source.id} name={source.name} isActive={source.isActive} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-3">
        <Pagination pathname="/scrapers/sources" params={sp} page={result.page} totalPages={result.totalPages} total={result.total} />
      </div>
    </div>
  )
}