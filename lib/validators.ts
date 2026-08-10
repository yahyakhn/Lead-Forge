import { z } from "zod"

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  organizationName: z
    .string()
    .trim()
    .min(1, "Organization name is required")
    .max(100),
  email: z.email("A valid email is required").trim().toLowerCase().max(254),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128),
})

export const loginSchema = z.object({
  email: z.email("A valid email is required").trim().toLowerCase().max(254),
  password: z.string().min(1, "Password is required").max(128),
})
