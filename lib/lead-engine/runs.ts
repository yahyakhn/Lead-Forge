import { prisma } from "@/lib/db"
import { parsePagination } from "@/lib/crm/pagination"
import { ScraperRunEventLevel, ScraperRunStatus } from "@/generated/prisma/enums"
import type { Prisma } from "@/generated/prisma/client"

export async function createRun(orgId: string, _userId: string, input: { sourceId: string; icpId?: string; test?: boolean; name?: string }) {
  const source = await prisma.leadSource.findFirst({ where: { id: input.sourceId, organizationId: orgId, isActive: true }, select: { id: true } })
  if (!source) throw new Error("Source not found or inactive")
  let icp = null
  if (input.icpId) {
    icp = await prisma.iCPProfile.findFirst({ where: { id: input.icpId, organizationId: orgId }, select: { id: true, name: true } })
    if (!icp) throw new Error("ICP not found in this organization")
  }
  const metadata = {
    ...(icp ? { icpName: icp.name } : {}),
    ...(input.test ? { test: true } : {}),
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
  }
  const run = await prisma.scraperRun.create({
    data: {
      organizationId: orgId,
      sourceId: source.id,
      ...(icp ? { icpId: icp.id } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    },
  })
  await addRunEvent(run.id, ScraperRunEventLevel.INFO, "Run queued")
  return run
}

export async function getRun(orgId: string, id: string) {
  return prisma.scraperRun.findFirst({
    where: { id, organizationId: orgId },
    include: {
      source: { select: { id: true, name: true, type: true } },
      icp: { select: { id: true, name: true } },
      _count: { select: { rawLeads: true, rawPages: true } },
    },
  })
}

export interface RunEventFilters {
  page?: number
  pageSize?: number
  level?: ScraperRunEventLevel
}

export function runDisplayName(run: { id: string; metadata: unknown }, fallback = ""): string {
  const meta = (run.metadata ?? {}) as { name?: string } | null
  return meta?.name?.trim() || `${fallback}#${run.id.slice(-6)}`
}

export async function listRunEvents(orgId: string, runId: string, filters: RunEventFilters = {}) {
  const { page, pageSize } = parsePagination(filters)
  const run = await prisma.scraperRun.findFirst({ where: { id: runId, organizationId: orgId }, select: { id: true } })
  if (!run) return null
  const where: Prisma.ScraperRunEventWhereInput = { runId, ...(filters.level ? { level: filters.level } : {}) }
  const [total, data] = await Promise.all([
    prisma.scraperRunEvent.count({ where }),
    prisma.scraperRunEvent.findMany({ where, orderBy: { createdAt: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ])
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function listRawPages(orgId: string, runId: string, filters: { page?: number; pageSize?: number } = {}) {
  const { page, pageSize } = parsePagination(filters)
  const where: Prisma.RawPageWhereInput = { runId, organizationId: orgId }
  const [total, data] = await Promise.all([
    prisma.rawPage.count({ where }),
    prisma.rawPage.findMany({
      where,
      orderBy: { fetchedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, url: true, statusCode: true, title: true, contentType: true, errorCategory: true, fetchedAt: true },
    }),
  ])
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function getRawPage(orgId: string, id: string) {
  return prisma.rawPage.findFirst({ where: { id, organizationId: orgId } })
}

export interface RunFilters {
  page?: number
  pageSize?: number
  status?: ScraperRunStatus
}

export async function listRuns(orgId: string, filters: RunFilters = {}) {
  const { page, pageSize } = parsePagination(filters)
  const where: Prisma.ScraperRunWhereInput = {
    organizationId: orgId,
    ...(filters.status ? { status: filters.status } : {}),
  }
  const [total, data] = await Promise.all([
    prisma.scraperRun.count({ where }),
    prisma.scraperRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        source: { select: { id: true, name: true, type: true } },
        icp: { select: { id: true, name: true } },
      },
    }),
  ])
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function cancelRun(orgId: string, runId: string): Promise<boolean> {
  const run = await prisma.scraperRun.findFirst({ where: { id: runId, organizationId: orgId }, select: { id: true, status: true } })
  if (!run) throw new Error("Run not found in this organization")
  if (run.status !== ScraperRunStatus.QUEUED && run.status !== ScraperRunStatus.RUNNING) return false
  await prisma.scraperRun.update({ where: { id: runId }, data: { status: ScraperRunStatus.CANCELLED, finishedAt: new Date() } })
  await addRunEvent(runId, ScraperRunEventLevel.WARNING, "Run cancelled")
  return true
}

export async function addRunEvent(runId: string, level: ScraperRunEventLevel, message: string, metadata?: Record<string, unknown>) {
  return prisma.scraperRunEvent.create({
    data: {
      runId,
      level,
      message,
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata: metadata as Prisma.InputJsonValue } : {}),
    },
  })
}

export async function listRawLeads(orgId: string, runId: string, filters: { page?: number; pageSize?: number } = {}) {
  const { page, pageSize } = parsePagination(filters)
  const where: Prisma.RawLeadWhereInput = { runId, organizationId: orgId }
  const [total, data] = await Promise.all([
    prisma.rawLead.count({ where }),
    prisma.rawLead.findMany({
      where,
      orderBy: { discoveredAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, externalId: true, rawData: true, sourceUrl: true, discoveredAt: true },
    }),
  ])
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}