import { describe, expect, it, afterAll } from "vitest"
import { prisma } from "@/lib/db"
import { createCompany, listCompanies } from "@/lib/crm/companies"
import { createContact, listContacts } from "@/lib/crm/contacts"
import { createLead, listLeads, updateLead } from "@/lib/crm/leads"
import { listActivities } from "@/lib/crm/activities"
import { createDeal, listDeals } from "@/lib/crm/deals"
import { createLeadList, addLeadToList, listLeadLists } from "@/lib/crm/lead-lists"

const orgIds: string[] = []
const newOrg = async () => {
  const org = await prisma.organization.create({ data: { name: `Test Org ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } })
  orgIds.push(org.id)
  return org.id
}

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
  await prisma.$disconnect()
})

describe("CRM services", () => {
  it("runs the full flow: company → contact → lead → deal → list, filtered and searchable", async () => {
    const orgId = await newOrg()

    const company = await createCompany(orgId, { name: "Northwind Traders", domain: "northwind.io", industry: "Retail" })
    expect(company.name).toBe("Northwind Traders")
    expect(company.normalizedName).toBe("northwind traders")

    const contact = await createContact(orgId, {
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@northwind.io",
      companyId: company.id,
      verificationStatus: "VERIFIED",
    })
    expect(contact.email).toBe("ada@northwind.io")

    const lead = await createLead(orgId, {
      companyId: company.id,
      contactId: contact.id,
      source: "test",
      priority: "HIGH",
      score: 80,
    })
    expect(lead.status).toBe("NEW")

    const updated = await updateLead(orgId, lead.id, { status: "QUALIFIED" })
    expect(updated?.status).toBe("QUALIFIED")
    const activities = await listActivities(orgId, { leadId: lead.id })
    expect(activities.data.map((a) => a.type)).toContain("STATUS_CHANGE")

    const stage = await prisma.pipelineStage.create({
      data: { organizationId: orgId, name: "Prospecting", slug: "prospecting", position: 0 },
    })
    const deal = await createDeal(orgId, {
      name: "Northwind expansion",
      value: "25000.00",
      currency: "USD",
      stageId: stage.id,
      leadId: lead.id,
      companyId: company.id,
    })
    expect(deal.currency).toBe("USD")

    expect((await listCompanies(orgId, { search: "north" })).data.map((c) => c.id)).toContain(company.id)
    expect((await listCompanies(orgId, { pageSize: 10 })).data[0]!._count.leads).toBe(1)
    expect((await listContacts(orgId, { companyId: company.id })).data.map((c) => c.id)).toContain(contact.id)
    expect((await listLeads(orgId, { status: "QUALIFIED", search: "Lovelace" })).data.map((l) => l.id)).toContain(lead.id)
    expect((await listDeals(orgId, { companyId: company.id })).data.map((d) => d.id)).toContain(deal.id)
  })

  it("deduplicates lead list membership", async () => {
    const orgId = await newOrg()
    const company = await createCompany(orgId, { name: "Acme Corp" })
    const lead = await createLead(orgId, { companyId: company.id })

    const list = await createLeadList(orgId, { name: "Q4 outreach" })
    await addLeadToList(orgId, list.id, lead.id)
    await addLeadToList(orgId, list.id, lead.id)
    await addLeadToList(orgId, list.id, lead.id)

    const listWithLeads = await prisma.leadList.findUniqueOrThrow({
      where: { id: list.id },
      include: { _count: { select: { memberships: true } } },
    })
    expect(listWithLeads._count.memberships).toBe(1)
    expect((await listLeadLists(orgId, {})).total).toBe(1)
  })

  it("isolates data between organizations", async () => {
    const orgA = await newOrg()
    const orgB = await newOrg()

    const companyA = await createCompany(orgA, { name: "Org A Only Inc." })
    const leadA = await createLead(orgA, { companyId: companyA.id })

    expect((await listCompanies(orgB, {})).total).toBe(0)
    expect((await listLeads(orgB, {})).total).toBe(0)
    expect((await listLeads(orgA, {})).data.map((l) => l.id)).toContain(leadA.id)
  })
})