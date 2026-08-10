import { z } from "zod"

export const demoConfigSchema = z
  .object({
    maxResults: z.number().int().min(1).max(50).optional(),
  })
  .strict()
export type DemoConfig = z.infer<typeof demoConfigSchema>

const registry = new Map<string, z.ZodType<unknown>>()

export function registerConfigSchema(type: string, schema: z.ZodType<unknown>): void {
  registry.set(type, schema)
}

export function getConfigSchema(type: string): z.ZodType<unknown> | undefined {
  return registry.get(type)
}

registerConfigSchema("demo", demoConfigSchema)