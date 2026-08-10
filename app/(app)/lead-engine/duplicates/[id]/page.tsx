import Link from "next/link"
import { notFound } from "next/navigation"
import { requireSession } from "@/lib/auth"
import { getDuplicateGroup } from "@/lib/lead-engine/resolution/groups"
import { PageHeader } from "@/components/crm/page-header"
import { GroupStatusBadge, MatchConfidenceBadge } from "@/components/crm/lead-engine/resolution-badges"
import { CandidateStatusBadge } from "@/components/crm/lead-engine/candidate-badges"
import { GroupActions } from "@/components/crm/lead-engine/group-actions"
import { Reasons } from "@/components/crm/lead-engine/reasons"
import { formatDateTime } from "@/lib/format"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CircleCheckIcon, CircleXIcon, SparklesIcon } from "lucide-react"

const FIELD_LABELS: Record<string, string> = {
  companyName: "Company",
  companyDomain: "Domain",
  websiteUrl: "Website",
  description: "Description",
  industry: "Industry",
  country: "Country",
  region: "Region",
  city: "City",
  contactFullName: "Contact",
  contactJobTitle: "Title",
  email: "Email",
  phoneRaw: "Phone",
}

interface GroupMemberCandidate {
  id: string
  status: string
  companyName: string | null
  companyDomain: string | null
  websiteUrl: string | null
  email: string | null
  phoneRaw: string | null
  linkedinUrl: string | null
  contactFullName: string | null
  contactJobTitle: string | null
  pageClassification: string | null
  extractionConfidence: number | null
  createdAt: Date
  rawPage: { id: string; url: string; fetchedAt: Date } | null
}

