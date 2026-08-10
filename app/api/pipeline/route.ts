import { NextResponse } from "next/server"
import { withOrg } from "@/lib/crm/http"
import { listStages } from "@/lib/crm/pipeline"

export const GET = withOrg(async ({ orgId }) => {
  const stages = await listStages(orgId)
  return NextResponse.json(stages)
})