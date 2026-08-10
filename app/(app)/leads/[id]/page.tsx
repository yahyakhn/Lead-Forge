import Link from "next/link"
import { notFound } from "next/navigation"
import { requireSession } from "@/lib/auth"
import { getLead } from "@/lib/crm/leads"
import { listActivities } from "@/lib/crm/activities"
import { listDeals } from "@/lib/crm/deals"
import { listStages } from "@/lib/crm/pipeline"
import { listUsers } from "@/lib/crm/options"
import { listLeadLists, listLeadListMembershipIds } from "@/lib/crm/lead-lists"
import { ErrorState } from "@/components/crm/states"
import { PageHeader } from "@/components/crm/page-header"
import { ActivityTimeline } from "@/components/crm/activity-timeline"
import { EntityAvatar } from "@/components/crm/entity-avatar"
import { PriorityBadge, ScoreBadge, StatusBadge } from "@/components/crm/badges"
import { LeadQuickSets, LeadActions } from "@/components/crm/lead-actions"
import { formatDate, formatMoney } from "@/lib/format"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeftIcon } from "lucide-react"

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await requireSession()
  const { id } = await params

  let data
  try {
    const [lead, activities, deals, stages, users, lists, memberIds] = await Promise.all([
      getLead(session.organization.id, id),
      listActivities(session.organization.id, { leadId: id, pageSize: 50 }),
      listDeals(session.organization.id, { leadId: id, pageSize: 50 }),
      listStages(session.organization.id),
      listUsers(session.organization.id),
      listLeadLists(session.organization.id),
      listLeadListMembershipIds(session.organization.id, id),
    ])
    data = { lead, activities, deals, stages, users, lists, memberIds }
  } catch {
    return <ErrorState message="We couldn't load this lead." />
  }

  const { lead, activities, deals, stages, users, lists, memberIds } = data
  if (!lead) notFound()

  const ownerOptions = users.map((u) => ({ value: u.id, label: u.name, hint: u.email }))
  const stageOptions = stages.map((s) => ({ value: s.id, label: s.name }))
  const listOptions = lists.data.map((l) => ({ id: l.id, name: l.name, member: memberIds.includes(l.id) }))
  const memberLists = lists.data.filter((l) => memberIds.includes(l.id))

  return (
    <div>
      <Link href="/leads" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-3.5" /> Leads
      </Link>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {lead.company ? (
              <Link href={`/companies/${lead.company.id}`} className="hover:underline">
                {lead.company.name}
              </Link>
            ) : (
              "Unattributed lead"
            )}
            <span className="text-muted-foreground">
              <StatusBadge status={lead.status} />
            </span>
            <PriorityBadge priority={lead.priority} />
            <ScoreBadge score={lead.score} />
          </span>
        }
        actions={
          <LeadActions
            leadId={lead.id}
            leadName={lead.company?.name ?? "Lead"}
            lists={listOptions}
            stages={stageOptions}
            owners={ownerOptions}
          />
        }
      />

      <LeadQuickSets
        leadId={lead.id}
        status={lead.status}
        priority={lead.priority}
        ownerId={lead.ownerId}
        owners={ownerOptions}
        className="mb-4"
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="rounded-xl border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Overview</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Detail label="Source" value={lead.source ?? "—"} />
              <Detail label="Owner" value={lead.owner?.name ?? "Unassigned"} />
              <Detail label="Contact" value={lead.contact?.fullName ?? "—"} />
              <Detail label="Score" value={lead.score !== null ? String(lead.score) : "—"} />
              <Detail label="Fit score" value={lead.fitScore !== null ? String(lead.fitScore) : "—"} />
              <Detail label="Priority" value={lead.priority} />
              <Detail label="Created" value={formatDate(lead.createdAt)} />
              <Detail label="Last activity" value={formatDate(lead.lastActivityAt)} />
              <Detail label="Updated" value={formatDate(lead.updatedAt)} />
            </dl>
            {memberLists.length > 0 ? (
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Lists:</span>
                {memberLists.map((l) => (
                  <Link
                    key={l.id}
                    href={`/lead-lists/${l.id}`}
                    className="rounded-full border px-2 py-0.5 text-xs font-medium hover:bg-muted"
                  >
                    {l.name}
                  </Link>
                ))}
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Deals</h2>
            </div>
            {deals.data.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No deals yet. Create one to track this opportunity.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Deal</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Expected close</TableHead>
                    <TableHead>Owner</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deals.data.map((deal) => (
                    <TableRow key={deal.id} className="hover:bg-muted/50">
                      <TableCell className="font-medium">{deal.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(deal.value.toNumber())}</TableCell>
                      <TableCell>{deal.stage.name}</TableCell>
                      <TableCell className="text-right">{formatDate(deal.expectedCloseDate)}</TableCell>
                      <TableCell>{deal.owner?.name ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          <section className="rounded-xl border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Company</h2>
            {lead.company ? (
              <div className="flex items-center gap-3">
                <EntityAvatar name={lead.company.name} />
                <div>
                  <Link href={`/companies/${lead.company.id}`} className="font-medium hover:underline">
                    {lead.company.name}
                  </Link>
                  <p className="text-sm text-muted-foreground">{lead.company.domain ?? "—"}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No company attached.</p>
            )}
          </section>

          <section className="rounded-xl border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Contact</h2>
            {lead.contact ? (
              <div className="flex items-center gap-3">
                <EntityAvatar name={lead.contact.fullName} />
                <div>
                  <p className="font-medium">{lead.contact.fullName}</p>
                  <p className="text-sm text-muted-foreground">
                    {[lead.contact.jobTitle, lead.contact.email].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No contact attached.</p>
            )}
          </section>
        </div>

        <section className="rounded-xl border bg-card p-4 lg:self-start">
          <h2 className="mb-3 text-sm font-semibold">Activity</h2>
          {activities.data.length > 0 ? (
            <ActivityTimeline activities={activities.data} />
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">No activity yet. Log a note or call.</p>
          )}
        </section>
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  )
}