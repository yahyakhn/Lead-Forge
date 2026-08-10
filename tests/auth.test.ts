import { describe, expect, it } from "vitest"
import { hashPassword, verifyPassword } from "@/lib/auth"
import { loginSchema, registerSchema } from "@/lib/validators"

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple")
    expect(hash).not.toContain("correct horse battery staple")
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(
      true,
    )
  })

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple")
    expect(await verifyPassword("wrong password", hash)).toBe(false)
  })

  it("salts each hash uniquely", async () => {
    const a = await hashPassword("same password")
    const b = await hashPassword("same password")
    expect(a).not.toBe(b)
  })
})

describe("validators", () => {
  it("accepts a valid login", () => {
    const result = loginSchema.safeParse({
      email: "User@Example.com",
      password: "secret",
    })
    expect(result.success).toBe(true)
    expect(result.success && result.data.email).toBe("user@example.com")
  })

  it("rejects an invalid email", () => {
    expect(
      loginSchema.safeParse({ email: "not-an-email", password: "secret" })
        .success,
    ).toBe(false)
  })

  it("rejects a short password on register", () => {
    expect(
      registerSchema.safeParse({
        name: "Ada",
        organizationName: "Acme",
        email: "ada@example.com",
        password: "short",
      }).success,
    ).toBe(false)
  })

  it("rejects a missing organization name", () => {
    expect(
      registerSchema.safeParse({
        name: "Ada",
        organizationName: "",
        email: "ada@example.com",
        password: "long enough password",
      }).success,
    ).toBe(false)
  })
})
