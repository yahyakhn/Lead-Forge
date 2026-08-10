import Link from "next/link"
import { requireSession } from "@/lib/auth"
import { listLeads } from "@/lib/crm/leads"
import { listUsers, listCompanyOptions, listContactOptions } from "@/lib/crm/options"
import { LeadForm, LEAD_PRIORITY_OPTIONS, LEAD_STATUS_OPTIONS } from "@/components/crm/forms"
import { PageHeader } from "@/components/crm/page-header"
import { SearchInput, FilterSelect } from "@/components/crm/search-bar"
import { EmptyState, ErrorState } from "@/components/crm/states"
import { Pagination } from "@/components/crm/pagination"
import { PriorityBadge, ScoreBadge, StatusBadge } from "@/components/crm/badges"
import { formatDate } from "@/lib/format"
import { createLeadAction } from "@/lib/actions"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type SearchParams = Record<string, string | string[] | undefined>

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await requireSession()
  const sp = await searchParams
  const first = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined)
  const minScore = first("minScore")

  let result
  let users
  let companies
  let contacts
  try {
    ;[result, users, companies, contacts] = await Promise.all([
      listLeads(session.organization.id, {
        page: Number(first("page") ?? 1),
        pageSize: Number(first("pageSize") ?? 25),
        search: first("search"),
        status: first("status"),
        priority: first("priority"),
        ownerId: first("owner"),
        minScore: minScore ? Number(minScore) : undefined,
        maxScore: undefined,
      }),
      listUsers(session.organization.id),
      listCompanyOptions(session.organization.id),
      listContactOptions(session.organization.id),
    ])
  } catch {
    return <ErrorState message="We couldn't load your leads." />
  }

  const ownerOptions = users.map((u) => ({ value: u.id, label: u.name, hint: u.email }))

  return (
    <div>
      <PageHeader
        title="Leads"
        description={`${result.total.toLocaleString()} leads`}
        actions={
          <LeadForm
            action={createLeadAction}
            companies={companies.map((c) => ({ value: c.id, label: c.name, hint: c.domain ?? undefined }))}
            contacts={contacts.map((c) => ({ value: c.id, label: c.fullName, hint: c.email ?? undefined }))}
            owners={ownerOptions}
          />
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Search company or contact..." />
        <FilterSelect param="status" placeholder="Status" options={LEAD_STATUS_OPTIONS} />
        <FilterSelect param="priority" placeholder="Priority" options={LEAD_PRIORITY_OPTIONS} />
        <FilterSelect param="owner" placeholder="Owner" options={ownerOptions} />
        <FilterSelect
          param="minScore"
          placeholder="Min score"
          options={[
            { value: "90", label: "90+" },
            { value: "75", label: "75+" },
            { value: "60", label: "60+" },
            { value: "40", label: "40+" },
          ]}
        />
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title={sp.search || sp.status || sp.priority || sp.owner || minScore ? "No leads match your filters" : "No leads yet"}
          description={
            sp.search || sp.status || sp.priority || sp.owner || minScore
              ? "Try adjusting your search or filters."
              : "Once you start importing or discovering prospects, they will appear here."
          }
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
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((lead) => (
                <TableRow key={lead.id} className="hover:bg-muted/50">
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
                  <TableCell>{lead.owner?.name ?? "—"}</TableCell>
                  <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                    {formatDate(lead.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-3">
        <Pagination pathname="/leads" params={sp} page={result.page} totalPages={result.totalPages} total={result.total} />
      </div>
    </div>
  )
}