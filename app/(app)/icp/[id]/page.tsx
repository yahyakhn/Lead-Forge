import Link from "next/link"
import { notFound } from "next/navigation"
import { requireSession } from "@/lib/auth"
import { getICP } from "@/lib/crm/icp"
import { ICPActions } from "@/components/crm/icp/icp-actions"
import { IcpActiveBadge } from "@/components/crm/icp/icp-badges"
import { joinValues } from "@/components/crm/icp/criteria-summary"
import { PageHeader } from "@/components/crm/page-header"
import { ErrorState } from "@/components/crm/states"
import { formatDate } from "@/lib/format"
import { humanize, rangeLabel } from "@/lib/crm/icp-shared"
import type { ICPCriteria, ICPScoringConfig } from "@/lib/crm/icp-shared"
import { DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS, DEFAULT_UNKNOWN_CREDIT } from "@/lib/lead-engine/scoring/engine"

function Section({ items, fallback = "—" }: { items: string[]; fallback?: string }) {
  return <div className="text-sm">{items.length > 0 ? items.join(", ") : fallback}</div>
}

function scoringSections(scoring: ICPScoringConfig | null): { label: string; content: React.ReactNode }[] {
  if (!scoring) return []
  const sections: { label: string; content: React.ReactNode }[] = []
  if (scoring.keywords.length > 0) sections.push({ label: "Target Keywords", content: <Section items={scoring.keywords} /> })
  if (scoring.jobTitles.length > 0) sections.push({ label: "Target Job Titles", content: <Section items={scoring.jobTitles} /> })
  if (scoring.seniorities.length > 0) sections.push({ label: "Target Seniorities", content: <Section items={scoring.seniorities.map(humanize)} /> })
  if (scoring.domains.length > 0) sections.push({ label: "Target Domains", content: <Section items={scoring.domains} /> })
  sections.push({
    label: "Weights",
    content: (
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2 text-sm">
        {Object.entries(DEFAULT_WEIGHTS).map(([key, defaultVal]) => (
          <div key={key}>
            <dt className="text-muted-foreground capitalize">{key}</dt>
            <dd className="font-medium tabular-nums">
              {scoring.weights[key as keyof typeof DEFAULT_WEIGHTS] ?? defaultVal}
            </dd>
          </div>
        ))}
      </dl>
    ),
  })
  sections.push({
    label: "Thresholds",
    content: (
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-3 text-sm">
        <div>
          <dt className="text-muted-foreground">HOT ≥</dt>
          <dd className="font-medium tabular-nums">{scoring.thresholds.hot ?? DEFAULT_THRESHOLDS.hot}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">GOOD ≥</dt>
          <dd className="font-medium tabular-nums">{scoring.thresholds.good ?? DEFAULT_THRESHOLDS.good}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">MAYBE ≥</dt>
          <dd className="font-medium tabular-nums">{scoring.thresholds.maybe ?? DEFAULT_THRESHOLDS.maybe}</dd>
        </div>
      </dl>
    ),
  })
  sections.push({
    label: "Unknown Data Credit",
    content: <Section items={[`${scoring.unknownCredit ?? DEFAULT_UNKNOWN_CREDIT}%`]} />,
  })
  return sections
}

