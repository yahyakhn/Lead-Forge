"use client"

import { Button } from "@/components/ui/button"
import { runExtractionAction } from "@/lib/actions"
import { SparklesIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"

export function RunExtractionButton({ runId, running }: { runId: string; running: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  if (running) {
    return (
      <Button variant="outline" disabled>
        <SparklesIcon className="size-4 animate-pulse" />
        Extracting…
      </Button>
    )
  }
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await runExtractionAction(runId)
          if (result.ok) {
            toast.success("Extraction started.")
            router.refresh()
          } else {
            toast.error(result.error ?? "Something went wrong")
          }
        })
      }
    >
      <SparklesIcon className="size-4" />
      Start Extraction
    </Button>
  )
}