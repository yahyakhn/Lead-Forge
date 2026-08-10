import { Badge, type badgeVariants } from "@/components/ui/badge"
import type { VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

type Variant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>

const STATUS_MAP: Record<string, { variant: Variant; className: string }> = {
  NEW: { variant: "outline", className: "bg-slate-100 text-slate-700 dark:bg-slate-800" },
  REVIEW: { variant: "outline", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40" },
  QUALIFIED: { variant: "outline", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/40" },
  CONTACTED: { variant: "outline", className: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40" },
  ENGAGED: { variant: "outline", className: "bg-teal-100 text-teal-800 dark:bg-teal-900/40" },
  OPPORTUNITY: { variant: "outline", className: "bg-green-100 text-green-800 dark:bg-green-900/40" },
  CONVERTED: { variant: "outline", className: "bg-emerald-600 text-white" },
  DISQUALIFIED: { variant: "outline", className: "bg-gray-200 text-gray-600 dark:bg-gray-700" },
  LOST: { variant: "outline", className: "bg-red-100 text-red-800 dark:bg-red-900/40" },
}

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_MAP[status] ?? STATUS_MAP.NEW
  return (
    <Badge variant={style.variant} className={style.className}>
      {status}
    </Badge>
  )
}

const PRIORITY_MAP: Record<string, Variant> = {
  LOW: "secondary",
  MEDIUM: "outline",
  HIGH: "default",
  URGENT: "destructive",
}

export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge variant={PRIORITY_MAP[priority] ?? "secondary"}>{priority}</Badge>
}

export function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) return <span className="text-muted-foreground">—</span>
  const className =
    score >= 90
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40"
      : score >= 75
        ? "bg-green-100 text-green-800 dark:bg-green-900/40"
        : score >= 60
          ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40"
          : score >= 40
            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40"
            : "bg-red-100 text-red-800 dark:bg-red-900/40"
  return (
    <span
      className={cn(
        "inline-flex h-5 w-fit min-w-7 shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      {score}
    </span>
  )
}

const VERIFICATION_MAP: Record<string, { variant: Variant; className: string }> = {
  VERIFIED: { variant: "outline", className: "bg-green-100 text-green-800 dark:bg-green-900/40" },
  UNVERIFIED: { variant: "outline", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40" },
  INVALID: { variant: "outline", className: "bg-red-100 text-red-800 dark:bg-red-900/40" },
  UNKNOWN: { variant: "secondary", className: "" },
}

export function VerificationBadge({ status }: { status: string }) {
  const style = VERIFICATION_MAP[status] ?? VERIFICATION_MAP.UNKNOWN
  return (
    <Badge variant={style.variant} className={style.className}>
      {status}
    </Badge>
  )
}

const COMPANY_STATUS_MAP: Record<string, Variant> = {
  ACTIVE: "default",
  PROSPECT: "outline",
  CUSTOMER: "outline",
  INACTIVE: "secondary",
  ARCHIVED: "secondary",
}

export function CompanyStatusBadge({ status }: { status: string }) {
  return <Badge variant={COMPANY_STATUS_MAP[status] ?? "outline"}>{status}</Badge>
}