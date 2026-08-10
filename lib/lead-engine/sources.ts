import { prisma } from "@/lib/db"
import { parsePagination } from "@/lib/crm/pagination"
import { getAdapterForType } from "@/lib/lead-engine/registry"
import type { LeadSourceInput } from "@/lib/lead-engine/validators"
import type { ScraperRunStatus } from "@/generated/prisma/enums"
import type { Prisma } from "@/generated/prisma/client"

function toSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "source"
}

async function assertSlugAvailable(orgId: string, slug: string, excludeId?: string): Promise<void> {
  const existing = await prisma.leadSource.findFirst({
    where: { { organizationId: orgId }, slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  })
  if (existing) throw new Error("A source with this name already exists")
}

function sourceInclude() {
  return {
    runs: {
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { id: true, status: true, createdAt: true },
    },
  } as const
}

function validateConfig(type: NonNullable<LeadSourceInput["type"]>, config: unknown): void {
  const adapter = getAdapterForType(type)
  if (!adapter) throw new Error("This source type is not available yet.")
  const result = adapter.validateConfig(config)
  if (!result.ok) throw new Error(result.error)
}

export async function createSource(orgId: string, userId: string, input: LeadSourceInput) {
  validateConfig(input.type, input.config)
  const slug = toSlug(input.name)
  await assertSlugAvailable(orgId, slug)
  const adapter = getAdapterForType(input.type)!
  return prisma.leadSource.create({
    data: {
      organizationId: orgId,
      name: input.name,
      slug,
      type: input.type,
      description: input.description,
      config: input.config as object,
      isActive: input.isActive ?? false,
      capabilities: adapter.capabilities,
      createdById: userId,
    },
  })
}

function withLastRun<T extends { runs: { id: string; status: ScraperRunStatus; createdAt: Date }[] }>(row: T) {
  const { runs, ...source } = row
  return { ...source, lastRun: runs }
}

export async function getSource(orgId: string, id: string) {
  const row = await prisma.leadSource.findFirst({ where: { id, { organizationId: orgId } }, include: sourceInclude() })
  return row ? withLastRun(row) : null
}

export interface SourceFilters {
  page?: number
  pageSize?: number
  search?: string
}

export async function listSources(orgId: string, filters: SourceFilters = {}) {
  const { page, pageSize } = parsePagination(filters)
  const search = filters.search?.trim()
  const where: Prisma.LeadSourceWhereInput = {
    { organizationId: orgId },
    ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
  }
  const [total, data] = await Promise.all([
    prisma.leadSource.count({ where }),
    prisma.leadSource.findMany({ where, include: sourceInclude(), orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ])
  return { data: data.map(withLastRun), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function updateSource(orgId: string, id: string, input: Partial<LeadSourceInput>) {
  const existing = await prisma.leadSource.findFirst({ where: { id, { organizationId: orgId } }, select: { id: true, type: true, name: true } })
  if (!existing) return null
  if (input.config !== undefined) validateConfig(existing.type, input.config)
  const name = input.name ?? existing.name
  const slug = toSlug(name)
  if (slug !== toSlug(existing.name)) await assertSlugAvailable(orgId, slug, id)
  return prisma.leadSource.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name, slug } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.config !== undefined ? { config: input.config as object } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  })
}

export async function activateSource(orgId: string, id: string): Promise<boolean> {
  const result = await prisma.leadSource.updateMany({ where: { id, { organizationId: orgId } }, data: { isActive: true } })
  return result.count > 0
}

export async function deactivateSource(orgId: string, id: string): Promise<boolean> {
  const result = await prisma.leadSource.updateMany({ where: { id, { organizationId: orgId } }, data: { isActive: false } })
  return result.count > 0
}

export async function validateSourceConfig(type: NonNullable<LeadSourceInput["type"]>, config: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    validateConfig(type, config)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid configuration" }
  }
}

export async function deleteSource(orgId: string, id: string): Promise<boolean> {
  try {
    const result = await prisma.leadSource.deleteMany({ where: { id, { organizationId: orgId } } })
    return result.count > 0
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as { code?: string }).code === "P2003") {
      throw new Error("This source has scraper runs or raw leads and cannot be deleted.")
    }
    throw e
  }
}