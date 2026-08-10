import { DuplicateGroupStatus, MatchConfidence, EntityType } from "@/generated/prisma/enums"

export function GroupStatusBadge({ status }: { status: DuplicateGroupStatus }) {
  const styles: Record<DuplicateGroupStatus, string> = {
    PENDING_REVIEW: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
    CONFIRMED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    REJECTED: "bg-muted text-muted-foreground border-border",
    AUTO_MERGED: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30",
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status.replaceAll("_", " ")}
    </span>
  )
}

export function MatchConfidenceBadge({ confidence, score }: { confidence: MatchConfidence; score: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm tabular-nums">
      <span
        className={`size-2 rounded-full ${
          confidence === "HIGH" ? "bg-emerald-500" : confidence === "MEDIUM" ? "bg-amber-500" : "bg-muted-foreground"
        }`}
      />
      {score} · {confidence.toLowerCase()}
    </span>
  )
}

export function EntityTypeBadge({ type }: { type: EntityType }) {
  return (
    <span className="inline-flex items-center rounded-full border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      {type.toLowerCase()}
    </span>
  )
}