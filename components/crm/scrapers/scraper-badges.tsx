import { Badge } from "@/components/ui/badge"
import { humanize } from "@/lib/crm/icp-shared"
import { ScraperRunEventLevel, ScraperRunStatus, SourceCapability } from "@/generated/prisma/enums"
import { cn } from "@/lib/utils"

const runStyles: Record<string, string> = {
  QUEUED: "bg-muted text-muted-foreground",
  RUNNING: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  COMPLETED: "",
  PARTIAL: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  FAILED: "bg-destructive/10 text-destructive",
  CANCELLED: "bg-muted text-muted-foreground line-through",
}

export function RunStatusBadge({ status }: { status: ScraperRunStatus }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", runStyles[status], status === ScraperRunStatus.RUNNING && "animate-pulse")}>
      {status}
    </Badge>
  )
}

const levelStyles: Record<string, string> = {
  INFO: "bg-muted text-muted-foreground",
  WARNING: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  ERROR: "bg-destructive/10 text-destructive",
}

export function EventLevelBadge({ level }: { level: ScraperRunEventLevel }) {
  return (
    <Badge variant="outline" className={cn("border-transparent", levelStyles[level])}>
      {level}
    </Badge>
  )
}

export function SourceTypeLabel({ type }: { type: string }) {
  return <span className="text-sm text-muted-foreground">{humanize(type)}</span>
}

export function CapabilityChips({ capabilities }: { capabilities: SourceCapability[] }) {
  if (capabilities.length === 0) return <span className="text-sm text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {capabilities.map((cap) => (
        <Badge key={cap} variant="secondary" className="font-normal">
          {humanize(cap)}
        </Badge>
      ))}
    </div>
  )
}