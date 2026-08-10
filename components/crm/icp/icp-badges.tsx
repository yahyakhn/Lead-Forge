import { Badge } from "@/components/ui/badge"

export function IcpActiveBadge({ active }: { active: boolean }) {
  return <Badge variant={active ? "default" : "secondary"}>{active ? "Active" : "Inactive"}</Badge>
}