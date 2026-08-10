import { PageHeader } from "@/components/crm/page-header"
import { TableSkeleton } from "@/components/crm/states"

export default function LeadsLoading() {
  return (
    <div>
      <PageHeader title="Leads" />
      <TableSkeleton rows={10} columns={7} />
    </div>
  )
}