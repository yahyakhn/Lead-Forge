// TASK 013: provider registry (§4). Register/unregister/get/list/
// capability checks. Enabled state lives in org EnrichmentSettings, so the
// registry itself stays stateless and org-agnostic.

import type { EnrichmentCapability, EnrichmentProvider } from "@/lib/lead-engine/enrichment/providers/types"

class EnrichmentProviderRegistry {
  private providers = new Map<string, EnrichmentProvider>()

  register(provider: EnrichmentProvider): void {
    this.providers.set(provider.id, provider)
  }

  unregister(id: string): void {
    this.providers.delete(id)
  }

  get(id: string): EnrichmentProvider | undefined {
    return this.providers.get(id)
  }

  list(): EnrichmentProvider[] {
    return [...this.providers.values()]
  }

  hasCapability(id: string, capability: EnrichmentCapability): boolean {
    return this.providers.get(id)?.capabilities.includes(capability) ?? false
  }
}

export const enrichmentProviderRegistry = new EnrichmentProviderRegistry()

export function registerProvider(provider: EnrichmentProvider): void {
  enrichmentProviderRegistry.register(provider)
}

// Built-in providers self-register on module load so the registry is never
// empty regardless of import order (tests, server, CLI).
import { websiteEnrichmentProvider } from "@/lib/lead-engine/enrichment/providers/website"
registerProvider(websiteEnrichmentProvider)
