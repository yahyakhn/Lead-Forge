import { requireSession } from "@/lib/auth"
import { PageHeader } from "@/components/crm/page-header"
import { ErrorState } from "@/components/crm/states"
import { getAiSettings } from "@/lib/lead-engine/ai/settings"
import { AiSettingsForm } from "@/components/crm/lead-engine/ai-settings-form"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function AiSettingsPage() {
  const session = await requireSession()
  if (session.user.role !== "ADMIN") {
    return <ErrorState message="Only admins can view or edit AI settings." />
  }
  let settings
  try {
    settings = await getAiSettings(session.organization.id)
  } catch {
    return <ErrorState message="We couldn't load AI settings." />
  }

  return (
    <div>
      <PageHeader title="AI settings" description="API key, endpoint and model used by classification, research and extraction." />
      <Card>
        <CardHeader><CardTitle>Provider</CardTitle></CardHeader>
        <CardContent>
          <AiSettingsForm
            hasSavedKey={Boolean(settings?.apiKey)}
            initialBaseUrl={settings?.baseUrl ?? process.env.AI_BASE_URL ?? "https://api.deepseek.com"}
            initialModel={settings?.model ?? process.env.AI_MODEL ?? "deepseek-chat"}
          />
        </CardContent>
      </Card>
    </div>
  )
}