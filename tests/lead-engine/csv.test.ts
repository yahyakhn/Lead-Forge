// CSV import/export (TASK 022): auto-mapping, preview statuses, dedupe
// strategies, formula safety. Runs against a real DB like crm.test.ts.

import { describe, expect, it, afterAll } from "vitest"
import { prisma } from "@/lib/db"
import {
  parseCsv,
  autoMapHeaders,
  previewCsvImport,
  importCsvRows,
  exportLeadsCsv,
  safeCell,
} from "@/lib/lead-engine/csv/service"

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

const CSV = `Company,Domain,First name,Last name,Email,Status,Priority
Northwind Traders,northwind.io,Ada,Lovelace,ada@northwind.io,QUALIFIED,HIGH
Acme Corp,acme.io,John,Doe,john@acme.io,NEW,MEDIUM`

const mappingOf = (csv: string) => autoMapHeaders(parseCsv(csv).headers).mapping

describe("CSV import", () => {
  it("auto-maps common headers", () => {
    const mapping = mappingOf(CSV)
    expect(mapping["Company"]).toBe("company.name")
    expect(mapping["Domain"]).toBe("company.domain")
    expect(mapping["Email"]).toBe("contact.email")
    expect(mapping["Status"]).toBe("lead.status")
    expect(mapping["Priority"]).toBe("lead.priority")
  })

  it("previews new rows and imports them", async () => {
    const orgId = await newOrg()
    const mapping = mappingOf(CSV)
    const preview = await previewCsvImport(orgId, CSV, mapping)
    expect(preview.newRows).toBe(2)
    expect(preview.invalidRows).toBe(0)

    const result = await importCsvRows(orgId, CSV, mapping, "CREATE")
    expect(result.created).toBe(2)
    expect(result.failed).toBe(0)
    expect(await prisma.lead.count({ where: { organizationId: orgId } })).toBe(2)
  })

  it("detects existing rows on re-import and honors SKIP/UPDATE", async () => {
    const orgId = await newOrg()
    const mapping = mappingOf(CSV)
    await importCsvRows(orgId, CSV, mapping, "CREATE")

    const rePreview = await previewCsvImport(orgId, CSV, mapping)
    expect(rePreview.existingRows).toBe(2)
    expect(rePreview.newRows).toBe(0)

    const skipped = await importCsvRows(orgId, CSV, mapping, "SKIP")
    expect(skipped.duplicates).toBe(2)
    expect(await prisma.lead.count({ where: { organizationId: orgId } })).toBe(2)

    const updated = await importCsvRows(orgId, CSV, mapping, "UPDATE")
    expect(updated.updated).toBe(2)
    expect(await prisma.lead.count({ where: { organizationId: orgId } })).toBe(2)
  })

  it("flags invalid rows and leaves them out", async () => {
    const orgId = await newOrg()
    const bad = `Company,Domain,First name,Last name,Email,Status
Bad Co,bad.io,Nope,Nobody,nobody@bad.io,BOGUS`
    const mapping = mappingOf(bad)
    const preview = await previewCsvImport(orgId, bad, mapping)
    expect(preview.invalidRows).toBe(1)
    expect(preview.newRows).toBe(0)

    const result = await importCsvRows(orgId, bad, mapping, "CREATE")
    expect(result.failed).toBe(1)
    expect(result.created).toBe(0)
  })

  it("skips duplicate contacts within one file", async () => {
    const orgId = await newOrg()
    const csv = `Company,Domain,First name,Email
Dup Co,dup.io,Ada,ada@dup.io
Dup Co,dup.io,Ada,ada@dup.io`
    const mapping = mappingOf(csv)
    const preview = await previewCsvImport(orgId, csv, mapping)
    expect(preview.duplicateRows).toBe(1)
    const result = await importCsvRows(orgId, csv, mapping, "CREATE")
    expect(result.created).toBe(1)
    expect(result.skipped).toBe(1)
  })
})

describe("CSV export", () => {
  it("escapes formula injection", () => {
    expect(safeCell("=SUM(A1)")).toBe("'=SUM(A1)")
    expect(safeCell("plain")).toBe("plain")
  })

  it("writes header row with all export columns", () => {
    const csv = exportLeadsCsv([
      {
        "Lead ID": "123",
        "Company": "Northwind",
        "Domain": "northwind.io",
        "Website": "",
        "Contact": "Ada Lovelace",
        "Job title": "",
        "Email": "ada@northwind.io",
        "Phone": "",
        "Industry": "",
        "Country": "",
        "City": "",
        "Employees": "",
        "Status": "NEW",
        "Priority": "HIGH",
        "Source": "IMPORT",
        "Owner": "",
        "Score": "80",
        "Classification": "GOOD",
      },
    ])
    expect(csv.split("\n")[0]).toBe("Lead ID,Company,Domain,Website,Contact,Job title,Email,Phone,Industry,Country,City,Employees,Status,Priority,Source,Owner,Score,Classification")
    expect(csv).toContain("Northwind,Northwind.io".replace("Northwind.io", "northwind.io"))
  })
})