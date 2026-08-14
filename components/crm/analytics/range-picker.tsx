"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { CalendarIcon } from "lucide-react"

const RANGES = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
] as const

export function RangePicker() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const range = searchParams.get("range") ?? "30d"
  const from = searchParams.get("from") ?? ""
  const to = searchParams.get("to") ?? ""

  const update = (params: Record<string, string | undefined>) => {
    const search = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value)
      else search.delete(key)
    }
    router.replace(`${pathname}?${search.toString()}`, { scroll: false })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav className="flex items-center gap-0.5 rounded-lg border p-0.5 text-xs">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => update({ range: r.key, ...(r.key === "custom" ? {} : { from: undefined, to: undefined }) })}
            className={cn(
              "rounded-md px-2 py-1 transition-colors",
              range === r.key ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            {r.label}
          </button>
        ))}
      </nav>
      {range === "custom" && (
        <div className="flex items-center gap-1.5 text-xs">
          <CalendarIcon className="size-3.5 text-muted-foreground" />
          <input
            type="date"
            aria-label="Start date"
            value={from}
            max={to || undefined}
            onChange={(e) => update({ range: "custom", from: e.target.value })}
            className="h-7 rounded-lg border border-input bg-transparent px-2"
          />
          <span className="text-muted-foreground">→</span>
          <input
            type="date"
            aria-label="End date"
            value={to}
            min={from || undefined}
            onChange={(e) => update({ range: "custom", to: e.target.value })}
            className="h-7 rounded-lg border border-input bg-transparent px-2"
          />
        </div>
      )}
    </div>
  )
}