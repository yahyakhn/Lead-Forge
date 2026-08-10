import type { ICPCriteria } from "@/lib/crm/icp-shared"
import { humanize, rangeLabel } from "@/lib/crm/icp-shared"

export function joinValues(values: string[]): string | undefined {
  if (values.length === 0) return undefined
  if (values.length === 1) return values[0]
  if (values.length === 2) return values.join(" & ")
  return `${values.slice(0, 2).join(", ")} +${values.length - 2} more`
}

export interface SummaryLine {
  label: string
  text: string
}

export function summaryLines(criteria: ICPCriteria): SummaryLine[] {
  const lines: SummaryLine[] = []
  const targeting: string[] = []
  if (criteria.industries.length > 0) targeting.push(`${joinValues(criteria.industries)} companies`)
  if (criteria.countries.length > 0) targeting.push(`in ${joinValues(criteria.countries)}`)
  if (criteria.regions.length > 0) targeting.push(`in ${joinValues(criteria.regions)}`)
  if (targeting.length > 0) lines.push({ label: "Targeting", text: targeting.join(" ") })

  const geography: string[] = []
  if (criteria.countries.length > 0) geography.push(joinValues(criteria.countries)!)
  if (criteria.regions.length > 0) geography.push(joinValues(criteria.regions)!)
  if (criteria.cities.length > 0) geography.push(joinValues(criteria.cities)!)
  if (geography.length > 0) lines.push({ label: "Geography", text: geography.join(" · ") })

  const sizes: string[] = []
  const employees = criteria.employeeRange
  if (employees) {
    const label = employees.max !== undefined ? `${rangeLabel(employees)} employees` : `${employees.min ?? 0}+ employees`
    sizes.push(label)
  }
  const revenue = criteria.revenueRange
  if (revenue) sizes.push(`${rangeLabel(revenue)} ${revenue.currency ?? "USD"} revenue`)
  const age = criteria.companyAge
  if (age) sizes.push(`company age ${rangeLabel(age)} years`)
  if (sizes.length > 0) lines.push({ label: "Size", text: sizes.join(" · ") })

  if (criteria.technologies.length > 0) lines.push({ label: "Technologies", text: joinValues(criteria.technologies)! })
  if (criteria.companyTypes.length > 0)
    lines.push({ label: "Company type", text: criteria.companyTypes.map(humanize).join(", ") })
  if (criteria.signals.length > 0)
    lines.push({ label: "Signals", text: criteria.signals.map(humanize).join(", ") })

  const excluded: string[] = []
  if (criteria.exclusions.industries.length > 0) excluded.push(`industries: ${joinValues(criteria.exclusions.industries)}`)
  if (criteria.exclusions.countries.length > 0) excluded.push(`countries: ${joinValues(criteria.exclusions.countries)}`)
  if (criteria.exclusions.companyTypes.length > 0)
    excluded.push(`company types: ${criteria.exclusions.companyTypes.map(humanize).join(", ")}`)
  if (criteria.exclusions.keywords.length > 0) excluded.push(`keywords: ${joinValues(criteria.exclusions.keywords)}`)
  if (excluded.length > 0) lines.push({ label: "Excluding", text: excluded.join(" · ") })

  return lines
}

export function CriteriaSummary({ criteria }: { criteria: ICPCriteria }) {
  const lines = summaryLines(criteria)
  if (lines.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No criteria set yet — add a few to see a summary.</p>
  }
  return (
    <dl className="space-y-3">
      {lines.map((line) => (
        <div key={line.label}>
          <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{line.label}</dt>
          <dd className="text-sm">{line.text}</dd>
        </div>
      ))}
    </dl>
  )
}