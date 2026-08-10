import Link from "next/link"
import { getActiveICP } from "@/lib/crm/icp"
import { joinValues } from "@/components/crm/icp/criteria-summary"

export async function IcpCard({ orgId }: { orgId: string }) {
  let icp
  try {
    icp = await getActiveICP(orgId)
  } catch {
    return null
  }
  if (!icp) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        No active ICP profile. <Link href="/icp/new" className="font-medium text-primary hover:underline">Create one →</Link>
      </div>
    )
  }
  const focus = joinValues(icp.criteria.industries) ?? joinValues(icp.criteria.countries) ?? "No criteria yet"
  return (
    <Link
      href={`/icp/${icp.id}`}
      className="block rounded-xl border bg-card p-4 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <p className="truncate text-sm font-semibold">{icp.name}</p>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{focus}</p>
      <p className="mt-2 text-xs font-medium text-primary">View ICP →</p>
    </Link>
  )
}