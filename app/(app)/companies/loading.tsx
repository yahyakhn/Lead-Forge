import { PageHeader } from "@/components/crm/page-header"
import { TableSkeleton } from "@/components/crm/states"

export default function CompaniesLoading() {
  return (
    <div>
      <PageHeader title="Companies" />
      <TableSkeleton rows={10} columns={9} />
    </div>
  )
}