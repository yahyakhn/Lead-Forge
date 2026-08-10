import Link from "next/link"
import { requireSession } from "@/lib/auth"
import { listDuplicateGroups, resolutionStats } from "@/lib/lead-engine/resolution/groups"
import { PageHeader } from "@/components/crm/page-header"
import { ErrorState, EmptyState } from "@/components/crm/states"
import { Pagination } from "@/components/crm/pagination"
import { GroupStatusBadge, MatchConfidenceBadge, EntityTypeBadge } from "@/components/crm/lead-engine/resolution-badges"
import { CandidateStatusBadge } from "@/components/crm/lead-engine/candidate-badges"
import { GroupActions } from "@/components/crm/lead-engine/group-actions"
import { Reasons } from "@/components/crm/lead-engine/reasons"
import { formatDateTime } from "@/lib/format"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FileWarningIcon } from "lucide-react"
import type { DuplicateGroupStatus, MatchConfidence } from "@/generated/prisma/enums"

type SearchParams = Record<string, string | string[] | undefined>

export default async function DuplicatesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireSession()
  const sp = await searchParams
  const first = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined)

  let result
  try {
    result = await listDuplicateGroups(session.organization.id, {
      page: sp.page,
      pageSize: sp.pageSize,
      status: first("status"),
      entityType: first("entityType"),
    })
  } catch {
    return <ErrorState message="We couldn't load duplicate groups." />
  }
  const stats = await resolutionStats(session.organization.id)

  const stat = (label: string, value: number) => (
    <div className="rounded-lg border bg-card px-3 py-2 text-center">
      <p className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Duplicates"
        description="Review and resolve duplicate candidates before they become CRM records."
      />

      <div className="mb-4 grid grid-cols-4 gap-2">
        {stat("Candidates", stats.totalCandidates)}
        {stat("High quality", stats.highQuality)}
        {stat("Medium quality", stats.mediumQuality)}
        {stat("Low quality", stats.lowQuality)}
        {stat("Potential duplicates", stats.potentialDuplicates)}
        {stat("Auto-resolved", stats.autoResolved)}
        {stat("Needs review", stats.potentialDuplicates)}
        {stat("Confirmed", stats.confirmed)}
      </div>

      <form className="mb-4 flex items-end gap-3 rounded-xl border bg-card p-4">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Status
          <select name="status" defaultValue={first("status") ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm">
            <option value="">Any</option>
            <option value="PENDING_REVIEW">Pending review</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="REJECTED">Rejected</option>
            <option value="AUTO_MERGED">Auto-merged</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Entity
          <select name="entityType" defaultValue={first("entityType") ?? ""} className="h-9 rounded-md border bg-background px-3 text-sm">
            <option value="">Any</option>
            <option value="COMPANY">Company</option>
            <option value="CONTACT">Contact</option>
          </select>
        </label>
        <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
          Filter
        </button>
      </form>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entity</TableHead>
              <TableHead>Candidate A</TableHead>
              <TableHead>Candidate B</TableHead>
              <TableHead>Match</TableHead>
              <TableHead>Reasons</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <EmptyState
                    title="No duplicate groups"
                    description="Run a scraper and extraction first; the resolution engine finds duplicates automatically."
                    action={
                      <Link href="/scrapers" className="text-sm font-medium underline-offset-4 hover:underline">
                        <FileWarningIcon className="mr-1 inline size-4" /> Go to Scrapers
                      </Link>
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              result.data.map((group) => {
                const members = group.members
                const describe = (member: (typeof members)[number] | undefined) => {
                  const c = member?.candidate
                  if (!c) return null
                  return {
                    id: c.id,
                    name: c.contactFullName ?? c.companyName ?? "Unnamed",
                    email: c.email ?? "",
                    status: c.status,
                  }
                }
                const A = describe(members[0])
                const B = describe(members[1])
                const reasons = (members[0]?.matchReasons ?? members[1]?.matchReasons ?? []) as string[]
                const score = members[0]?.matchScore ?? members[1]?.matchScore ?? 0
                const confidence = (score >= 90 ? "HIGH" : score >= 70 ? "MEDIUM" : "LOW") as MatchConfidence
                const MemberCell = ({ member }: { member: typeof A }) =>
                  member ? (
                    <>
                      <Link href={`/lead-engine/candidates/${member.id}`} className="font-medium underline-offset-4 hover:underline">
                        {member.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {member.email || "—"} <CandidateStatusBadge status={member.status} />
                      </div>
                    </>
                  ) : (
                    <span>—</span>
                  )
                return (
                  <TableRow key={group.id}>
                    <TableCell>
                      <EntityTypeBadge type={group.entityType} />
                    </TableCell>
                    <TableCell>
                      <MemberCell member={A} />
                    </TableCell>
                    <TableCell>
                      <MemberCell member={B} />
                    </TableCell>
                    <TableCell>
                      <MatchConfidenceBadge confidence={confidence} score={score} />
                      <div className="text-[11px] text-muted-foreground">{formatDateTime(group.createdAt)}</div>
                    </TableCell>
                    <TableCell>
                      <Reasons reasons={reasons} />
                    </TableCell>
                    <TableCell>
                      <GroupStatusBadge status={group.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/lead-engine/duplicates/${group.id}`} className="text-sm underline-offset-4 hover:underline">
                          Review
                        </Link>
                        <GroupActions groupId={group.id} status={group.status as DuplicateGroupStatus} />
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4">
        <Pagination
          pathname="/lead-engine/duplicates"
          params={{ ...sp }}
          page={result.page}
          totalPages={result.totalPages}
          total={result.total}
        />
      </div>
    </div>
  )
}