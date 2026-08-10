import { z } from "zod"
import type { AIOutcome, AIExtractionInput, LeadExtractionAI } from "@/lib/lead-engine/extraction/types"

// AI extraction provider (spec §30-§36). DeepSeek is the production provider;
// the interface lets tests inject a mock so the real API is never called.

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

export function parseAIJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf("{")
    const end = trimmed.lastIndexOf("}")
    if (start === -1 || end === -1 || end <= start) throw new Error("AI returned no JSON object")
    return JSON.parse(trimmed.slice(start, end + 1))
  }
}

export function validateAIResult(text: string): AIOutcome {
  try {
    const parsed = parseAIJson(text)
    const result = aiResultSchema.parse(parsed)
    return {
      ok: true,
      result: { ...result, usage: { promptChars: 0, completionChars: text.length } },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI output failed validation" }
  }
}

function aiConfig() {
  return {
    apiKey: process.env.AI_API_KEY?.trim() || "",
    model: process.env.AI_MODEL?.trim() || "deepseek-chat",
    baseUrl: process.env.AI_BASE_URL?.trim() || "https://api.deepseek.com",
  }
}

export class DeepSeekProvider implements LeadExtractionAI {
  readonly configured: boolean
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string

  constructor(config?: { apiKey?: string; model?: string; baseUrl?: string }) {
    const env = aiConfig()
    this.apiKey = config?.apiKey?.trim() || env.apiKey
    this.model = config?.model?.trim() || env.model
    this.baseUrl = config?.baseUrl?.trim() || env.baseUrl
    this.configured = Boolean(this.apiKey)
  }

  async extract(input: AIExtractionInput): Promise<AIOutcome> {
    if (!this.apiKey) return { ok: false, error: "AI_API_KEY is not configured" }
    const prompt = `Page URL: ${input.pageUrl}\nPage title: ${input.pageTitle}\n\nPage content:\n${input.cleanedText}`
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0,
          max_tokens: 1500,
        }),
        signal: AbortSignal.timeout(60_000),
      })
      if (!response.ok) {
        return { ok: false, error: `AI provider error: HTTP ${response.status}` }
      }
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const content = body.choices?.[0]?.message?.content
      if (!content) return { ok: false, error: "AI provider returned empty content" }
      const outcome = validateAIResult(content)
      if (outcome.ok) {
        outcome.result.usage = {
          promptChars: prompt.length,
          completionChars: content.length,
        }
      }
      return outcome
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "AI request failed" }
    }
  }
}