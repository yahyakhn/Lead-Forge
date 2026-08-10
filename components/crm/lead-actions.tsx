"use client"

import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import {
  updateLeadAction,
  deleteLeadAction,
  addLeadToListAction,
  removeLeadFromListAction,
  createActivityAction,
  createDealAction,
  type ActionResult,
} from "@/lib/actions"
import { ActivityForm, AddToListDialog, DealForm, LEAD_PRIORITY_OPTIONS, LEAD_STATUS_OPTIONS } from "@/components/crm/forms"
import { SearchableSelect, type SearchOption } from "@/components/crm/searchable-select"
import { ConfirmDialog } from "@/components/crm/confirm-dialog"
import { Trash2Icon } from "lucide-react"

export function LeadQuickSets({
  leadId,
  status,
  priority,
  ownerId,
  owners,
  className,
}: {
  leadId: string
  status: string
  priority: string
  ownerId: string | null
  owners: SearchOption[]
  className?: string
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const change = (field: "status" | "priority" | "ownerId", value: string) =>
    startTransition(async () => {
      const result = await updateLeadAction(leadId, { [field]: value || undefined })
      if (result.ok) {
        toast.success("Updated")
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className ?? ""}`}>
      <SelectField label="Status" value={status} options={LEAD_STATUS_OPTIONS} onSelect={(v) => change("status", v)} />
      <SelectField label="Priority" value={priority} options={LEAD_PRIORITY_OPTIONS} onSelect={(v) => change("priority", v)} />
      <SelectField
        label="Owner"
        value={ownerId ?? ""}
        options={owners}
        onSelect={(v) => change("ownerId", v)}
        placeholder="Unassigned"
      />
    </div>
  )
}

function SelectField({
  label,
  value,
  options,
  placeholder,
  onSelect,
}: {
  label: string
  value: string
  options: SearchOption[]
  placeholder?: string
  onSelect: (value: string) => void
}) {
  return (
    <div>
      <span className="sr-only">{label}</span>
      <SearchableSelect options={options} value={value} onValueChange={onSelect} placeholder={placeholder ?? label} className="h-8 min-w-32" />
    </div>
  )
}

export function LeadActions({
  leadId,
  leadName,
  lists,
  stages,
  owners,
}: {
  leadId: string
  leadName: string
  lists: { id: string; name: string; member: boolean }[]
  stages: SearchOption[]
  owners: SearchOption[]
}) {
  const router = useRouter()
  const run = async (fn: () => Promise<ActionResult>) => {
    const result = await fn()
    if (result.ok) toast.success("Done")
    else toast.error(result.error)
    return result
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActivityForm action={createActivityAction} leadId={leadId} />
      <AddToListDialog
        lists={lists}
        leadId={leadId}
        add={(listId, l) => run(() => addLeadToListAction(listId, l))}
        remove={(listId, l) => run(() => removeLeadFromListAction(listId, l))}
      />
      <DealForm action={createDealAction} stages={stages} owners={owners} leadId={leadId} defaultName={leadName} />
      <ConfirmDialog
        title="Delete lead"
        description="This permanently deletes the lead and removes it from all lists. Deals and activities stay attached to the company."
        confirmLabel="Delete Lead"
        trigger={
          <Button variant="ghost" size="icon-sm" aria-label="Delete lead">
            <Trash2Icon />
          </Button>
        }
        action={() => deleteLeadAction(leadId)}
        onSuccess={() => router.push("/leads")}
      />
    </div>
  )
}