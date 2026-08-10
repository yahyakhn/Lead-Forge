import { NextResponse } from "next/server"
import { withOrg, parseJson, parseSearchParams } from "@/lib/crm/http"
import { leadSchema } from "@/lib/crm/validators"
import { createLead, listLeads } from "@/lib/crm/leads"

export const GET = withOrg(async ({ orgId }, request) => {
  const sp = parseSearchParams(request)
  const leadList = await listLeads(orgId, {
    page: Number(sp.page),
    pageSize: Number(sp.pageSize),
    search: sp.search,
    status: sp.status,
    priority: sp.priority,
    ownerId: sp.ownerId,
    companyId: sp.companyId,
    minScore: sp.minScore !== undefined ? Number(sp.minScore) : undefined,
    maxScore: sp.maxScore !== undefined ? Number(sp.maxScore) : undefined,
  })
  return NextResponse.json(leadList)
})

export const POST = withOrg(async ({ orgId }, request) => {
  const input = await parseJson(leadSchema, request)
  const lead = await createLead(orgId, input)
  return NextResponse.json(lead, { status: 201 })
})