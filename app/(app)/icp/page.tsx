import Link from "next/link"
import { requireSession } from "@/lib/auth"
import { listICPs } from "@/lib/crm/icp"
import { ICPActions } from "@/components/crm/icp/icp-actions"
import { IcpActiveBadge } from "@/components/crm/icp/icp-badges"
import { joinValues } from "@/components/crm/icp/criteria-summary"
import { PageHeader } from "@/components/crm/page-header"
import { SearchInput } from "@/components/crm/search-bar"
import { EmptyState, ErrorState } from "@/components/crm/states"
import { Pagination } from "@/components/crm/pagination"
import { formatDate } from "@/lib/format"
import { PlusIcon } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type SearchParams = Record<string, string | string[] | undefined>

export default async function ICPPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireSession()
  const sp = await searchParams
  const first = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined)

  let result
  try {
    result = await listICPs(session.organization.id, {
      page: Number(first("page") ?? 1),
      pageSize: Number(first("pageSize") ?? 25),
      search: first("search"),
    })
  } catch {
    return <ErrorState message="We couldn't load your ICP profiles." />
  }

  return (
    <div>
      <PageHeader
        title="ICP Profiles"
        description={`${result.total.toLocaleString()} profiles`}
        actions={
          <Link href="/icp/new" className={cn(buttonVariants({}), "gap-1.5")}>
            <PlusIcon className="size-4" />
            New ICP
          </Link>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Search profiles..." />
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title={sp.search ? "No profiles match your search" : "No ICP profiles yet"}
          description={sp.search ? "Try a different search." : "Create your first ICP profile to describe your ideal customer."}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead className="max-w-md">Focus</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Updated</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((icp) => (
                <TableRow key={icp.id} className="hover:bg-muted/50">
                  <TableCell>
                    <Link href={`/icp/${icp.id}`} className="font-medium hover:underline">
                      {icp.name}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">
                    {joinValues(icp.criteria.industries) ?? joinValues(icp.criteria.countries) ?? "No criteria"}
                  </TableCell>
                  <TableCell>
                    <IcpActiveBadge active={icp.isActive} />
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                    {formatDate(icp.updatedAt)}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                    {formatDate(icp.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <ICPActions profileId={icp.id} name={icp.name} isActive={icp.isActive} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-3">
        <Pagination pathname="/icp" params={sp} page={result.page} totalPages={result.totalPages} total={result.total} />
      </div>
    </div>
  )
}