import { executeRun } from "@/lib/lead-engine/worker"

// In-process development queue. Runs are executed shortly after enqueue in
// this process; cancellation is honored because the worker re-checks the
// run's DB status while executing.
// ponytail: in-process only — swap this module's implementation for
// BullMQ/Redis/Temporal when real scrapers need durable scheduling;
// nothing else in the scraper code touches it.
export interface JobQueue {
  enqueue(runId: string): void
  cancel(runId: string): void
}

export const jobQueue: JobQueue = {
  enqueue(runId: string) {
    setImmediate(async () => {
      try {
        await executeRun(runId)
      } catch (e) {
        console.log(`scraper.queue.error runId=${runId} error=${e instanceof Error ? e.message : "unknown"}`)
      }
    })
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- runId reserved for queue implementations that track in-process jobs
  cancel(_runId: string) {
    // The worker polls the run's status in the DB, so cancelling is driven
    // by cancelRun() updating the run row.
  },
}