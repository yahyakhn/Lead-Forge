import Link from "next/link"
import { requireSession } from "@/lib/auth"
import { listContacts } from "@/lib/crm/contacts"
import { listCompanyOptions } from "@/lib/crm/options"
import { ContactForm, VERIFICATION_OPTIONS } from "@/components/crm/forms"
import { PageHeader } from "@/components/crm/page-header"
import { SearchInput, FilterSelect } from "@/components/crm/search-bar"
import { EmptyState, ErrorState } from "@/components/crm/states"
import { Pagination } from "@/components/crm/pagination"
import { VerificationBadge } from "@/components/crm/badges"
import { formatDate } from "@/lib/format"
import { createContactAction } from "@/lib/actions"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type SearchParams = Record<string, string | string[] | undefined>

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await requireSession()
  const sp = await searchParams
  const first = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined)

  let result
  let companies
  try {
    ;[result, companies] = await Promise.all([
      listContacts(session.organization.id, {
        page: Number(first("page") ?? 1),
        pageSize: Number(first("pageSize") ?? 25),
        search: first("search"),
        companyId: first("company"),
        verificationStatus: first("verification"),
      }),
      listCompanyOptions(session.organization.id),
    ])
  } catch {
    return <ErrorState message="We couldn't load your contacts." />
  }

  const companyOptions = companies.map((c) => ({ value: c.id, label: c.name, hint: c.domain ?? undefined }))

  return (
    <div>
      <PageHeader
        title="Contacts"
        description={`${result.total.toLocaleString()} contacts`}
        actions={<ContactForm action={createContactAction} companies={companyOptions} />}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Search contacts..." />
        <FilterSelect param="company" placeholder="Company" options={companyOptions} />
        <FilterSelect param="verification" placeholder="Verification" options={VERIFICATION_OPTIONS} />
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title={sp.search || sp.company || sp.verification ? "No contacts match your filters" : "No contacts yet"}
          description={
            sp.search || sp.company || sp.verification
              ? "Try adjusting your search or filters."
              : "Add a contact to a company to start building your network."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Job Title</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Verification</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((contact) => (
                <TableRow key={contact.id} className="hover:bg-muted/50">
                  <TableCell>
                    <Link href={`/contacts/${contact.id}`} className="font-medium hover:underline">
                      {contact.fullName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{contact.jobTitle ?? "—"}</TableCell>
                  <TableCell>
                    {contact.company ? (
                      <Link href={`/companies/${contact.company.id}`} className="hover:underline">
                        {contact.company.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{contact.email ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{contact.phone ?? "—"}</TableCell>
                  <TableCell>
                    <VerificationBadge status={contact.verificationStatus} />
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                    {formatDate(contact.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-3">
        <Pagination pathname="/contacts" params={sp} page={result.page} totalPages={result.totalPages} total={result.total} />
      </div>
    </div>
  )
}