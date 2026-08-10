import { notFound } from "next/navigation"
import { requireSession } from "@/lib/auth"
import { getSource } from "@/lib/lead-engine/sources"
import { listSourceAdapters } from "@/lib/lead-engine/registry"
import { SourceForm } from "@/components/crm/scrapers/source-form"
import { PageHeader } from "@/components/crm/page-header"
import { ErrorState } from "@/components/crm/states"
import { updateLeadSourceAction } from "@/lib/actions"

export default async function EditSourcePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const { id } = await params

  let source
  try {
    source = await getSource(session.organization.id, id)
  } catch {
    return <ErrorState message="We couldn't load this source." />
  }
  if (!source) notFound()

  return (
    <div>
      <PageHeader title="Edit Source" description={source.name} />
      <SourceForm
        action={updateLeadSourceAction.bind(null, source.id)}
        submitLabel="Save Changes"
        adapterOptions={listSourceAdapters().map((a) => ({ id: a.id, name: a.name, type: a.type, description: a.description }))}
        initial={{
          name: source.name,
          description: source.description ?? "",
          type: source.type,
          isActive: source.isActive,
          config: source.config as Record<string, unknown>,
        }}
      />
    </div>
  )
}