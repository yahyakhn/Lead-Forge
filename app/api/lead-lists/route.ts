import { NextResponse } from "next/server"
import { withOrg, parseJson, parseSearchParams } from "@/lib/crm/http"
import { leadListSchema } from "@/lib/crm/validators"
import { createLeadList, listLeadLists } from "@/lib/crm/lead-lists"

export const GET = withOrg(async ({ orgId }, request) => {
  const sp = parseSearchParams(request)
  const listResult = await listLeadLists(orgId, {
    page: Number(sp.page),
    pageSize: Number(sp.pageSize),
    search: sp.search,
  })
  return NextResponse.json(listResult)
})

export const POST = withOrg(async ({ orgId, session }, request) => {
  const input = await parseJson(leadListSchema, request)
  const list = await createLeadList(orgId, input, session.user.id)
  return NextResponse.json(list, { status: 201 })
})