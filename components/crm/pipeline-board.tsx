"use client"

import Link from "next/link"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { moveLeadToStageAction } from "@/lib/actions"
import { SearchableSelect } from "@/components/crm/searchable-select"
import { ScoreBadge, PriorityBadge } from "@/components/crm/badges"

export interface BoardLead {
  id: string
  companyName: string | null
  companyDomain: string | null
  contactName: string | null
  score: number | null
  priority: string
  ownerName: string | null
}

export interface BoardStage {
  id: string
  name: string
  slug: string
  color: string | null
}

export function PipelineBoard({
  stages,
  leadsByStatus,
}: {
  stages: BoardStage[]
  leadsByStatus: Record<string, BoardLead[]>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0" aria-busy={pending}>
      {stages.map((stage) => {
        const leads = leadsByStatus[stage.slug.toUpperCase()] ?? []
        const moveOptions = stages
          .filter((s) => s.id !== stage.id)
          .map((s) => ({ value: s.id, label: s.name }))
        return (
          <section key={stage.id} className="flex w-72 shrink-0 flex-col rounded-xl border bg-muted/30">
            <header className="flex items-center justify-between gap-2 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ backgroundColor: stage.color ?? "#64748b" }} />
                <h2 className="text-sm font-semibold">{stage.name}</h2>
                <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
                  {leads.length}
                </span>
              </div>
            </header>
            <div className="flex flex-col gap-2 p-2">
              {leads.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                  No leads
                </p>
              ) : (
                leads.map((lead) => (
                  <article key={lead.id} className="group rounded-lg border bg-card p-3 transition-colors hover:bg-muted/40">
                    <Link href={`/leads/${lead.id}`} className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                      <h3 className="truncate text-sm font-medium group-hover:underline">{lead.companyName ?? "—"}</h3>
                      <p className="truncate text-xs text-muted-foreground">
                        {[lead.contactName, lead.companyDomain].filter(Boolean).join(" · ") || "No contact"}
                      </p>
                    </Link>
                    <div className="mt-2 flex items-center gap-1.5">
                      <ScoreBadge score={lead.score} />
                      <PriorityBadge priority={lead.priority} />
                      <span className="ml-auto truncate text-xs text-muted-foreground">{lead.ownerName ?? "Unassigned"}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 border-t pt-1.5">
                      <span className="text-xs text-muted-foreground">Move to</span>
                      <SearchableSelect
                        options={moveOptions}
                        value=""
                        onValueChange={(stageId) =>
                          startTransition(async () => {
                            const result = await moveLeadToStageAction(lead.id, stageId)
                            if (result.ok) {
                              toast.success("Stage changed")
                              router.refresh()
                            } else {
                              toast.error(result.error)
                            }
                          })
                        }
                        placeholder="Stage…"
                        className="h-7 w-28 text-xs"
                      />
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}