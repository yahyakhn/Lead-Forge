// TASK 014 §41-§44, §49: email status/type/domain-match badges and
// contact-readiness display.

import { cn } from "@/lib/utils"

const EMAIL_STATUS_STYLES: Record<string, string> = {
  UNKNOWN: "bg-slate-100 text-slate-600 ring-slate-500/20",
  DISCOVERED: "bg-sky-50 text-sky-700 ring-sky-600/20",
  VERIFIED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  LIKELY_VALID: "bg-teal-50 text-teal-700 ring-teal-600/20",
  INVALID: "bg-red-50 text-red-700 ring-red-600/20",
  RISKY: "bg-amber-50 text-amber-700 ring-amber-600/20",
  DISPOSABLE: "bg-orange-50 text-orange-700 ring-orange-600/20",
  STALE: "bg-yellow-50 text-yellow-700 ring-yellow-500/20",
  CONFLICT: "bg-purple-50 text-purple-700 ring-purple-600/20",
  REJECTED: "bg-slate-100 text-slate-400 ring-slate-500/10",
}

const EMAIL_TYPE_STYLES: Record<string, string> = {
  PERSONAL_BUSINESS: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  ROLE_BASED: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  GENERIC: "bg-slate-100 text-slate-600 ring-slate-500/20",
  UNKNOWN: "bg-slate-100 text-slate-500 ring-slate-500/20",
}

const DOMAIN_MATCH_STYLES: Record<string, string> = {
  DOMAIN_MATCH: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  GENERIC_DOMAIN: "bg-slate-100 text-slate-600 ring-slate-500/20",
  DOMAIN_MISMATCH: "bg-amber-50 text-amber-700 ring-amber-600/20",
  NOT_APPLICABLE: "bg-slate-100 text-slate-400 ring-slate-500/10",
}

const EMAIL_STATUS_LABELS: Record<string, string> = {
  UNKNOWN: "Unknown",
  DISCOVERED: "Discovered",
  VERIFIED: "Verified",
  LIKELY_VALID: "Likely valid",
  INVALID: "Invalid",
  RISKY: "Risky",
  DISPOSABLE: "Disposable",
  STALE: "Stale",
  CONFLICT: "Conflict",
  REJECTED: "Removed",
}

const EMAIL_TYPE_LABELS: Record<string, string> = {
  PERSONAL_BUSINESS: "Personal (business)",
  ROLE_BASED: "Role-based",
  GENERIC: "Generic domain",
  UNKNOWN: "Unknown type",
}

const DISCOVERY_STATUS_STYLES: Record<string, string> = {
  QUEUED: "bg-slate-100 text-slate-600 ring-slate-500/20",
  RUNNING: "bg-blue-50 text-blue-700 ring-blue-600/20",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  PARTIAL: "bg-amber-50 text-amber-700 ring-amber-600/20",
  FAILED: "bg-red-50 text-red-700 ring-red-600/20",
  CANCELLED: "bg-slate-100 text-slate-500 ring-slate-500/20",
}

const VERIFICATION_STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-600 ring-slate-500/20",
  RUNNING: "bg-blue-50 text-blue-700 ring-blue-600/20",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  FAILED: "bg-red-50 text-red-700 ring-red-600/20",
}

export function EmailStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", EMAIL_STATUS_STYLES[status] ?? EMAIL_STATUS_STYLES.UNKNOWN, className)}>
      {EMAIL_STATUS_LABELS[status] ?? status}
    </span>
  )
}

export function EmailTypeBadge({ type, className }: { type: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", EMAIL_TYPE_STYLES[type] ?? EMAIL_TYPE_STYLES.UNKNOWN, className)}>
      {EMAIL_TYPE_LABELS[type] ?? type}
    </span>
  )
}

export function EmailDomainMatchBadge({ match, className }: { match: string; className?: string }) {
  const labels: Record<string, string> = { DOMAIN_MATCH: "Domain match", GENERIC_DOMAIN: "Generic domain", DOMAIN_MISMATCH: "Domain mismatch", NOT_APPLICABLE: "—" }
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", DOMAIN_MATCH_STYLES[match] ?? DOMAIN_MATCH_STYLES.NOT_APPLICABLE, className)}>
      {labels[match] ?? match}
    </span>
  )
}

export function EmailDiscoveryStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", DISCOVERY_STATUS_STYLES[status] ?? DISCOVERY_STATUS_STYLES.QUEUED)}>
      {status.toLowerCase()}
    </span>
  )
}

export function EmailVerificationStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", VERIFICATION_STATUS_STYLES[status] ?? VERIFICATION_STATUS_STYLES.PENDING)}>
      {status.toLowerCase()}
    </span>
  )
}

export function ReadinessScore({ score, reasons, compact }: { score: number | null; reasons?: string[]; compact?: boolean }) {
  if (score === null) {
    return <span className="text-sm text-muted-foreground">Not scored</span>
  }
  const color = score >= 75 ? "text-emerald-600" : score >= 50 ? "text-amber-600" : "text-slate-500"
  return (
    <div>
      <div className={cn("flex items-baseline gap-1", compact && "inline-flex")}>
        <span className={cn("text-lg font-semibold", color)}>{score}</span>
        <span className="text-xs text-muted-foreground">/ 100</span>
      </div>
      {reasons && !compact && (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
