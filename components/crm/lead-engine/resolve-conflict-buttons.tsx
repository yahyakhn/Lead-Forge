"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { resolveConflictAction } from "@/lib/actions"

const RESOLUTIONS: { value: "KEEP_EXISTING" | "ACCEPT_NEW" | "KEEP_BOTH" | "DISMISSED"; label: string; destructive?: boolean }[] = [
  { value: "KEEP_EXISTING", label: "Keep existing" },
  { value: "ACCEPT_NEW", label: "Accept enriched" },
  { value: "KEEP_BOTH", label: "Keep both" },
  { value: "DISMISSED", label: "Dismiss", destructive: true },
]

export function ResolveConflictButtons({ conflictId }: { conflictId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const resolve = (resolution: (typeof RESOLUTIONS)[number]["value"]) =>
    startTransition(async () => {
      const r = await resolveConflictAction(conflictId, resolution)
      if (!r.ok) {
        toast.error(r.error ?? "Resolution failed")
        return
      }
      toast.success("Conflict resolved.")
      router.refresh()
    })

  return (
    <div className="flex flex-wrap gap-1.5">
      {RESOLUTIONS.map((r) => (
        <Button key={r.value} size="sm" variant="outline" className={r.destructive ? "text-destructive" : ""} disabled={pending} onClick={() => resolve(r.value)}>
          {r.label}
        </Button>
      ))}
    </div>
  )
}
