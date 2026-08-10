import Link from "next/link"
import { notFound } from "next/navigation"
import { requireSession } from "@/lib/auth"
import { getContact } from "@/lib/crm/contacts"
import { listLeads } from "@/lib/crm/leads"
import { listActivities } from "@/lib/crm/activities"
import { listCompanyOptions, listUsers } from "@/lib/crm/options"
import { ContactEditForm, LeadForm, ActivityForm } from "@/components/crm/forms"
import { PageHeader } from "@/components/crm/page-header"
import { ErrorState } from "@/components/crm/states"
import { ActivityTimeline } from "@/components/crm/activity-timeline"
import { VerificationBadge, PriorityBadge, ScoreBadge, StatusBadge } from "@/components/crm/badges"
import { formatDate } from "@/lib/format"
import { updateContactAction, createLeadAction, createActivityAction } from "@/lib/actions"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeftIcon } from "lucide-react"

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await requireSession()
  const { id } = await params

  let data
  try {
    const [contact, leads, activities, companies, users] = await Promise.all([
      getContact(session.organization.id, id),
      listLeads(session.organization.id, { contactId: id, pageSize: 50 }),
      listActivities(session.organization.id, { contactId: id, pageSize: 50 }),
      listCompanyOptions(session.organization.id),
      listUsers(session.organization.id),
    ])
    data = { contact, leads, activities, companies, users }
  } catch {
    return <ErrorState message="We couldn't load this contact." />
  }

  const { contact, leads, activities, companies, users } = data
  if (!contact) notFound()

  const companyOptions = companies.map((c) => ({ value: c.id, label: c.name, hint: c.domain ?? undefined }))
  const ownerOptions = users.map((u) => ({ value: u.id, label: u.name, hint: u.email }))

  return (
    <div>
      <Link href="/contacts" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-3.5" /> Contacts
      </Link>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {contact.fullName}
            <VerificationBadge status={contact.verificationStatus} />
          </span>
        }
        description={[contact.jobTitle, contact.department].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <LeadForm
              action={createLeadAction}
              companies={companyOptions}
              contacts={[{ value: contact.id, label: contact.fullName, hint: contact.email ?? undefined }]}
              owners={ownerOptions}
              defaultCompanyId={contact.companyId ?? undefined}
            />
            <ActivityForm action={createActivityAction} contactId={contact.id} />
            <ContactEditForm action={updateContactAction.bind(null, contact.id)} contact={contact} companies={companyOptions} />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="rounded-xl border bg-card p-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Detail label="Company" value={contact.company?.name ?? "—"} link={contact.company ? `/companies/${contact.company.id}` : undefined} />
              <Detail label="Email" value={contact.email ?? "—"} />
              <Detail label="Phone" value={contact.phone ?? "—"} />
              <Detail label="LinkedIn" value={contact.linkedinUrl ?? "—"} link={contact.linkedinUrl ?? undefined} />
              <Detail label="Confidence" value={contact.confidence !== null ? `${Math.round(contact.confidence * 100)}%` : "—"} />
              <Detail label="Created" value={formatDate(contact.createdAt)} />
            </dl>
          </section>

          <section className="rounded-xl border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">
              Related Leads <span className="text-muted-foreground">({leads.total})</span>
            </h2>
            {leads.data.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No leads for this contact.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Company</TableHead>
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
                          {lead.company?.name ?? "—"}
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
        </div>

        <section className="rounded-xl border bg-card p-4 lg:self-start">
          <h2 className="mb-3 text-sm font-semibold">Activity</h2>
          {activities.data.length > 0 ? (
            <ActivityTimeline activities={activities.data} />
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">No activity yet.</p>
          )}
        </section>
      </div>
    </div>
  )
}

function Detail({ label, value, link }: { label: string; value: string; link?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">
        {link ? (
          <Link href={link} target={link.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}