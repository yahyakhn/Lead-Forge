"use client"

import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/crm/confirm-dialog"
import type { ActionResult } from "@/lib/actions"
import { CopyIcon, PowerIcon, PowerOffIcon, Trash2Icon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { activateICPAction, deactivateICPAction, deleteICPAction, duplicateICPAction } from "@/lib/actions"
import { cn } from "@/lib/utils"

export function ICPActions({
  profileId,
  name,
  isActive,
  showLabels = false,
  redirectToDelete,
}: {
  profileId: string
  name: string
  isActive: boolean
  showLabels?: boolean
  redirectToDelete?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const commit = (action: () => Promise<ActionResult>, successMessage: string) =>
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        toast.success(successMessage)
        router.refresh()
      } else {
        toast.error(result.error ?? "Something went wrong")
      }
    })

  const guard = ({ text, disabled }: { text: string; disabled: boolean }) =>
    cn(
      "gap-1.5",
      text.length > 9 ? "px-2.5 text-xs" : "",
      showLabels ? "h-8 px-3 text-sm" : "size-8 p-0",
      disabled && "pointer-events-none opacity-50",
    )

  return (
    <div className={cn("flex items-center", showLabels ? "gap-2" : "gap-1")}>
      <Button
        variant="ghost"
        size={showLabels ? "sm" : "icon"}
        className={guard({ text: "Duplicate", disabled: pending })}
        onClick={() => commit(() => duplicateICPAction(profileId), "ICP duplicated.")}
        aria-label="Duplicate ICP"
      >
        <CopyIcon className="size-4" />
        {showLabels ? "Duplicate" : null}
      </Button>
      {isActive ? (
        <Button
          variant="ghost"
          size={showLabels ? "sm" : "icon"}
          className={guard({ text: "Deactivate", disabled: pending })}
          onClick={() => commit(() => deactivateICPAction(profileId), "ICP deactivated.")}
          aria-label="Deactivate ICP"
        >
          <PowerOffIcon className="size-4 text-muted-foreground" />
          {showLabels ? "Deactivate" : null}
        </Button>
      ) : (
        <Button
          variant="ghost"
          size={showLabels ? "sm" : "icon"}
          className={guard({ text: "Activate", disabled: pending })}
          onClick={() => commit(() => activateICPAction(profileId), "ICP activated.")}
          aria-label="Activate ICP"
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
            className={cn("gap-1.5 text-destructive hover:text-destructive", showLabels ? "h-8 px-3 text-sm" : "size-8 p-0")}
            aria-label="Delete ICP"
          >
            <Trash2Icon className="size-4" />
            {showLabels ? "Delete" : null}
          </Button>
        }
        title="Delete ICP"
        description={`Delete "${name}"? This cannot be undone.`}
        confirmLabel="Delete"
        action={() => deleteICPAction(profileId)}
        onSuccess={() => router.refresh()}
        redirectTo={redirectToDelete}
      />
    </div>
  )
}