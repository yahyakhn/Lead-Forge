"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { updateAiSettingsAction, clearAiSettingsAction } from "@/lib/actions"

// OpenAI-compatible endpoints; model names are examples — paste the exact
// model id your provider issues (free tiers often use `:free` or `-free`
// suffixes on OpenRouter).
const PROVIDERS: { id: string; label: string; baseUrl: string; model: string; free: boolean }[] = [
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", free: false },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-chat-v3-0324:free", free: true },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", free: true },
  { id: "google", label: "Google AI Studio", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash", free: true },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", free: false },
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest", free: false },
]

export function AiSettingsForm({
  hasSavedKey,
  initialBaseUrl,
  initialModel,
}: {
  hasSavedKey: boolean
  initialBaseUrl: string
  initialModel: string
}) {
  const router = useRouter()
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl)
  const [model, setModel] = useState(initialModel)
  const [pending, startTransition] = useTransition()

  const applyPreset = (preset: (typeof PROVIDERS)[number]) => {
    setBaseUrl(preset.baseUrl)
    setModel(preset.model)
  }

  const save = () =>
    startTransition(async () => {
      if (!apiKey.trim()) {
        toast.error("Enter an API key first.")
        return
      }
      const r = await updateAiSettingsAction({ apiKey, baseUrl, model })
      if (!r.ok) {
        toast.error(r.error ?? "Could not save AI settings")
        return
      }
      toast.success("AI settings saved.")
      setApiKey("")
      router.refresh()
    })

  const clear = () =>
    startTransition(async () => {
      const r = await clearAiSettingsAction()
      if (!r.ok) {
        toast.error(r.error ?? "Could not clear AI settings")
        return
      }
      toast.success("Saved AI settings cleared.")
      router.refresh()
    })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Provider preset:</span>
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => applyPreset(p)}
            className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
          >
            {p.label}
            {p.free ? " (free)" : ""}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        API key
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          type="password"
          autoComplete="new-password"
          placeholder={hasSavedKey ? "••••••••  (leave empty to keep it)" : "sk-…"}
          className="h-9 rounded-md border bg-background px-3 font-mono text-sm text-foreground"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Base URL (OpenAI-compatible endpoint)
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.deepseek.com"
          className="h-9 rounded-md border bg-background px-3 font-mono text-sm text-foreground"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Model
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="deepseek-chat"
          className="h-9 rounded-md border bg-background px-3 font-mono text-sm text-foreground"
        />
      </label>

      <div className="flex items-center gap-3">
        <Button disabled={pending || !apiKey.trim()} onClick={save}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        {hasSavedKey && (
          <Button disabled={pending} variant="outline" onClick={clear}>
            Clear saved settings
          </Button>
        )}
      </div>
    </div>
  )
}