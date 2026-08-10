"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/crm/confirm-dialog"
import {
  activateLeadSourceAction,
  deactivateLeadSourceAction,
  deleteLeadSourceAction,
} from "@/lib/actions"
import { PowerIcon, PowerOffIcon, Trash2Icon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"

export function SourceActions({
  sourceId,
  name,
  isActive,
  showLabels = false,
}: {
  sourceId: string
  name: string
  isActive: boolean
  showLabels?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const commit = (action: () => Promise<{ ok: boolean; error?: string }>, successMessage: string) =>
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        toast.success(successMessage)
        router.refresh()
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })

  const cls = showLabels ? "h-8 px-3 text-sm gap-1.5" : "size-8 p-0"
  return (
    <div className={cn("flex items-center", showLabels ? "gap-2" : "gap-1")}>
      {isActive ? (
        <Button
          variant="ghost"
          size={showLabels ? "sm" : "icon"}
          className={cls}
          disabled={pending}
          onClick={() => commit(() => deactivateLeadSourceAction(sourceId), "Source deactivated.")}
          aria-label="Deactivate source"
        >
          <PowerOffIcon className="size-4 text-muted-foreground" />
          {showLabels ? "Deactivate" : null}
        </Button>
      ) : (
        <Button
          variant="ghost"
          size={showLabels ? "sm" : "icon"}
          className={cls}
          disabled={pending}
          onClick={() => commit(() => activateLeadSourceAction(sourceId), "Source activated.")}
          aria-label="Activate source"
        >
          <PowerIcon className="size-4" />
          {showLabels ? "Activate" : null}
        </Button>
      )}
      <ConfirmDialog
        trigger={
          <Button
            variant="ghost"
            size={showLabels ? "sm" : "icon"}
            className={`${cls} text-destructive hover:text-destructive`}
            aria-label="Delete source"
          >
            <Trash2Icon className="size-4" />
            {showLabels ? "Delete" : null}
          </Button>
        }
        title="Delete Source"
        description={`Delete "${name}"? Sources with runs or raw records cannot be deleted.`}
        confirmLabel="Delete"
        action={() => deleteLeadSourceAction(sourceId)}
        onSuccess={() => router.refresh()}
        redirectTo={showLabels ? "/scrapers/sources" : undefined}
      />
    </div>
  )
}