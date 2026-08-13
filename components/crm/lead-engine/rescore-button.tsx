"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { rescoreLeadAction, scoreCandidateAction } from "@/lib/actions"

export function RescoreButton({ kind, id, disabled }: { kind: "candidate" | "lead"; id: string; disabled: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const handleRescore = () => {
    startTransition(async () => {
      const result = kind === "candidate" ? await scoreCandidateAction(id) : await rescoreLeadAction(id)
      if (result.ok) {
        toast.success(kind === "candidate" ? "Candidate rescored." : "Lead rescored.")
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }
  return (
    <Button onClick={handleRescore} disabled={pending || disabled} variant={disabled ? "outline" : "default"}>
      {pending ? "Rescoring…" : "Rescore"}
    </Button>
  )
}
