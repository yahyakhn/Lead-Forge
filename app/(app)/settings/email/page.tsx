import { requireSession } from "@/lib/auth"
import { PageHeader } from "@/components/crm/page-header"
import { ErrorState } from "@/components/crm/states"
import { getSettings } from "@/lib/lead-engine/email/service"
import { emailProviderRegistry } from "@/lib/lead-engine/email/providers/registry"
import { updateEmailSettingsAction } from "@/lib/actions-email"
import { DEFAULT_GENERIC_DOMAINS, DEFAULT_ROLE_PREFIXES, DEFAULT_DISPOSABLE_DOMAINS } from "@/lib/lead-engine/email/normalize"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function EmailSettingsPage() {
  const session = await requireSession()
  if (session.user.role !== "ADMIN") {
    return <ErrorState message="Only admins can view or edit email settings." />
  }
  let settings
  try {
    settings = await getSettings(session.organization.id)
  } catch {
    return <ErrorState message="We couldn't load email settings." />
  }

  const asList = (v: unknown, fallback: string[]) => {
    const arr = Array.isArray(v) ? (v as string[]) : []
    return arr.length > 0 ? arr : fallback
  }
  const providers = emailProviderRegistry.list()

  return (
    <div>
      <PageHeader title="Email settings" description="Discovery, verification and rate-limit policy for this organization." />
      <form action={updateEmailSettingsAction} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Capabilities</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" defaultChecked={settings.discoveryEnabled} name="discoveryEnabled" className="h-4 w-4" />
              Email discovery enabled
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" defaultChecked={settings.verificationEnabled} name="verificationEnabled" className="h-4 w-4" />
              Email verification enabled
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" defaultChecked={settings.enrichmentFallback} name="enrichmentFallback" className="h-4 w-4" />
              Queue enrichment when no emails found (reuses TASK 013 crawler)
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Limits &amp; freshness</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {[
              ["verificationCacheDays", "Verification cache (days)", settings.verificationCacheDays] as const,
              ["discoveryFreshnessDays", "Discovery freshness (days)", settings.discoveryFreshnessDays] as const,
              ["batchMaxEmails", "Max batch size", settings.batchMaxEmails] as const,
              ["discoveryRateLimit", "Discovery rate limit / min", settings.discoveryRateLimit] as const,
              ["verificationRateLimit", "Verification rate limit / min", settings.verificationRateLimit] as const,
            ].map(([name, label, value]) => (
              <label key={name} className="flex flex-col gap-1 text-xs text-muted-foreground">
                {label}
                <input name={name} type="number" defaultValue={value} min={1} className="rounded-md border bg-background px-2 py-1.5 text-sm" />
              </label>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Classification lists</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {[
              ["genericDomains", "Generic domains", DEFAULT_GENERIC_DOMAINS] as const,
              ["rolePrefixes", "Role prefixes", DEFAULT_ROLE_PREFIXES] as const,
              ["disposableDomains", "Disposable domains", DEFAULT_DISPOSABLE_DOMAINS] as const,
            ].map(([name, label, fallback]) => (
              <label key={name} className="flex flex-col gap-1 text-xs text-muted-foreground">
                {label} (one per line)
                <textarea name={name} defaultValue={asList((settings as Record<string, unknown>)[name], fallback as string[]).join("\n")} rows={8} className="rounded-md border bg-background px-2 py-1.5 font-mono text-xs" />
              </label>
            ))}
          </CardContent>
        </Card>

        {providers.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Providers</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {providers.map((p) => (
                  <li key={p.id} className="flex items-center justify-between">
                    <span>{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.capabilities.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Save settings</button>
      </form>
    </div>
  )
}