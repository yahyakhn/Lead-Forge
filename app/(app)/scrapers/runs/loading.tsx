import { PageHeader } from "@/components/crm/page-header"
import { TableSkeleton } from "@/components/crm/states"

export default function ScraperRunsLoading() {
  return (
    <div>
      <PageHeader title="Scraper Runs" />
      <TableSkeleton rows={8} columns={9} />
    </div>
  )
}