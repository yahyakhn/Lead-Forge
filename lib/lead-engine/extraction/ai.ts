// TASK 016: the extraction pipeline drives the generic AIProvider; this
// module owns only the extraction-specific prompt and schema. Deterministic
// extraction is untouched — AI stays gated where the pipeline already calls it.

import { z } from "zod"
import type { AIProvider } from "@/lib/lead-engine/ai/types"
import type { AIExtractionInput, AIOutcome } from "@/lib/lead-engine/extraction/types"

const aiContactSchema = z.object({
  fullName: z.string().nullish().default(null),
  firstName: z.string().nullish().default(null),
  lastName: z.string().nullish().default(null),
  jobTitle: z.string().nullish().default(null),
  email: z.string().nullish().default(null),
  phone: z.string().nullish().default(null),
  linkedinUrl: z.string().nullish().default(null),
})

const aiResultSchema = z.object({
  company: z.object({
    name: z.string().nullish().default(null),
    domain: z.string().nullish().default(null),
    website: z.string().nullish().default(null),
    description: z.string().nullish().default(null),
    industry: z.string().nullish().default(null),
    country: z.string().nullish().default(null),
    region: z.string().nullish().default(null),
    city: z.string().nullish().default(null),
  }),
  contacts: z.array(aiContactSchema).optional().default([]),
  socialLinks: z.array(z.string()).optional().default([]),
  jobs: z
    .array(
      z.object({
        title: z.string().nullish().default(null),
        hiringOrganization: z.string().nullish().default(null),
        location: z.string().nullish().default(null),
        datePosted: z.string().nullish().default(null),
        employmentType: z.string().nullish().default(null),
        description: z.string().nullish().default(null),
      }),
    )
    .optional()
    .default([]),
  confidence: z.number().min(0).max(1).optional().default(0.5),
})

const SYSTEM_PROMPT = `You are a data extraction assistant for a lead-generation pipeline.
Extract ONLY information that is actually present in the supplied page text.
Rules:
- Never guess, never infer, never fabricate. If information is absent, return null.
- Do NOT invent email addresses, phone numbers, or URLs.
- Do NOT invent people who are not named on the page.
- Return JSON only, exactly matching the schema.
Schema:
{
  "company": { "name": string|null, "domain": string|null, "website": string|null, "description": string|null, "industry": string|null, "country": string|null, "region": string|null, "city": string|null },
  "contacts": [ { "fullName": string|null, "firstName": string|null, "lastName": string|null, "jobTitle": string|null, "email": string|null, "phone": string|null, "linkedinUrl": string|null } ],
  "socialLinks": [string],
  "jobs": [ { "title": string|null, "hiringOrganization": string|null, "location": string|null, "datePosted": string|null, "employmentType": string|null, "description": string|null } ],
  "confidence": number (0-1, how certain you are the extracted data is supported by the page)
}`

export async function extractWithAI(provider: AIProvider, input: AIExtractionInput): Promise<AIOutcome> {
  if (!provider.configured) return { ok: false, error: "AI provider is not configured" }
  const userPrompt = `Page URL: ${input.pageUrl}\nPage title: ${input.pageTitle}\n\nPage content:\n${input.cleanedText}`
  try {
    const result = await provider.generateStructured(
      { systemPrompt: SYSTEM_PROMPT, userPrompt, temperature: 0, maxTokens: 1500, responseFormat: "json_object" },
      aiResultSchema,
    )
    return { ok: true, result: { ...result, usage: { promptChars: userPrompt.length, completionChars: JSON.stringify(result).length } } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI extraction failed" }
  }
}
