import { cn } from "@/lib/utils"
import { relativeDay, formatDateTime } from "@/lib/format"
import {
  ArrowRightLeftIcon,
  CalendarDaysIcon,
  CheckSquareIcon,
  MailIcon,
  PhoneIcon,
  SearchIcon,
  StickyNoteIcon,
} from "lucide-react"
import { ActivityType } from "@/generated/prisma/enums"

const ICONS: Record<string, { icon: typeof StickyNoteIcon; className: string }> = {
  NOTE: { icon: StickyNoteIcon, className: "bg-slate-100 text-slate-600 dark:bg-slate-800" },
  EMAIL: { icon: MailIcon, className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40" },
  CALL: { icon: PhoneIcon, className: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40" },
  MEETING: { icon: CalendarDaysIcon, className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40" },
  TASK: { icon: CheckSquareIcon, className: "bg-purple-100 text-purple-700 dark:bg-purple-900/40" },
  STATUS_CHANGE: { icon: ArrowRightLeftIcon, className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40" },
  RESEARCH: { icon: SearchIcon, className: "bg-teal-100 text-teal-700 dark:bg-teal-900/40" },
}

export interface ActivityItem {
  id: string
  type: ActivityType
  title: string
  description: string | null
  createdAt: Date | string
  createdBy: { id: string; name: string } | null
}

function withDayMarkers<T extends { createdAt: Date | string }>(items: T[]) {
  const rows: (T & { isFirstOfDay: boolean; day: string })[] = []
  let lastDay = ""
  for (const item of items) {
    const day = relativeDay(new Date(item.createdAt))
    rows.push({ ...item, isFirstOfDay: day !== lastDay, day })
    lastDay = day
  }
  return rows
}

export function ActivityTimeline({ activities }: { activities: ActivityItem[] }) {
  if (activities.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No activities yet.</p>
  }

  const rows = withDayMarkers(activities)
  return (
    <ol className="space-y-0">
      {rows.map((a) => {
        const { icon: Icon, className } = ICONS[a.type] ?? ICONS.NOTE
        return (
          <li key={a.id}>
            {a.isFirstOfDay ? (
              <p className="flex items-center gap-2 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {a.day}
                <span className="h-px flex-1 bg-border" />
              </p>
            ) : null}
            <div className="flex gap-3 py-2">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg [&>svg]:size-3.5",
                  className,
                )}
              >
                <Icon />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">{a.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(a.createdAt)} · {a.createdBy?.name ?? "Unknown"}
                  </span>
                </div>
                {a.description ? (
                  <p className="mt-0.5 text-sm whitespace-pre-wrap text-muted-foreground">{a.description}</p>
                ) : null}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}