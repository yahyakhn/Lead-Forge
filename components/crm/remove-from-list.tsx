"use client"

import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { removeLeadFromListAction } from "@/lib/actions"
import { MinusIcon } from "lucide-react"

export function RemoveFromList({ listId, leadId }: { listId: string; leadId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label="Remove from list"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await removeLeadFromListAction(listId, leadId)
          if (result.ok) {
            toast.success("Removed from list")
            router.refresh()
          } else {
            toast.error(result.error)
          }
        })
      }
    >
      <MinusIcon />
    </Button>
  )
}