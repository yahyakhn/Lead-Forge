import { NextResponse } from "next/server"
import { withOrg, parseSearchParams } from "@/lib/crm/http"
import { prisma } from "@/lib/db"
import { buildLeadWhere, LEAD_INCLUDE_WITH_SCORES, type LeadFilters } from "@/lib/crm/leads"
import {
  CSV_EXPORT_MAX_ROWS,
  exportLeadsCsv,
  exportFilename,
  type LeadExportRow,
} from "@/lib/lead-engine/csv/service"

// GET /api/leads/export — same filters as the leads list; downloads CSV.
export const GET = withOrg(async ({ orgId }, request) => {
  const sp = parseSearchParams(request)
  const numberOr = (v: string | undefined) => (v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : undefined)
  const filters: LeadFilters = {
    search: sp.search,
    status: sp.status,
    priority: sp.priority,
    ownerId: sp.ownerId,
    companyId: sp.companyId,
    contactId: sp.contactId,
    source: sp.source,
    minScore: numberOr(sp.minScore),
    maxScore: numberOr(sp.maxScore),
    emailStatus: sp.emailStatus,
    hasEmail: sp.hasEmail === "true" ? true : undefined,
  }

  const leads = await prisma.lead.findMany({
    where: buildLeadWhere(orgId, filters),
    include: LEAD_INCLUDE_WITH_SCORES,
    orderBy: { createdAt: "desc" },
    take: CSV_EXPORT_MAX_ROWS,
  })

  const rows: LeadExportRow[] = leads.map((lead) => {
    const score = lead.scores?.[0]
    const sheet = (v: string | null | undefined) => v ?? ""
    return {
      "Lead ID": lead.id,
      "Company": sheet(lead.company?.name),
      "Domain": sheet(lead.company?.domain),
      "Website": "",
      "Contact": sheet(lead.contact?.fullName),
      "Job title": sheet(lead.contact?.jobTitle),
      "Email": sheet(lead.contact?.email),
      "Phone": "",
      "Industry": "",
      "Country": "",
      "City": "",
      "Employees": "",
      "Status": lead.status,
      "Priority": lead.priority,
      "Source": lead.source ?? "",
      "Owner": sheet(lead.owner?.name),
      "Score": score ? String(score.overallScore ?? score.icpScore ?? 0) : lead.fitScore !== null ? String(lead.fitScore) : "",
      "Classification": score?.qualification ?? "",
    }
  })

  const csv = exportLeadsCsv(rows)
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename()}"`,
    },
  })
})