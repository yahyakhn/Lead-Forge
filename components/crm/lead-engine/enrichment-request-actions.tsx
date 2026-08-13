"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cancelEnrichmentAction, retryEnrichmentAction } from "@/lib/actions"

export function EnrichmentRequestActions({ requestId, status }: { requestId: string; status: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const cancel = () =>
    startTransition(async () => {
      const r = await cancelEnrichmentAction(requestId)
      if (!r.ok) {
        toast.error(r.error ?? "Cancel failed")
        return
      }
      toast.success("Enrichment cancelled.")
      router.refresh()
    })

  const retry = () =>
    startTransition(async () => {
      const r = await retryEnrichmentAction(requestId)
      if (!r.ok) {
        toast.error(r.error ?? "Retry failed")
        return
      }
      toast.success("Enrichment requeued.")
      router.refresh()
    })

  return (
    <div className="flex gap-1.5">
      {["QUEUED", "RUNNING"].includes(status) ? (
        <Button size="sm" variant="outline" className="text-destructive" disabled={pending} onClick={cancel}>
          Cancel
        </Button>
      ) : null}
      {status === "FAILED" ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={retry}>
          Retry
        </Button>
      ) : null}
    </div>
  )
}
