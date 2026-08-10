import { Badge } from "@/components/ui/badge"
import { humanize } from "@/lib/crm/icp-shared"
import { CandidateStatus, ExtractionMethod } from "@/generated/prisma/enums"
import { cn } from "@/lib/utils"

const statusStyles: Record<string, string> = {
  PENDING: "bg-muted text-muted-foreground",
  PROCESSING: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  EXTRACTED: "",
  SKIPPED: "bg-muted text-muted-foreground",
  FAILED: "bg-destructive/10 text-destructive",
  REVIEW: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  DUPLICATE: "bg-muted text-muted-foreground",
  READY: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  CONVERTED: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30",
}

export function CandidateStatusBadge({ status }: { status: CandidateStatus }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", statusStyles[status], status === CandidateStatus.PROCESSING && "animate-pulse")}>
      {status === CandidateStatus.READY ? "canonical" : status}
    </Badge>
  )
}

const methodStyles: Record<string, string> = {
  DETERMINISTIC: "bg-muted text-muted-foreground",
  AI: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  HYBRID: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
}

export function ExtractionMethodBadge({ method }: { method: ExtractionMethod | null }) {
  if (!method) return <span className="text-sm text-muted-foreground">—</span>
  return (
    <Badge variant="outline" className={cn("border-transparent", methodStyles[method])}>
      {humanize(method)}
    </Badge>
  )
}