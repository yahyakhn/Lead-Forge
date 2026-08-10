"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { LayersIcon } from "lucide-react"
import { deduplicateRunAction } from "@/lib/actions"

export function RunDeduplicationButton({ runId }: { runId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await deduplicateRunAction(runId)
          if (result.ok) {
            toast.success("Duplicate resolution run completed.")
            router.refresh()
          } else {
            toast.error(result.error ?? "Something went wrong")
          }
        })
      }
    >
      <LayersIcon className="size-4" />
      Resolve Duplicates
    </Button>
  )
}