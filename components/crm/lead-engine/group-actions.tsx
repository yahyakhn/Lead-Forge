"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { CheckIcon, XIcon } from "lucide-react"
import { confirmDuplicateAction, rejectDuplicateAction } from "@/lib/actions"

export function GroupActions({ groupId, status }: { groupId: string; status: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await fn()
      if (result.ok) {
        toast.success("Saved.")
        router.refresh()
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })

  if (status !== "PENDING_REVIEW") return null

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={() => act(() => confirmDuplicateAction(groupId))}
      >
        <CheckIcon className="size-4" /> Confirm duplicate
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => act(() => rejectDuplicateAction(groupId))}
      >
        <XIcon className="size-4" /> Not duplicate
      </Button>
    </div>
  )
}