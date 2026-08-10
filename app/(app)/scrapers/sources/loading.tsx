import { PageHeader } from "@/components/crm/page-header"
import { TableSkeleton } from "@/components/crm/states"

export default function SourcesLoading() {
  return (
    <div>
      <PageHeader title="Lead Sources" />
      <TableSkeleton rows={8} columns={6} />
    </div>
  )
}