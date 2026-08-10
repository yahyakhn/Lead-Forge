import { executeRun } from "@/lib/lead-engine/worker"
import { runExtractionJob } from "@/lib/lead-engine/extraction/service"

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