"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { GaugeIcon } from "lucide-react"
import { bulkScoreCandidatesAction, scoringJobAction } from "@/lib/actions"

interface Row {
  id: string
  label: string
}

interface JobState {
  status: string
  total: number
  processed: number
  scored: number
  failed: number
  hot: number
  good: number
  maybe: number
  low: number
}

export function ScoreSelectedBar({ candidates }: { candidates: Row[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<JobState | null>(null)
  const [pending, startTransition] = useTransition()

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  const checkedIds = [...selected]

  const start = () =>
    startTransition(async () => {
      if (checkedIds.length === 0) return
      const result = await bulkScoreCandidatesAction(checkedIds)
      if (!result.ok) {
        toast.error(result.error ?? "Scoring failed")
        return
      }
      if (!result.id) {
        toast.error("Scoring failed to start")
        return
      }
      setJobId(result.id)
      setJob({ status: "PENDING", total: checkedIds.length, processed: 0, scored: 0, failed: 0, hot: 0, good: 0, maybe: 0, low: 0 })
      setSelected(new Set())
    })

  const done = job !== null && job.status !== "PENDING" && job.status !== "RUNNING" && job.status !== "QUEUED"

  useEffect(() => {
    if (!jobId) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const r = await scoringJobAction(jobId)
      if (!alive) return
      if (r.ok && r.job) {
        setJob(r.job)
        if (r.job.status === "COMPLETED" || r.job.status === "FAILED") {
          router.refresh()
          toast.success("Bulk scoring finished.")
          return
        }
      }
      timer = setTimeout(poll, 1500)
    }
    void poll()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [jobId, router])

  const pct = job ? (job.total > 0 ? Math.min(100, Math.round((job.processed / job.total) * 100)) : 0) : 0

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {candidates.length} candidates · {selected.size} selected
        </span>
        <Button size="sm" disabled={pending || selected.size === 0 || jobId !== null} onClick={start}>
          <GaugeIcon className="size-4" /> Score selected
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {candidates.map((c) => (
          <label
            key={c.id}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${selected.has(c.id) ? "border-primary bg-primary/10" : "bg-muted/40"}`}
          >
            <input type="checkbox" className="size-3.5 accent-primary" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
            {c.label}
          </label>
        ))}
      </div>

      <Dialog open={jobId !== null} onOpenChange={(open) => !open && setJobId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{done ? "Scoring complete" : "Scoring candidates"}</DialogTitle>
          </DialogHeader>
          {job ? (
            <div className="space-y-3 text-sm">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-muted-foreground">
                {job.processed} / {job.total} processed · {job.scored} scored · {job.failed} failed
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="text-emerald-600">{job.hot} hot</span> · <span className="text-green-600">{job.good} good</span> ·{" "}
                <span className="text-amber-600">{job.maybe} maybe</span> · <span className="text-red-600">{job.low} low</span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Starting…</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}