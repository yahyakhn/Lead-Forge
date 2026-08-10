import { requireSession } from "@/lib/auth"
import { listSourceAdapters } from "@/lib/lead-engine/registry"
import { SourceForm } from "@/components/crm/scrapers/source-form"
import { PageHeader } from "@/components/crm/page-header"
import { createLeadSourceAction } from "@/lib/actions"

export default async function NewSourcePage() {
  await requireSession()
  const adapters = listSourceAdapters()
  return (
    <div>
      <PageHeader title="Add Source" description="Register a lead source that scrapers can pull from." />
      <SourceForm
        action={createLeadSourceAction}
        submitLabel="Create Source"
        adapterOptions={adapters.map((a) => ({ id: a.id, name: a.name, type: a.type, description: a.description }))}
      />
    </div>
  )
}