export default async function DuplicateGroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const { id } = await params
  const group = await getDuplicateGroup(session.organization.id, id)
  if (!group) notFound()

  const members = group.members as unknown as { candidate: GroupMemberCandidate; matchScore: number | null; matchReasons: unknown }[]
  const reasons = (members[0]?.matchReasons ?? members[1]?.matchReasons ?? []) as string[]
  const score = members[0]?.matchScore ?? members[1]?.matchScore ?? 0
  const mergedData = (group.mergedData ?? {}) as Record<string, string>
  const conflicts = (group.conflicts ?? []) as Array<{ field: string; values: Array<{ value: string; sourceCandidateId: string }> }>

  const candidateSummary = (m: (typeof members)[number]) => {
    const c = m.candidate
    return {
      id: c.id,
      name: c.contactFullName ?? c.companyName ?? "Unnamed",
      rows: [
        ["companyName", c.companyName],
        ["companyDomain", c.companyDomain],
        ["websiteUrl", c.websiteUrl],
        ["email", c.email],
        ["phoneRaw", c.phoneRaw],
        ["linkedinUrl", c.linkedinUrl],
        ["contactFullName", c.contactFullName],
        ["contactJobTitle", c.contactJobTitle],
      ] as Array<[string, string | null]>,
    }
  }

  const A = members[0] ? candidateSummary(members[0]) : null
  const B = members[1] ? candidateSummary(members[1]) : null

  const sourceUrl = (m: (typeof members)[number]) => m.candidate.rawPage?.url

  const fieldValue = (id: string | null, summaries: Array<{ id: string; rows: Array<[string, string | null]> }>, field: string) => {
    const summary = summaries.find((s) => s.id === id)
    return summary?.rows.find(([key]) => key === field)?.[1] ?? null
  }

  return (
    <div>
      <PageHeader
        title="Duplicate Group"
        description={
          <>
            {group.entityType === "COMPANY" ? "Company" : "Contact"} duplicates ·{" "}
            <GroupStatusBadge status={group.status} /> · match score {score}
          </>
        }
        actions={<GroupActions groupId={group.id} status={group.status} />}
      />

      {group.status === "PENDING_REVIEW" ? (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          These candidates may represent the same {group.entityType.toLowerCase()}. Confirm the duplicate to merge them, or reject if they are distinct.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {[A, B].map((summary, index) =>
          summary ? (
            <section key={summary.id} className="rounded-xl border bg-card p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Candidate {index === 0 ? "A" : "B"}
                  {group.canonicalCandidateId === summary.id ? (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">
                      <CircleCheckIcon className="size-3" /> canonical
                    </span>
                  ) : null}
                </h2>
                <CandidateStatusBadge status={summary.rows.length ? (members[index].candidate.status as never) : ("EXTRACTED" as never)} />
              </div>
              <dl className="mt-3">
                {summary.rows.map(([field, value]) => (
                  <div key={field} className="flex justify-between gap-4 border-b py-1.5 text-sm last:border-0">
                    <dt className="text-muted-foreground">{FIELD_LABELS[field] ?? field}</dt>
                    <dd className="break-all">{value ?? "—"}</dd>
                  </div>
                ))}
                {sourceUrl(members[index]) ? (
                  <div className="py-1.5 text-sm">
                    <a href={sourceUrl(members[index])} target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline">
                      Source page
                    </a>
                  </div>
                ) : null}
              </dl>
            </section>
          ) : null,
        )}
      </div>

      <section className="mt-6 rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Why these matched</h2>
          <MatchConfidenceBadge confidence={score >= 90 ? "HIGH" : score >= 70 ? "MEDIUM" : "LOW"} score={score} />
        </div>
        <Reasons reasons={reasons} max={10} />
      </section>

      <section className="mt-6 rounded-xl border bg-card p-5">
        <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <SparklesIcon className="size-4" /> Suggested canonical merge
        </h2>
        {group.status === "PENDING_REVIEW" ? (
          <p className="mt-2 text-sm text-muted-foreground">Shown after confirmation — the canonical value is chosen by data completeness.</p>
        ) : (
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Candidate A</TableHead>
                <TableHead>Candidate B</TableHead>
                <TableHead>Canonical</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.keys(FIELD_LABELS).map((field) => {
                const a = fieldValue(A?.id ?? null, [A, B].filter((s): s is NonNullable<typeof A> => !!s), field)
                const b = fieldValue(B?.id ?? null, [A, B].filter((s): s is NonNullable<typeof B> => !!s), field)
                const canonical = mergedData[field] ?? null
                if (a === null && b === null && canonical === null) return null
                const conflict = conflicts.find((c) => c.field === field)
                return (
                  <TableRow key={field}>
                    <TableCell className="font-medium">{FIELD_LABELS[field]}</TableCell>
                    <TableCell>{a ?? "—"}</TableCell>
                    <TableCell>{b ?? "—"}</TableCell>
                    <TableCell>
                      {canonical ?? "—"}{" "}
                      {conflict ? (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-amber-600 dark:text-amber-400">
                          <CircleXIcon className="size-3" /> conflict
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>

      {conflicts.length > 0 ? (
        <section className="mt-6 rounded-xl border bg-card p-5">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Field conflicts</h2>
          <ul className="mt-3 space-y-3">
            {conflicts.map((conflict) => (
              <li key={conflict.field} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{FIELD_LABELS[conflict.field] ?? conflict.field}</p>
                {conflict.values.map((v) => (
                  <p key={v.sourceCandidateId} className="mt-1 flex justify-between gap-4">
                    <span className="break-all">{v.value}</span>
                    <Link href={`/lead-engine/candidates/${v.sourceCandidateId}`} className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:underline">
                      candidate {v.sourceCandidateId.slice(-6)}
                    </Link>
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6 rounded-xl border bg-card p-5">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Audit trail</h2>
        <ul className="mt-3 space-y-2">
          {group.auditEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            group.auditEvents.map((event) => (
              <li key={event.id} className="text-sm">
                <span className="font-medium">{event.action.replaceAll("_", " ")}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {event.actorName ?? "system"} · {formatDateTime(event.createdAt)}
                </span>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  )
}