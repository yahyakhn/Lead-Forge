import { notFound } from "next/navigation"
import { requireSession } from "@/lib/auth"
import { getICP } from "@/lib/crm/icp"
import { ICPForm } from "@/components/crm/icp/icp-form"
import { PageHeader } from "@/components/crm/page-header"
import { ErrorState } from "@/components/crm/states"
import { updateICPAction } from "@/lib/actions"

export default async function EditICPPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const { id } = await params

  let icp
  try {
    icp = await getICP(session.organization.id, id)
  } catch {
    return <ErrorState message="We couldn't load this ICP profile." />
  }
  if (!icp) notFound()

  return (
    <div>
      <PageHeader title="Edit ICP Profile" description={icp.name} />
      <ICPForm
        action={updateICPAction.bind(null, icp.id)}
        submitLabel="Save Changes"
        initial={{ name: icp.name, description: icp.description, criteria: icp.criteria }}
      />
    </div>
  )
}