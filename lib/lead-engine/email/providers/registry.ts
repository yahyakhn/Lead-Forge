// TASK 014 §55-§56: provider registry. Stateless and org-agnostic; per-org
// enablement lives in EmailSettings.

import type { EmailProvider, EmailProviderCapability, EmailProviderDescriptor } from "@/lib/lead-engine/email/providers/types"

class EmailProviderRegistry {
  private providers = new Map<string, EmailProvider>()

  register(provider: EmailProvider): void {
    this.providers.set(provider.id, provider)
  }

  unregister(id: string): void {
    this.providers.delete(id)
  }

  get(id: string): EmailProvider | undefined {
    return this.providers.get(id)
  }

  list(): EmailProviderDescriptor[] {
    return [...this.providers.values()].map((p) => ({ id: p.id, name: p.name, capabilities: p.capabilities }))
  }

  discovery(id: string) {
    const provider = this.providers.get(id)
    if (!provider || !provider.capabilities.includes("DISCOVERY") || !provider.discover) return undefined
    return provider as EmailProvider & { discover: NonNullable<EmailProvider["discover"]> }
  }

  verification(id: string) {
    const provider = this.providers.get(id)
    if (!provider || !provider.capabilities.includes("VERIFICATION") || !provider.verify) return undefined
    return provider as EmailProvider & { verify: NonNullable<EmailProvider["verify"]> }
  }

  hasCapability(id: string, capability: EmailProviderCapability): boolean {
    return this.providers.get(id)?.capabilities.includes(capability) ?? false
  }
}

export const emailProviderRegistry = new EmailProviderRegistry()

export function registerEmailProvider(provider: EmailProvider): void {
  emailProviderRegistry.register(provider)
}

// Built-in providers self-register on module load so the registry is never
// empty regardless of import order (tests, server, CLI).
import { internalDiscoveryProvider } from "@/lib/lead-engine/email/providers/internal-discovery"
import { internalVerificationProvider } from "@/lib/lead-engine/email/providers/internal-verification"
registerEmailProvider(internalDiscoveryProvider)
registerEmailProvider(internalVerificationProvider)

export const INTERNAL_DISCOVERY_PROVIDER_ID = internalDiscoveryProvider.id
export const INTERNAL_VERIFICATION_PROVIDER_ID = internalVerificationProvider.id
