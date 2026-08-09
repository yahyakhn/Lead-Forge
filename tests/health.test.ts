import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: vi.fn() },
}))

import { prisma } from "@/lib/db"
import { checkDatabase } from "@/lib/health"

const queryRaw = vi.mocked(prisma.$queryRaw)

describe("checkDatabase", () => {
  beforeEach(() => {
    queryRaw.mockReset()
  })

  it("returns true when the database responds", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }])
    expect(await checkDatabase()).toBe(true)
  })

  it("returns false when the database is unreachable", async () => {
    queryRaw.mockRejectedValue(new Error("connection refused"))
    expect(await checkDatabase()).toBe(false)
  })
})