function criteriaSections(criteria: ICPCriteria): { label: string; content: React.ReactNode }[] {
  const sections: { label: string; content: React.ReactNode }[] = []
  if (criteria.industries.length > 0) sections.push({ label: "Industries", content: <Section items={criteria.industries} /> })
  if (criteria.countries.length > 0) sections.push({ label: "Countries", content: <Section items={criteria.countries} /> })
  if (criteria.regions.length > 0) sections.push({ label: "Regions / States", content: <Section items={criteria.regions} /> })
  if (criteria.cities.length > 0) sections.push({ label: "Cities", content: <Section items={criteria.cities} /> })
  if (criteria.technologies.length > 0)
    sections.push({ label: "Technologies", content: <Section items={criteria.technologies} /> })
  if (criteria.employeeRange)
    sections.push({
      label: "Employees",
      content: (
        <Section
          items={[
            criteria.employeeRange.max !== undefined
              ? `${criteria.employeeRange.min ?? 0}–${criteria.employeeRange.max}`
              : `${criteria.employeeRange.min ?? 0}+`,
          ]}
        />
      ),
    })
  if (criteria.revenueRange)
    sections.push({
      label: "Annual revenue",
      content: (
        <Section
          items={[`${rangeLabel(criteria.revenueRange)} ${criteria.revenueRange.currency ?? "USD"}`]}
        />
      ),
    })
  if (criteria.companyAge)
    sections.push({ label: "Company age", content: <Section items={[`${rangeLabel(criteria.companyAge)} years`]} /> })
  if (criteria.companyTypes.length > 0)
    sections.push({ label: "Company type", content: <Section items={criteria.companyTypes.map(humanize)} /> })
  if (criteria.signals.length > 0)
    sections.push({ label: "Signals", content: <Section items={criteria.signals.map(humanize)} /> })
  if (criteria.exclusions.industries.length > 0)
    sections.push({ label: "Excluded industries", content: <Section items={criteria.exclusions.industries} /> })
  if (criteria.exclusions.countries.length > 0)
    sections.push({ label: "Excluded countries", content: <Section items={criteria.exclusions.countries} /> })
  if (criteria.exclusions.companyTypes.length > 0)
    sections.push({
      label: "Excluded company types",
      content: <Section items={criteria.exclusions.companyTypes.map(humanize)} />,
    })
  if (criteria.exclusions.keywords.length > 0)
    sections.push({ label: "Excluded keywords", content: <Section items={criteria.exclusions.keywords} /> })
  return sections
}

export default async function ICPDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const { id } = await params

  let icp
  try {
    icp = await getICP(session.organization.id, id)
  } catch {
    return <ErrorState message="We couldn't load this ICP profile." />
  }
  if (!icp) notFound()

  const criteriaSectionsList = criteriaSections(icp.criteria)
  const scoringSectionsList = scoringSections(icp.criteria.scoring)

  return (
    <div>
      <PageHeader
        title={icp.name}
        description={icp.description ?? "No description"}
        actions={
          <div className="flex items-center gap-2">
            <IcpActiveBadge active={icp.isActive} />
            <ICPActions profileId={icp.id} name={icp.name} isActive={icp.isActive} showLabels redirectToDelete="/icp" />
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="rounded-xl border bg-card p-5">
          {criteriaSectionsList.length === 0 && scoringSectionsList.length === 0 ? (
            <p className="text-sm text-muted-foreground">No criteria set for this profile.</p>
          ) : (
            <>
              {criteriaSectionsList.length > 0 && (
                <>
                  <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase mb-3">Discovery Criteria</h3>
                  <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                    {criteriaSectionsList.map((section) => (
                      <div key={section.label}>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          {section.label}
                        </dt>
                        <dd className="mt-1">{section.content}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
              {scoringSectionsList.length > 0 && (
                <div className="mt-6 border-t pt-6">
                  <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase mb-3">Lead Scoring Configuration</h3>
                  <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                    {scoringSectionsList.map((section) => (
                      <div key={section.label}>
                        <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          {section.label}
                        </dt>
                        <dd className="mt-1">{section.content}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </>
          )}
        </div>
        <div className="h-fit rounded-xl border bg-card p-5">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Summary</h2>
          <p className="mt-3 text-sm text-muted-foreground">{icp.description ?? "No description"}</p>
          {icp.criteria.industries.length > 0 && (
            <p className="mt-3 text-sm">
              {joinValues(icp.criteria.industries)} companies
              {icp.criteria.countries.length > 0 ? ` in ${joinValues(icp.criteria.countries)}` : ""}
            </p>
          )}
          <dl className="mt-4 space-y-2 border-t pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Created</dt>
              <dd className="tabular-nums">{formatDate(icp.createdAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Updated</dt>
              <dd className="tabular-nums">{formatDate(icp.updatedAt)}</dd>
            </div>
          </dl>
          <Link href={`/icp/${icp.id}/edit`} className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
            Edit this profile →
          </Link>
        </div>
      </div>
    </div>
  )
}