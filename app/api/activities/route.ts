import { NextResponse } from "next/server"
import { withOrg, parseJson, parseSearchParams } from "@/lib/crm/http"
import { activitySchema } from "@/lib/crm/validators"
import { createActivity, listActivities } from "@/lib/crm/activities"

export const GET = withOrg(async ({ orgId }, request) => {
  const sp = parseSearchParams(request)
  const activityList = await listActivities(orgId, {
    page: Number(sp.page),
    pageSize: Number(sp.pageSize),
    leadId: sp.leadId,
    companyId: sp.companyId,
    contactId: sp.contactId,
  })
  return NextResponse.json(activityList)
})

export const POST = withOrg(async ({ orgId, session }, request) => {
  const input = await parseJson(activitySchema, request)
  const activity = await createActivity(orgId, input, session.user.id)
  return NextResponse.json(activity, { status: 201 })
})