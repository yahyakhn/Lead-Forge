import { EmptyState } from "@/components/crm/states"
import { PageHeader } from "@/components/crm/page-header"

export default function FindLeadsPage() {
  return (
    <div>
      <PageHeader title="Find Leads" description="Source new leads from public data." />
      <EmptyState
        title="Coming soon"
        description="Find Leads will let you search for companies that fit an active ICP profile."
      />
    </div>
  )
}