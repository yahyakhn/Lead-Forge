import { PageHeader } from "@/components/crm/page-header"
import { TableSkeleton } from "@/components/crm/states"

export default function LeadListsLoading() {
  return (
    <div>
      <PageHeader title="Lead Lists" />
      <TableSkeleton rows={8} columns={5} />
    </div>
  )
}