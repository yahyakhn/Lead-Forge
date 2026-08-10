"use client"

import { Button } from "@/components/ui/button"
import { cancelRunAction } from "@/lib/actions"
import { XCircleIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"

export function CancelRunButton({ runId }: { runId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await cancelRunAction(runId)
          if (result.ok) {
            toast.success("Run cancelled.")
            router.refresh()
          } else {
            toast.error(result.error ?? "Something went wrong")
          }
        })
      }
    >
      <XCircleIcon className="size-4" />
      Cancel Run
    </Button>
  )
}