import type { LeadSourceAdapter, SourceAdapterInfo } from "@/lib/lead-engine/types"
import type { LeadSourceType } from "@/generated/prisma/enums"
import { demoAdapter } from "@/lib/lead-engine/adapters/demo"
import { websiteAdapter } from "@/lib/lead-engine/adapters/website"

const adapters = new Map<string, LeadSourceAdapter>()

export function registerSourceAdapter(adapter: LeadSourceAdapter): void {
  if (adapters.has(adapter.id)) throw new Error(`Source adapter "${adapter.id}" is already registered`)
  adapters.set(adapter.id, adapter)
}

export function getSourceAdapter(id: string): LeadSourceAdapter | undefined {
  return adapters.get(id)
}

export function getAdapterForType(type: LeadSourceType): LeadSourceAdapter | undefined {
  for (const adapter of adapters.values()) {
    if (adapter.type === type) return adapter
  }
  return undefined
}

export function listSourceAdapters(): SourceAdapterInfo[] {
  return [...adapters.values()].map(({ id, name, description, type, capabilities }) => ({
    id,
    name,
    description,
    type,
    capabilities,
  }))
}

registerSourceAdapter(demoAdapter)
registerSourceAdapter(websiteAdapter)