import { describe, expect, it, afterAll } from "vitest"
import { prisma } from "@/lib/db"
import { icpSchema, type IcpInput } from "@/lib/crm/validators"
import { normalizeCriteria } from "@/lib/crm/icp-shared"
import {
  activateICP,
  createICP,
  deleteICP,
  duplicateICP,
  getActiveICP,
  listICPs,
  updateICP,
} from "@/lib/crm/icp"

const orgIds: string[] = []
const newOrg = async () => {
  const org = await prisma.organization.create({
    data: { name: `ICP Test Org ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  })
  orgIds.push(org.id)
  return org
}

const newUser = async (orgId: string) =>
  prisma.user.create({
    data: {
      email: `icp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
      passwordHash: "x",
      name: "ICP Tester",
      organizationId: orgId,
    },
  })

const validInput: IcpInput = {
  name: "India SaaS",
  description: "Mid-market Indian SaaS",
  industries: ["SaaS", "Software"],
  countries: ["India"],
  regions: [],
  cities: [],
  technologies: ["AWS"],
  companyTypes: ["B2B", "STARTUP"],
  signals: ["HIRING_SALES"],
  employeeMin: 50,
  revenueMin: 1_000_000,
  revenueMax: 50_000_000,
  revenueCurrency: "USD",
  excludeIndustries: ["Government"],
  excludeCountries: [],
  excludeCompanyTypes: [],
  excludeKeywords: [],
  scoringKeywords: [],
  scoringJobTitles: [],
  scoringSeniorities: [],
  scoringDomains: [],
}

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
  await prisma.$disconnect()
})

describe("ICP validation", () => {
  it("accepts a valid flat input and normalizes it", () => {
    const parsed = icpSchema.safeParse(validInput)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    const criteria = normalizeCriteria(parsed.data)
    expect(criteria.industries).toEqual(["SaaS", "Software"])
    expect(criteria.revenueRange).toEqual({ min: 1_000_000, max: 50_000_000, currency: "USD" })
    expect(criteria.exclusions.industries).toEqual(["Government"])
  })

  it("rejects reversed ranges, bad currency, unknown signals, and oversize lists", () => {
    expect(icpSchema.safeParse({ ...validInput, revenueMin: 60_000_000, revenueMax: 10_000_000 }).success).toBe(false)
    expect(icpSchema.safeParse({ ...validInput, revenueCurrency: "XRP" }).success).toBe(false)
    expect(icpSchema.safeParse({ ...validInput, signals: ["NOT_A_SIGNAL"] }).success).toBe(false)
    expect(icpSchema.safeParse({ ...validInput, name: "  " }).success).toBe(false)
    expect(
      icpSchema.safeParse({ ...validInput, industries: Array.from({ length: 51 }, (_, i: number) => `Industry ${i}`) }).success,
    ).toBe(false)
  })

  it("dedupes lists case-insensitively, preserving first casing", () => {
    const parsed = icpSchema.safeParse({ ...validInput, industries: ["SaaS", "saas", "SaaS"] })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(normalizeCriteria(parsed.data).industries).toEqual(["SaaS"])
  })
})

describe("ICP service", () => {
  it("creates inactive, enforces case-insensitive unique names per org", async () => {
    const org = await newOrg()
    const user = await newUser(org.id)

    const icp = await createICP(org.id, user.id, validInput)
    expect(icp.isActive).toBe(false)
    expect(icp.createdById).toBe(user.id)
    expect(icp.criteria.employeeRange).toEqual({ min: 50, max: undefined })

    await expect(createICP(org.id, user.id, { ...validInput, name: "india saas" })).rejects.toThrow()

    const other = await newOrg()
    const otherIcp = await createICP(other.id, user.id, validInput)
    expect(otherIcp.name).toBe("India SaaS")
  })

  it("keeps a single active ICP per org", async () => {
    const org = await newOrg()
    const user = await newUser(org.id)

    const a = await createICP(org.id, user.id, validInput)
    const b = await createICP(org.id, user.id, { ...validInput, name: "US Fintech" })

    await activateICP(org.id, a.id)
    expect((await getActiveICP(org.id))?.id).toBe(a.id)

    await activateICP(org.id, b.id)
    expect((await getActiveICP(org.id))?.id).toBe(b.id)
    const refreshed = await prisma.iCPProfile.findUnique({ where: { id: a.id } })
    expect(refreshed?.isActive).toBe(false)
  })

  it("duplicates as an inactive profile named '<name> Copy'", async () => {
    const org = await newOrg()
    const user = await newUser(org.id)

    const icp = await createICP(org.id, user.id, validInput)
    const copy = await duplicateICP(org.id, icp.id)
    if (!copy) throw new Error("duplicate returned null")
    expect(copy.name).toBe("India SaaS Copy")
    expect(copy.isActive).toBe(false)
    expect(copy.criteria.industries).toEqual(["SaaS", "Software"])

    const second = await duplicateICP(org.id, icp.id)
    if (!second) throw new Error("second duplicate returned null")
    expect(second.name).toBe("India SaaS Copy 2")
  })

  it("updates criteria and refuses name conflicts with other profiles", async () => {
    const org = await newOrg()
    const user = await newUser(org.id)

    const a = await createICP(org.id, user.id, validInput)
    const b = await createICP(org.id, user.id, { ...validInput, name: "US Fintech" })
    expect(b.name).toBe("US Fintech")

    await expect(updateICP(org.id, a.id, { ...validInput, name: "us fintech" })).rejects.toThrow()

    const renamed = await updateICP(org.id, a.id, { ...validInput, name: "India SaaS v2", signals: ["HIRING_SALES", "NEW_PRODUCT"] })
    expect(renamed?.name).toBe("India SaaS v2")
    expect(renamed?.criteria.signals).toEqual(["HIRING_SALES", "NEW_PRODUCT"])
  })

  it("lists, searches, isolates by org, and deletes", async () => {
    const org = await newOrg()
    const user = await newUser(org.id)
    await createICP(org.id, user.id, validInput)
    await createICP(org.id, user.id, { ...validInput, name: "US Fintech" })
    const other = await newOrg()
    await createICP(other.id, user.id, validInput)

    const all = await listICPs(org.id, {})
    expect(all.total).toBe(2)
    expect(all.data.some((i) => i.name === "US Fintech")).toBe(true)

    const search = await listICPs(org.id, { search: "fintech" })
    expect(search.total).toBe(1)
    expect(search.data[0].name).toBe("US Fintech")

    await deleteICP(org.id, all.data[0].id)
    expect((await listICPs(org.id, {})).total).toBe(1)
  })
})