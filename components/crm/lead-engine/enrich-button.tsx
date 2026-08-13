"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { SparklesIcon } from "lucide-react"
import { enrichCandidateAction, enrichLeadAction, enrichmentJobAction } from "@/lib/actions"

interface RequestState {
  status: string
  errorCode: string | null
  errorMessage: string | null
  fieldsFound: number
  fieldsUpdated: number
  conflictsCount: number
  pagesVisited: number
}

export function EnrichButton({ kind, id, force = false, label = "Enrich" }: { kind: "candidate" | "lead"; id: string; force?: boolean; label?: string }) {
  const router = useRouter()
  const [requestId, setRequestId] = useState<string | null>(null)
  const [request, setRequest] = useState<RequestState | null>(null)
  const [pending, startTransition] = useTransition()

  const start = () =>
    startTransition(async () => {
      const result = kind === "candidate" ? await enrichCandidateAction(id, force) : await enrichLeadAction(id, force)
      if (!result.ok) {
        toast.error(result.error ?? "Enrichment failed")
        return
      }
      if (!result.id) {
        toast.error("Enrichment failed to start")
        return
      }
      setRequestId(result.id)
      setRequest({ status: "QUEUED", errorCode: null, errorMessage: null, fieldsFound: 0, fieldsUpdated: 0, conflictsCount: 0, pagesVisited: 0 })
    })

  const done = request !== null && !["QUEUED", "RUNNING"].includes(request.status)

  useEffect(() => {
    if (!requestId) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const r = await enrichmentJobAction(requestId)
      if (!alive) return
      if (r.ok && r.request) {
        setRequest(r.request)
        if (!["QUEUED", "RUNNING"].includes(r.request.status)) {
          router.refresh()
          if (r.request.status === "COMPLETED") {
            toast.success(`Enrichment done · ${r.request.fieldsUpdated} field(s) updated, ${r.request.conflictsCount} conflict(s).`)
          } else if (r.request.status === "PARTIAL") {
            toast.info(`Enrichment partially completed · ${r.request.fieldsUpdated} field(s) updated.`)
          } else if (r.request.status === "FAILED") {
            toast.error(`Enrichment failed: ${r.request.errorCode ?? "Unknown error"}`)
          }
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
  }, [requestId, router])

  return (
    <Button size="sm" variant={force ? "outline" : "default"} disabled={pending || requestId !== null} onClick={start}>
      <SparklesIcon className="size-4" /> {pending ? "Starting…" : request ? (done ? request.status.toLowerCase() : "Enriching…") : label}
    </Button>
  )
}
