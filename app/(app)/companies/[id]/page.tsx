import Link from "next/link"
import { notFound } from "next/navigation"
import { requireSession } from "@/lib/auth"
import { getCompany } from "@/lib/crm/companies"
import { listContacts } from "@/lib/crm/contacts"
import { listLeads } from "@/lib/crm/leads"
import { listDeals } from "@/lib/crm/deals"
import { listActivities } from "@/lib/crm/activities"
import { listCompanyOptions } from "@/lib/crm/options"
import { CompanyEditForm, ContactForm, ActivityForm } from "@/components/crm/forms"
import { PageHeader } from "@/components/crm/page-header"
import { ErrorState } from "@/components/crm/states"
import { ActivityTimeline } from "@/components/crm/activity-timeline"
import { CompanyStatusBadge, PriorityBadge, ScoreBadge, StatusBadge } from "@/components/crm/badges"
import { AccountResearchCard } from "@/components/crm/research/account-research-card"
import { getAccountResearch } from "@/lib/lead-engine/research/service"
import { formatDate, formatMoney } from "@/lib/format"
import { updateCompanyAction, createContactAction, createActivityAction } from "@/lib/actions"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeftIcon, GlobeIcon } from "lucide-react"

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await requireSession()
  const { id } = await params

  let data
  try {
    const [company, contacts, leads, deals, activities, companies, accountResearch] = await Promise.all([
      getCompany(session.organization.id, id),
      listContacts(session.organization.id, { companyId: id, pageSize: 50 }),
      listLeads(session.organization.id, { companyId: id, pageSize: 50 }),
      listDeals(session.organization.id, { companyId: id, pageSize: 50 }),
      listActivities(session.organization.id, { companyId: id, pageSize: 50 }),
      listCompanyOptions(session.organization.id),
      getAccountResearch(session.organization.id, id),
    ])
    data = { company, contacts, leads, deals, activities, companies, accountResearch }
  } catch {
    return <ErrorState message="We couldn't load this company." />
  }

  const { company, contacts, leads, deals, activities, companies, accountResearch } = data
  if (!company) notFound()

  return (
    <div>
      <Link href="/companies" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-3.5" /> Companies
      </Link>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {company.name}
            <CompanyStatusBadge status={company.status} />
          </span>
        }
        description={company.description ?? undefined}
        actions={
          <>
            <ContactForm
              action={createContactAction}
              companies={companies.map((c) => ({ value: c.id, label: c.name, hint: c.domain ?? undefined }))}
              defaultCompanyId={company.id}
            />
            <ActivityForm action={createActivityAction} companyId={company.id} />
            <CompanyEditForm action={updateCompanyAction.bind(null, company.id)} company={company} />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="rounded-xl border bg-card p-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Detail label="Domain" value={company.domain ?? "—"} />
              <Detail label="Source" value={company.source ?? "—"} />
              <Detail label="Website" value={company.website ?? "—"} link={company.website ?? undefined} />
              <Detail label="Industry" value={company.industry ?? "—"} />
              <Detail
                label="Employees"
                value={
                  company.employeeCount !== null
                    ? company.employeeCount.toLocaleString()
                    : company.employeeRange ?? "—"
                }
              />
              <Detail
                label="Location"
                value={[company.city, company.state, company.country].filter(Boolean).join(", ") || "—"}
              />
              <Detail label="Phone" value={company.phone ?? "—"} />
              <Detail label="LinkedIn" value={company.linkedinUrl ?? "—"} link={company.linkedinUrl ?? undefined} />
              <Detail label="Created" value={formatDate(company.createdAt)} />
              <Detail label="Last verified" value={formatDate(company.lastVerifiedAt)} />
            </dl>
          </section>

          <section className="rounded-xl border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">
              Contacts <span className="text-muted-foreground">({contacts.total})</span>
            </h2>
            {contacts.data.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No contacts yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.data.map((c) => (
                    <TableRow key={c.id} className="hover:bg-muted/50">
                      <TableCell>
                        <Link href={`/contacts/${c.id}`} className="font-medium hover:underline">
                          {c.fullName}
                        </Link>
                      </TableCell>
                      <TableCell>{c.jobTitle ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{c.email ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{c.phone ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          <section className="rounded-xl border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">
              Leads <span className="text-muted-foreground">({leads.total})</span>
            </h2>
            {leads.data.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No leads for this company.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Contact</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.data.map((lead) => (
                    <TableRow key={lead.id} className="hover:bg-muted/50">
                      <TableCell>
                        <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
                          {lead.contact?.fullName ?? "—"}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">
                        <ScoreBadge score={lead.score} />
                      </TableCell>
                      <TableCell>
                        <PriorityBadge priority={lead.priority} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={lead.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          <section className="rounded-xl border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">
              Deals <span className="text-muted-foreground">({deals.total})</span>
            </h2>
            {deals.data.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No deals.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Deal</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Expected close</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deals.data.map((deal) => (
                    <TableRow key={deal.id} className="hover:bg-muted/50">
                      <TableCell className="font-medium">{deal.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(deal.value.toNumber())}</TableCell>
                      <TableCell>{deal.stage.name}</TableCell>
                      <TableCell className="text-right">{formatDate(deal.expectedCloseDate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </div>

        <section className="rounded-xl border bg-card p-4 lg:self-start">
          <h2 className="mb-3 text-sm font-semibold">Activity</h2>
          {activities.data.length > 0 ? (
            <ActivityTimeline activities={activities.data} />
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">No activity yet.</p>
          )}
        </section>

        <AccountResearchCard companyId={company.id} existing={accountResearch} />
      </div>
    </div>
  )
}

function Detail({ label, value, link }: { label: string; value: string; link?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1 text-sm font-medium">
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
          >
            <GlobeIcon className="size-3 text-muted-foreground" />
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}