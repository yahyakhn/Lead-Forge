// TASK 020: Lead Finder server-side helpers shared by the page, components,
// and tests. Pure functions; all persistence goes through the existing
// ICP / source / run / extraction / conversion services.

import type { ICPCriteria } from "@/lib/crm/icp-shared"
import type { JobPosting } from "@/lib/lead-engine/extraction/types"

export const FINDER_PAGE_SIZE = 25

export const FINDER_PAGE_REFRESH = 3000

export function candidateSignals(jobs: JobPosting[] = []): string[] {
  const active = jobs.filter((job) => job.title?.trim())
  const signals: string[] = []
  if (active.length > 0) {
    signals.push(`Hiring: ${active.length} open role${active.length === 1 ? "" : "s"}`)
  }
  return signals
}

export function icpCriteriaLines(criteria: ICPCriteria | null | undefined): string[] {
  if (!criteria) return []
  const lines: string[] = []
  if (criteria.industries?.length) lines.push(`Industries: ${criteria.industries.join(", ")}`)
  if (criteria.countries?.length) lines.push(`Countries: ${criteria.countries.join(", ")}`)
  if (criteria.regions?.length) lines.push(`Regions: ${criteria.regions.join(", ")}`)
  if (criteria.cities?.length) lines.push(`Cities: ${criteria.cities.join(", ")}`)
  if (criteria.technologies?.length) lines.push(`Technologies: ${criteria.technologies.join(", ")}`)
  const emp = criteria.employeeRange
  if (emp?.min != null || emp?.max != null) {
    lines.push(`Employees: ${emp.min ?? "?"}–${emp.max ?? "?"}`)
  }
  return lines
}