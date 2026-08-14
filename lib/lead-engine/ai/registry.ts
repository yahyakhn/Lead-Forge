// TASK 016: provider factory/registry (spec §8). Selection is driven by
// AI_PROVIDER; default deepseek. Factories are registered so additional
// providers can be added later without touching callers.

import { AIError } from "@/lib/lead-engine/ai/types"
import type { AIProvider } from "@/lib/lead-engine/ai/types"
import { DeepSeekProvider } from "@/lib/lead-engine/ai/providers/deepseek"
import { MockAIProvider } from "@/lib/lead-engine/ai/providers/mock"

type AIProviderFactory = () => AIProvider

const factories = new Map<string, AIProviderFactory>()

export function registerAIProvider(id: string, factory: AIProviderFactory): void {
  factories.set(id.toLowerCase(), factory)
}

export function getAIProvider(): AIProvider {
  const raw = process.env.AI_PROVIDER
  const id = (raw && raw.trim() ? raw : "deepseek").trim().toLowerCase()
  const factory = factories.get(id)
  if (!factory) {
    throw new AIError("AI_CONFIGURATION_ERROR", `Unknown AI_PROVIDER "${id}" (supported: ${[...factories.keys()].join(", ")})`)
  }
  return factory()
}

registerAIProvider("deepseek", () => new DeepSeekProvider())
registerAIProvider("mock", () => new MockAIProvider())