"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { EyeIcon } from "lucide-react"
import { previewScoreAction } from "@/lib/actions"
import type { ScoredResult } from "@/lib/lead-engine/scoring/service"
import type { CriterionResult } from "@/lib/lead-engine/scoring/engine"
import { ScoreBadge, QualificationBadge } from "@/components/crm/badges"
import { ScoreBreakdown } from "@/components/crm/score-breakdown"
import { formatDateTime } from "@/lib/format"

export function PreviewScoreButton({ kind, id }: { kind: "candidate" | "lead"; id: string }) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<ScoredResult | null>(null)
  const [pending, startTransition] = useTransition()

  const load = () =>
    startTransition(async () => {
      const r = await previewScoreAction(kind === "candidate" ? { candidateId: id } : { leadId: id })
      if (!r.ok || !r.result) {
        toast.error(r.error ?? "Preview failed")
        return
      }
      setResult(r.result)
    })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next && !result) load()
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline"><EyeIcon className="size-4" /> Preview score</Button>} />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Score preview</DialogTitle>
        </DialogHeader>
        {pending && !result ? (
          <p className="text-sm text-muted-foreground">Scoring…</p>
        ) : result ? (
          <ScorePreview result={result} />
        ) : (
          <p className="text-sm text-muted-foreground">Close and try again.</p>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ScorePreview({ result }: { result: ScoredResult }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <ScoreBadge score={result.icpScore} />
        <ScoreBadge score={result.overallScore} />
        <QualificationBadge qualification={result.qualification} />
        <span className="text-xs text-muted-foreground">v{result.modelVersion}</span>
      </div>

      <ScoreBreakdown
        breakdown={result.breakdown as CriterionResult[]}
        reasons={result.reasons}
      />

      {result.icpProfileId ? (
        <p className="text-xs text-muted-foreground">
          Active ICP profile <code className="rounded bg-muted px-1">{result.icpProfileId.slice(-8)}</code> · {formatDateTime(new Date())}
        </p>
      ) : null}
    </div>
  )
}