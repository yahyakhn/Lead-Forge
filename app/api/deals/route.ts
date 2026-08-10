import { NextResponse } from "next/server"
import { withOrg, parseJson, parseSearchParams } from "@/lib/crm/http"
import { dealSchema } from "@/lib/crm/validators"
import { createDeal, listDeals } from "@/lib/crm/deals"

export const GET = withOrg(async ({ orgId }, request) => {
  const sp = parseSearchParams(request)
  const dealList = await listDeals(orgId, {
    page: Number(sp.page),
    pageSize: Number(sp.pageSize),
    stageId: sp.stageId,
    leadId: sp.leadId,
  })
  return NextResponse.json(dealList)
})

export const POST = withOrg(async ({ orgId }, request) => {
  const input = await parseJson(dealSchema, request)
  const deal = await createDeal(orgId, input)
  return NextResponse.json(deal, { status: 201 })
})