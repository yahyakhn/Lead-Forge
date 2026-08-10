import { prisma } from "@/lib/db"
import { getAdapterForType } from "@/lib/lead-engine/registry"
import { addRunEvent } from "@/lib/lead-engine/runs"
import { ScraperRunEventLevel, ScraperRunStatus } from "@/generated/prisma/enums"
import type { Prisma } from "@/generated/prisma/client"

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && "code" in e && (e as { code?: string }).code === "P2002"
}

async function isRunCancelled(runId: string): Promise<boolean> {
  const run = await prisma.scraperRun.findUnique({ where: { id: runId }, select: { status: true } })
  return run?.status === ScraperRunStatus.CANCELLED
}

async function settleFailure(runId: string, message: string): Promise<void> {
  const current = await prisma.scraperRun.findUnique({ where: { id: runId }, select: { status: true } })
  if (current?.status !== ScraperRunStatus.CANCELLED) {
    await prisma.scraperRun.update({
      where: { id: runId },
      data: { status: ScraperRunStatus.FAILED, finishedAt: new Date(), errorMessage: message },
    })
    await addRunEvent(runId, ScraperRunEventLevel.ERROR, `Run failed: ${message}`)
  }
}

export async function executeRun(runId: string): Promise<void> {
  try {
    const run = await prisma.scraperRun.findUnique({ where: { id: runId } })
    if (!run || run.status === ScraperRunStatus.CANCELLED || run.status === ScraperRunStatus.COMPLETED || run.status === ScraperRunStatus.FAILED) return

    await prisma.scraperRun.update({ where: { id: runId }, data: { status: ScraperRunStatus.RUNNING, startedAt: new Date() } })
    await addRunEvent(runId, ScraperRunEventLevel.INFO, "Run started")
    console.log(`scraper.run.started runId=${runId}`)

    const orgId = run.organizationId
    const source = await prisma.leadSource.findFirst({ where: { id: run.sourceId, { organizationId: orgId } } })
    if (!source) throw new Error("Source not found")
    const adapter = getAdapterForType(source.type)
    if (!adapter) throw new Error(`No adapter available for source type ${source.type}`)
    const validation = adapter.validateConfig(source.config)
    if (!validation.ok) throw new Error(validation.error)

    if (await isRunCancelled(runId)) {
      await addRunEvent(runId, ScraperRunEventLevel.WARNING, "Run cancelled")
      return
    }

    const icp = run.icpId
      ? await prisma.iCPProfile.findUnique({ where: { id: run.icpId }, select: { id: true, name: true, criteria: true } })
      : null
    const testMode = (run.metadata as { test?: boolean } | null | undefined)?.test === true

    const sourceDefinition = { id: source.id, name: source.name, slug: source.slug, type: source.type }
    const targets = await adapter.discover({
      icp: icp ? { id: icp.id, name: icp.name, criteria: icp.criteria as Record<string, unknown> } : null,
      source: sourceDefinition,
      config: source.config,
    })
    await addRunEvent(runId, ScraperRunEventLevel.INFO, `Discovered ${targets.length} targets`)
    console.log(`scraper.discovery.completed runId=${runId} targets=${targets.length}`)

    const result = await adapter.scrape({ runId, organizationId: orgId, source: sourceDefinition, targets, config: source.config, testMode })

    const pageStats = result.stats.pages
    if (pageStats) {
      await prisma.scraperRun.update({
        where: { id: runId },
        data: {
          pagesDiscovered: pageStats.discovered,
          pagesQueued: pageStats.queued,
          pagesProcessed: pageStats.processed,
          pagesSucceeded: pageStats.succeeded,
          pagesFailed: pageStats.failed,
          pagesSkipped: pageStats.skipped,
          heartbeatAt: new Date(),
        },
      })
    }
    if (await isRunCancelled(runId)) {
      await addRunEvent(runId, ScraperRunEventLevel.WARNING, "Run cancelled")
      return
    }
    await addRunEvent(runId, ScraperRunEventLevel.INFO, `Received ${result.records.length} raw records`)
    console.log(`scraper.records.received runId=${runId} records=${result.records.length}`)

    let created = 0
    let duplicate = 0
    let failed = 0
    for (const record of result.records) {
      if (await isRunCancelled(runId)) {
        await addRunEvent(runId, ScraperRunEventLevel.WARNING, "Run cancelled")
        return
      }
      const data = {
        organizationId: orgId,
        sourceId: source.id,
        runId,
        externalId: record.externalId ?? null,
        rawData: record.data as Prisma.InputJsonValue,
        sourceUrl: record.sourceUrl ?? null,
      }
      if (!record.externalId) {
        await prisma.rawLead.create({ data })
        created++
        continue
      }
      try {
        await prisma.rawLead.create({ data })
        created++
      } catch (e) {
        if (isUniqueViolation(e)) duplicate++
        else {
          failed++
          console.log(`scraper.record.failed runId=${runId} externalId=${record.externalId} error=${e instanceof Error ? e.message : "unknown"}`)
        }
      }
    }

    const status =
      failed > 0 && created > 0 ? ScraperRunStatus.PARTIAL : failed > 0 ? ScraperRunStatus.FAILED : ScraperRunStatus.COMPLETED
    const message =
      status === ScraperRunStatus.COMPLETED
        ? `Run completed. ${created} raw records created, ${duplicate} duplicates`
        : status === ScraperRunStatus.PARTIAL
          ? `Run completed with failures: ${created} created, ${duplicate} duplicates, ${failed} failed`
          : `Run failed: ${failed} records could not be stored`

    await prisma.scraperRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        recordsFound: result.stats.discovered || result.records.length,
        recordsProcessed: result.records.length,
        recordsCreated: created,
        recordsUpdated: 0,
        recordsDuplicate: duplicate,
        recordsFailed: failed,
        ...(status === ScraperRunStatus.FAILED ? { errorMessage: message } : {}),
      },
    })
    await addRunEvent(runId, status === ScraperRunStatus.FAILED ? ScraperRunEventLevel.ERROR : ScraperRunEventLevel.INFO, message)
    console.log(`scraper.run.completed runId=${runId} status=${status} created=${created} duplicates=${duplicate} failed=${failed}`)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected failure"
    await settleFailure(runId, message)
    console.log(`scraper.run.failed runId=${runId} error=${message}`)
  }
}