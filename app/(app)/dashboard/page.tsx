import Link from "next/link"
import { requireSession } from "@/lib/auth"
import { getOrganizationStats } from "@/lib/crm/dashboard"
import { IcpCard } from "@/components/crm/icp/icp-card"
import { PageHeader } from "@/components/crm/page-header"
import { ErrorState } from "@/components/crm/states"
import { StatusBadge } from "@/components/crm/badges"
import { formatDate } from "@/lib/format"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Building2Icon,
  ContactIcon,
  CircleDollarSignIcon,
  CrosshairIcon,
  FingerprintIcon,
  FlagIcon,
} from "lucide-react"

export default async function DashboardPage() {
  const session = await requireSession()

  let stats
  try {
    stats = await getOrganizationStats(session.organization.id)
  } catch {
    return <ErrorState message="We couldn't load your dashboard." />
  }

  const metrics = [
    { label: "Total Leads", value: stats.totalLeads, href: "/leads", icon: CrosshairIcon },
    { label: "Qualified Leads", value: stats.qualifiedLeads, href: "/leads?status=QUALIFIED", icon: FingerprintIcon },
    { label: "High Priority", value: stats.highPriorityLeads, href: "/leads?priority=HIGH", icon: FlagIcon },
    { label: "Companies", value: stats.totalCompanies, href: "/companies", icon: Building2Icon },
    { label: "Contacts", value: stats.totalContacts, href: "/contacts", icon: ContactIcon },
    { label: "Open Deals", value: stats.openDeals, href: "/leads", icon: CircleDollarSignIcon },
  ]

  const maxStageCount = Math.max(1, ...stats.pipelineSummary.map((s) => s.count))

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`${session.organization.name} — signed in as ${session.user.name}`}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {metrics.map((m) => (
          <Link
            key={m.label}
            href={m.href}
            className="group rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{m.label}</span>
              <m.icon className="size-4 text-muted-foreground/60" />
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{m.value.toLocaleString()}</p>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section>
          <h2 className="mb-2 text-sm font-semibold">Recent Leads</h2>
          {stats.recentLeads.length === 0 ? (
            <div className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
              No leads yet. Create your first lead to see it here.
            </div>
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Company</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.recentLeads.map((lead) => (
                    <TableRow key={lead.id} className="hover:bg-muted/50">
                      <TableCell>
                        <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
                          {lead.company?.name ?? "—"}
                        </Link>
                      </TableCell>
                      <TableCell>{lead.contact?.fullName ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{lead.score ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge status={lead.status} />
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatDate(lead.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">Active ICP</h2>
          <IcpCard orgId={session.organization.id} />
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">Pipeline</h2>
          <div className="rounded-xl border">
            <ul className="divide-y">
              {stats.pipelineSummary.map(({ stage, count }) => (
                <li key={stage.id}>
                  <Link
                    href={`/leads?status=${stage.slug.toUpperCase()}`}
                    className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color ?? "#64748b" }} />
                    <span className="flex-1 font-medium">{stage.name}</span>
                    <span className="text-muted-foreground tabular-nums">{count.toLocaleString()}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="p-4">
              <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                {stats.pipelineSummary.map(({ stage, count }) => (
                  <span
                    key={stage.id}
                    style={{ width: `${(count / maxStageCount) * 100}%`, backgroundColor: stage.color ?? "#64748b" }}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}