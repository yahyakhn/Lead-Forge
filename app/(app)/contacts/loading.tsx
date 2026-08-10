import { PageHeader } from "@/components/crm/page-header"
import { TableSkeleton } from "@/components/crm/states"

export default function ContactsLoading() {
  return (
    <div>
      <PageHeader title="Contacts" />
      <TableSkeleton rows={10} columns={7} />
    </div>
  )
}