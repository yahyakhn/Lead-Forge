import Link from "next/link"
import { requireSession } from "@/lib/auth"
import { listLeadLists } from "@/lib/crm/lead-lists"
import { LeadListForm } from "@/components/crm/forms"
import { PageHeader } from "@/components/crm/page-header"
import { SearchInput } from "@/components/crm/search-bar"
import { EmptyState, ErrorState } from "@/components/crm/states"
import { Pagination } from "@/components/crm/pagination"
import { formatDate } from "@/lib/format"
import { createLeadListAction } from "@/lib/actions"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type SearchParams = Record<string, string | string[] | undefined>

export default async function LeadListsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await requireSession()
  const sp = await searchParams
  const first = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined)

  let result
  try {
    result = await listLeadLists(session.organization.id, {
      page: Number(first("page") ?? 1),
      pageSize: Number(first("pageSize") ?? 25),
      search: first("search"),
    })
  } catch {
    return <ErrorState message="We couldn't load your lead lists." />
  }

  return (
    <div>
      <PageHeader
        title="Lead Lists"
        description={`${result.total.toLocaleString()} lists`}
        actions={<LeadListForm action={createLeadListAction} />}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Search lists..." />
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title={sp.search ? "No lists match your search" : "No lead lists yet"}
          description={sp.search ? "Try a different search." : "Group leads into lists for campaigns or segments."}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Lead List</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((list) => (
                <TableRow key={list.id} className="hover:bg-muted/50">
                  <TableCell>
                    <Link href={`/lead-lists/${list.id}`} className="font-medium hover:underline">
                      {list.name}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">{list.description ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{list._count.memberships}</TableCell>
                  <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                    {formatDate(list.createdAt)}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                    {formatDate(list.updatedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-3">
        <Pagination pathname="/lead-lists" params={sp} page={result.page} totalPages={result.totalPages} total={result.total} />
      </div>
    </div>
  )
}