import { requireSession } from "@/lib/auth"
import { PageHeader } from "@/components/crm/page-header"
import { EnrichmentSettingsForm } from "@/components/crm/lead-engine/enrichment-settings-form"
import { getSettings } from "@/lib/lead-engine/enrichment/service"

export default async function EnrichmentSettingsPage() {
  const session = await requireSession()
  if (session.user.role !== "ADMIN") {
    return <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Admin access required to manage enrichment settings.</div>
  }
  const settings = await getSettings(session.organization.id)
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Enrichment settings" description="Control how the enrichment engine crawls and refreshes company and contact data." />
      <div className="rounded-xl border bg-card p-6">
        <EnrichmentSettingsForm
          initial={{
            enabled: settings.enabled,
            maxPagesPerCompany: settings.maxPagesPerCompany,
            maxDepth: settings.maxDepth,
            requestDelayMs: settings.requestDelayMs,
            requestTimeoutMs: settings.requestTimeoutMs,
            freshnessDays: settings.freshnessDays,
            batchMaxLeads: settings.batchMaxLeads,
            allowedDomains: (settings.allowedDomains as string[] | null) ?? [],
          }}
        />
      </div>
    </div>
  )
}
