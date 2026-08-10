"use client"

import { Button } from "@/components/ui/button"
import { SearchableSelect, type SearchOption } from "@/components/crm/searchable-select"
import { runScraperAction } from "@/lib/actions"
import { PlayIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

export function TestSourceButton({ sourceId, icpOptions }: { sourceId: string; icpOptions: SearchOption[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [icpId, setIcpId] = useState("")
  const [error, setError] = useState("")

  const run = () => {
    setError("")
    startTransition(async () => {
      const result = await runScraperAction(sourceId, icpId || null, true)
      if (!result.ok) {
        setError(result.error ?? "Something went wrong")
        return
      }
      if (result.redirectTo) router.push(result.redirectTo)
    })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <SearchableSelect options={icpOptions} value={icpId} onValueChange={setIcpId} placeholder="ICP (optional)" className="w-56" />
        <Button onClick={run} disabled={pending}>
          <PlayIcon className="size-4" />
          {pending ? "Starting…" : "Test Source"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Creates a scraper run and executes it now. Test runs use small bounded limits (max 3 pages, depth 1, concurrency 1) regardless of
          the source configuration.
        </p>
      )}
    </div>
  )
}