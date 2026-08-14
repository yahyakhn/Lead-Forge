import { executeRun } from "@/lib/lead-engine/worker"
import { prisma } from "@/lib/db"
import { runExtractionJob } from "@/lib/lead-engine/extraction/service"
import { runScoringJob } from "@/lib/lead-engine/scoring/service"
import { runEnrichmentJob } from "@/lib/lead-engine/enrichment/service"
import {
  runEmailDiscoveryJob,
  runEmailVerificationBatch,
  runEmailVerificationJob,
} from "@/lib/lead-engine/email/service"
import { processOutboxMessage } from "@/lib/lead-engine/outreach/service"
import { runScheduledSequenceSteps } from "@/lib/lead-engine/sequences/service"

// In-process development queue. Runs are executed shortly after enqueue in
// this process; cancellation is honored because the worker re-checks the
// run's DB status while executing.
// ponytail: in-process only — swap for BullMQ/Redis/Temporal when real
// scrapers need durable scheduling; nothing else here touches it.
export function enqueueRun(runId: string): void {
  setImmediate(async () => {
    try {
      await executeRun(runId)
    } catch (e) {
      console.log(`scraper.queue.error runId=${runId} error=${e instanceof Error ? e.message : "unknown"}`)
    }
  })
}

export function enqueueExtractionRun(extractionRunId: string): void {
  setImmediate(async () => {
    try {
      await runExtractionJob(extractionRunId)
    } catch (e) {
      console.log(`extraction.queue.error runId=${extractionRunId} error=${e instanceof Error ? e.message : "unknown"}`)
    }
  })
}

export function enqueueScoringJob(jobId: string): void {
  setImmediate(async () => {
    try {
      await runScoringJob(jobId)
    } catch (e) {
      console.log(`scoring.queue.error jobId=${jobId} error=${e instanceof Error ? e.message : "unknown"}`)
    }
  })
}

export function enqueueEnrichmentJob(requestId: string): void {
  setImmediate(async () => {
    try {
      await runEnrichmentJob(requestId)
    } catch (e) {
      console.log(`enrichment.queue.error requestId=${requestId} error=${e instanceof Error ? e.message : "unknown"}`)
    }
  })
}

export function enqueueEmailDiscoveryJob(jobId: string): void {
  setImmediate(async () => {
    try {
      await runEmailDiscoveryJob(jobId)
    } catch (e) {
      console.log(`email.discovery.queue.error jobId=${jobId} error=${e instanceof Error ? e.message : "unknown"}`)
    }
  })
}

export function enqueueEmailVerificationJob(jobId: string): void {
  setImmediate(async () => {
    try {
      await runEmailVerificationJob(jobId)
    } catch (e) {
      console.log(`email.verification.queue.error jobId=${jobId} error=${e instanceof Error ? e.message : "unknown"}`)
    }
  })
}

export function enqueueEmailVerificationBatch(batchId: string): void {
  setImmediate(async () => {
    try {
      await runEmailVerificationBatch(batchId)
    } catch (e) {
      console.log(`email.verification.batch.error batchId=${batchId} error=${e instanceof Error ? e.message : "unknown"}`)
    }
  })
}

export function enqueueOutboxMessage(communicationId: string): void {
  setImmediate(async () => {
    try {
      const message = await prisma.outboxMessage.findUnique({ where: { communicationId } })
      if (message && message.status === "PENDING") await processOutboxMessage(message.id)
    } catch (e) {
      console.log(`outbox.queue.error communicationId=${communicationId} error=${e instanceof Error ? e.message : "unknown"}`)
    }
  })
}

// Sequence scheduler: run due enrollments for one org (webhook-triggered) or
// all orgs (dev interval). Claim is atomic, so overlapping scans are safe.
export function enqueueSequenceScan(orgId?: string): void {
  setImmediate(async () => {
    try {
      await runScheduledSequenceSteps(orgId)
    } catch (e) {
      console.log(`sequence.scan.error orgId=${orgId ?? "all"} error=${e instanceof Error ? e.message : "unknown"}`)
    }
  })
}

// ponytail: dev-only 60s poll — swap for a durable scheduler with the real
// job queue; skipped under vitest so tests stay deterministic.
if (!("VITEST" in process.env)) {
  setInterval(() => enqueueSequenceScan(), 60_000)
}