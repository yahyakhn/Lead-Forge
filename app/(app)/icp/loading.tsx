import { PageHeader } from "@/components/crm/page-header"
import { TableSkeleton } from "@/components/crm/states"

export default function ICPLoading() {
  return (
    <div>
      <PageHeader title="ICP Profiles" />
      <TableSkeleton rows={8} columns={5} />
    </div>
  )
}