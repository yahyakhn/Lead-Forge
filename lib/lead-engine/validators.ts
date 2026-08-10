import { z } from "zod"
import { LeadSourceType } from "@/generated/prisma/enums"

export type SourceType = (typeof LeadSourceType)[keyof typeof LeadSourceType]

export const leadSourceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  type: z.enum(Object.values(LeadSourceType) as [SourceType, ...SourceType[]], { message: "Invalid source type" }),
  description: z
    .union([z.string().trim().max(500), z.literal("")])
    .optional()
    .transform((v) => (v ? v : undefined)),
  config: z.unknown(),
  isActive: z.boolean().optional(),
})

export type LeadSourceInput = z.infer<typeof leadSourceSchema>