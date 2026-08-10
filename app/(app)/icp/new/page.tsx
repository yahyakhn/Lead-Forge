import { requireSession } from "@/lib/auth"
import { ICPForm } from "@/components/crm/icp/icp-form"
import { PageHeader } from "@/components/crm/page-header"
import { createICPAction } from "@/lib/actions"

export default async function NewICPPage() {
  await requireSession()
  return (
    <div>
      <PageHeader title="New ICP Profile" description="Define the profile of your ideal customer." />
      <ICPForm action={createICPAction} submitLabel="Create ICP" />
    </div>
  )
}