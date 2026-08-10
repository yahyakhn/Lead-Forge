import Link from "next/link"
import { notFound } from "next/navigation"
import { requireSession } from "@/lib/auth"
import { getLeadList } from "@/lib/crm/lead-lists"
import { PageHeader } from "@/components/crm/page-header"
import { ErrorState, EmptyState } from "@/components/crm/states"
import { ConfirmDialog } from "@/components/crm/confirm-dialog"
import { RemoveFromList } from "@/components/crm/remove-from-list"
import { PriorityBadge, ScoreBadge, StatusBadge } from "@/components/crm/badges"
import { formatDate } from "@/lib/format"
import { deleteLeadListAction } from "@/lib/actions"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { ArrowLeftIcon, Trash2Icon } from "lucide-react"

export default async function LeadListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await requireSession()
  const { id } = await params

  let list
  try {
    list = await getLeadList(session.organization.id, id)
  } catch {
    return <ErrorState message="We couldn't load this list." />
  }
  if (!list) notFound()

  return (
    <div>
      <Link href="/lead-lists" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-3.5" /> Lead Lists
      </Link>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {list.name}
            <span className="text-sm font-normal text-muted-foreground">{list._count.memberships} leads</span>
          </span>
        }
        description={list.description ?? undefined}
        actions={
          <ConfirmDialog
            title="Delete lead list"
            description={`"${list.name}" will be deleted. Leads in the list are not deleted, only the membership.`}
            confirmLabel="Delete List"
            trigger={
              <Button variant="outline" aria-label="Delete list">
                <Trash2Icon /> Delete List
              </Button>
            }
            action={() => deleteLeadListAction(list.id)}
            redirectTo="/lead-lists"
          />
        }
      />

      {list.memberships.length === 0 ? (
        <EmptyState
          title="No leads in this list"
          description="Add leads to this list from a lead's detail page."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Company</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Added</TableHead>
                <TableHead className="text-right">Remove</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.memberships.map((membership) => {
                const lead = membership.lead
                return (
                  <TableRow key={membership.id} className="hover:bg-muted/50">
                    <TableCell>
                      <Link href={`/leads/${lead.id}`} className="block font-medium hover:underline">
                        {lead.company?.name ?? "—"}
                      </Link>
                      {lead.company?.domain ? (
                        <span className="block text-xs text-muted-foreground">{lead.company.domain}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>{lead.contact?.fullName ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <ScoreBadge score={lead.score} />
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority={lead.priority} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={lead.status} />
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                      {formatDate(membership.createdAt)}
                    </TableCell>
<TableCell className="text-right">
                        <RemoveFromList listId={list.id} leadId={lead.id} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
        </div>
      )}
    </div>
  )
}