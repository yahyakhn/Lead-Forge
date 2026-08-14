import { CardSkeleton, TableSkeleton } from "@/components/crm/states"
import { Skeleton } from "@/components/ui/skeleton"

export default function AnalyticsLoading() {
  return (
    <div>
      <div className="mb-3 h-8 w-72">
        <Skeleton className="h-full w-full" />
      </div>
      <CardSkeleton rows={6} />
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border p-4">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="mt-4 h-40 w-full" />
        </div>
        <div className="rounded-xl border p-4">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="mt-4 h-40 w-full" />
        </div>
      </div>
      <div className="mt-6">
        <TableSkeleton rows={4} columns={4} />
      </div>
    </div>
  )
}