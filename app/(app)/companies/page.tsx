import Link from "next/link"
import { requireSession } from "@/lib/auth"
import { listCompanies } from "@/lib/crm/companies"
import { CompanyForm, COMPANY_STATUS_OPTIONS } from "@/components/crm/forms"
import { PageHeader } from "@/components/crm/page-header"
import { SearchInput, FilterSelect } from "@/components/crm/search-bar"
import { EmptyState, ErrorState } from "@/components/crm/states"
import { Pagination } from "@/components/crm/pagination"
import { CompanyStatusBadge } from "@/components/crm/badges"
import { EntityAvatar } from "@/components/crm/entity-avatar"
import { formatDate } from "@/lib/format"
import { createCompanyAction } from "@/lib/actions"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type SearchParams = Record<string, string | string[] | undefined>

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await requireSession()
  const sp = await searchParams
  const first = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined)

  let result
  try {
    result = await listCompanies(session.organization.id, {
      page: Number(first("page") ?? 1),
      pageSize: Number(first("pageSize") ?? 25),
      search: first("search"),
      status: first("status"),
    })
  } catch {
    return <ErrorState message="We couldn't load your companies." />
  }

  return (
    <div>
      <PageHeader
        title="Companies"
        description={`${result.total.toLocaleString()} companies`}
        actions={<CompanyForm action={createCompanyAction} />}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Search companies..." />
        <FilterSelect param="status" placeholder="Status" options={COMPANY_STATUS_OPTIONS} />
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title={sp.search ? "No companies match your search" : "No companies yet"}
          description={sp.search ? "Try a different search." : "Add your first company to start building your database."}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Company</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Employees</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Contacts</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((company) => (
                <TableRow key={company.id} className="hover:bg-muted/50">
                  <TableCell>
                    <Link href={`/companies/${company.id}`} className="flex items-center gap-2 font-medium hover:underline">
                      <EntityAvatar name={company.name} />
                      <span className="max-w-48 truncate">{company.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{company.domain ?? "—"}</TableCell>
                  <TableCell>{company.industry ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {[company.city, company.state, company.country].filter(Boolean).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {company.employeeCount !== null ? company.employeeCount.toLocaleString() : company.employeeRange ?? "—"}
                  </TableCell>
                  <TableCell>
                    <CompanyStatusBadge status={company.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{company._count.contacts}</TableCell>
                  <TableCell className="text-right tabular-nums">{company._count.leads}</TableCell>
                  <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                    {formatDate(company.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-3">
        <Pagination pathname="/companies" params={sp} page={result.page} totalPages={result.totalPages} total={result.total} />
      </div>
    </div>
  )
}