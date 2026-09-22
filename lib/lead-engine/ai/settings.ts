// Per-org AI provider settings. A DB row overrides the AI_API_KEY /
// AI_BASE_URL / AI_MODEL env vars; no row means env rules as before.
// Server-only: imports prisma, never pull into a client bundle.

import { prisma } from "@/lib/db"
import type { AIProvider } from "@/lib/lead-engine/ai/types"
import { getAIProvider } from "@/lib/lead-engine/ai/registry"
import { DeepSeekProvider } from "@/lib/lead-engine/ai/providers/deepseek"

export interface AiSettings {
  apiKey: string | null
  baseUrl: string | null
  model: string | null
}

export async function getAiSettings(orgId: string): Promise<AiSettings | null> {
  return prisma.aiSettings.findUnique({
    where: { organizationId: orgId },
    select: { apiKey: true, baseUrl: true, model: true },
  })
}

export async function updateAiSettings(
  orgId: string,
  input: { apiKey: string; baseUrl: string; model: string },
): Promise<void> {
  const apiKey = input.apiKey.trim()
  if (!apiKey) throw new Error("AI API key is required")
  const baseUrl = input.baseUrl.trim() || null
  const model = input.model.trim() || null
  await prisma.aiSettings.upsert({
    where: { organizationId: orgId },
    create: { organizationId: orgId, apiKey, baseUrl, model },
    update: { apiKey, baseUrl, model },
  })
}

export async function clearAiSettings(orgId: string): Promise<void> {
  await prisma.aiSettings.deleteMany({ where: { organizationId: orgId } })
}

// Org-scoped provider: the org's saved API key/base URL/model (settings page)
// win over env vars. Only deepseek accepts a per-org config today.
export async function getAIProviderForOrg(orgId: string): Promise<AIProvider> {
  const settings = await getAiSettings(orgId)
  if (settings?.apiKey) {
    return new DeepSeekProvider({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl ?? undefined,
      model: settings.model ?? undefined,
    })
  }
  return getAIProvider()
}

// Same as getAIProviderForOrg, plus the resolved model name (DB > env >
// default) for callers that persist which model produced a result.
export async function getOrgAIProvider(orgId: string): Promise<{ provider: AIProvider; model: string }> {
  const settings = await getAiSettings(orgId)
  const model = settings?.model ?? process.env.AI_MODEL?.trim() ?? "deepseek-chat"
  const provider = settings?.apiKey
    ? new DeepSeekProvider({
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl ?? undefined,
        model: settings.model ?? undefined,
      })
    : getAIProvider()
  return { provider, model }
}