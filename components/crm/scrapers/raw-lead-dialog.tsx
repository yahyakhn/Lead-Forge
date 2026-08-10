"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { EyeIcon } from "lucide-react"
import { useState } from "react"

export function RawLeadDialog({ externalId, rawData }: { externalId: string | null; rawData: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon" className="size-8" aria-label={`View raw record ${externalId ?? ""}`} />}>
        <EyeIcon className="size-4" />
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">{externalId ?? "Raw record"}</DialogTitle>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed">
          {JSON.stringify(rawData, null, 2)}
        </pre>
      </DialogContent>
    </Dialog>
  )
}