// TASK 016: AI provider layer tests (spec §26-§29). No network calls — the
// DeepSeek fetch is stubbed, and the mock provider never touches the network.

import { afterAll, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { AIError } from "@/lib/lead-engine/ai/types"
import { parseAIJson, parseStructured } from "@/lib/lead-engine/ai/parse"
import { DeepSeekProvider } from "@/lib/lead-engine/ai/providers/deepseek"
import { MockAIProvider } from "@/lib/lead-engine/ai/providers/mock"
import { getAIProvider } from "@/lib/lead-engine/ai/registry"
import { prisma } from "@/lib/db"
import { LeadSourceType, ScraperRunStatus, CandidateStatus } from "@/generated/prisma/enums"
import { startExtraction, reprocessPage } from "@/lib/lead-engine/extraction/service"

const TestSchema = z.object({ name: z.string(), score: z.number() })

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const okBody = (content: string, usage?: { prompt_tokens?: number; completion_tokens?: number }) =>
  JSON.stringify({ choices: [{ message: { content } }], ...(usage ? { usage } : {}) })

const okResponse = (content: string, usage?: { prompt_tokens?: number; completion_tokens?: number }) =>
  new Response(okBody(content, usage), { status: 200, headers: { "content-type": "application/json" } })

const statusResponse = (status: number) => new Response("provider error", { status })

const providerWith = (fetchFn: FetchFn, overrides: Partial<ConstructorParameters<typeof DeepSeekProvider>[0]> = {}) =>
  new DeepSeekProvider({ apiKey: "test-key", fetchFn, retryBaseMs: 1, ...overrides })

const requestBody = (fetchFn: FetchFn, call = 0): Record<string, unknown> => {
  const init = vi.mocked(fetchFn).mock.calls[call]?.[1]
  return init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
}

// ── DeepSeek provider: success paths ─────────────────────────────────────

describe("DeepSeekProvider", () => {
  it("generates text and returns normalized result", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => okResponse("Hello world", { prompt_tokens: 10, completion_tokens: 2 }))
    const provider = providerWith(fetchFn)
    const result = await provider.generateText({ userPrompt: "Say hello" })

    expect(result.text).toBe("Hello world")
    expect(result.model).toBe("deepseek-chat")
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 2 })

    const body = requestBody(fetchFn)
    expect(body.model).toBe("deepseek-chat")
    expect(body.temperature).toBe(0)
    expect(body.messages).toEqual([{ role: "user", content: "Say hello" }])
  })

  it("supports system prompt, temperature, model and maxTokens", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => okResponse("{}"))
    const provider = providerWith(fetchFn)
    await provider.generateText({ systemPrompt: "Be strict", userPrompt: "Extract", temperature: 0.3, model: "deepseek-reasoner", maxTokens: 500 })

    const body = requestBody(fetchFn)
    expect(body.model).toBe("deepseek-reasoner")
    expect(body.temperature).toBe(0.3)
    expect(body.max_tokens).toBe(500)
    expect(body.messages).toEqual([
      { role: "system", content: "Be strict" },
      { role: "user", content: "Extract" },
    ])
  })

  it("clamps max output tokens", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => okResponse("{}"))
    const provider = providerWith(fetchFn)
    await provider.generateText({ userPrompt: "x", maxTokens: 1_000_000 })
    const body = requestBody(fetchFn)
    expect(body.max_tokens).toBe(8192)
  })

  it("generates structured output with zod validation", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => okResponse(JSON.stringify({ name: "Test", score: 10 })))
    const provider = providerWith(fetchFn)
    const result = await provider.generateStructured({ userPrompt: "give data" }, TestSchema)
    expect(result).toEqual({ name: "Test", score: 10 })
  })

  it("rejects invalid JSON as AI_INVALID_RESPONSE", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => okResponse("not json at all"))
    const provider = providerWith(fetchFn)
    await expect(provider.generateText({ userPrompt: "x" })).resolves.toMatchObject({ text: "not json at all" })
    await expect(provider.generateStructured({ userPrompt: "x" }, TestSchema)).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" })
  })

  it("rejects schema-invalid output as AI_SCHEMA_VALIDATION_ERROR", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => okResponse(JSON.stringify({ name: "Test", score: "ten" })))
    const provider = providerWith(fetchFn)
    await expect(provider.generateStructured({ userPrompt: "x" }, TestSchema)).rejects.toMatchObject({ code: "AI_SCHEMA_VALIDATION_ERROR" })
  })

  it("rejects empty content as AI_INVALID_RESPONSE", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => okResponse("   "))
    const provider = providerWith(fetchFn)
    await expect(provider.generateText({ userPrompt: "x" })).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" })
  })

  it("rejects non-JSON response bodies as AI_INVALID_RESPONSE", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => new Response("<html>", { status: 200 }))
    const provider = providerWith(fetchFn)
    await expect(provider.generateText({ userPrompt: "x" })).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" })
  })

  // ── Error mapping and retries ─────────────────────────────────────────

  it("maps HTTP 400 to AI_PROVIDER_ERROR without retry", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => statusResponse(400))
    const provider = providerWith(fetchFn)
    await expect(provider.generateText({ userPrompt: "x" })).rejects.toMatchObject({ code: "AI_PROVIDER_ERROR", retryable: false })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("maps HTTP 401 to AI_AUTHENTICATION_ERROR without retry", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => statusResponse(401))
    const provider = providerWith(fetchFn)
    await expect(provider.generateText({ userPrompt: "x" })).rejects.toMatchObject({ code: "AI_AUTHENTICATION_ERROR", retryable: false })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("retries HTTP 429 then succeeds", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => okResponse("ok"))
    fetchFn.mockReturnValueOnce(Promise.resolve(statusResponse(429))).mockReturnValueOnce(Promise.resolve(statusResponse(429)))
    const provider = providerWith(fetchFn)
    const result = await provider.generateText({ userPrompt: "x" })
    expect(result.text).toBe("ok")
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it("gives up on persistent rate limiting with AI_RATE_LIMITED", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => statusResponse(429))
    const provider = providerWith(fetchFn, { maxRetries: 2 })
    await expect(provider.generateText({ userPrompt: "x" })).rejects.toMatchObject({ code: "AI_RATE_LIMITED" })
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it("retries HTTP 500/502/503/504 transient errors", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => okResponse("ok"))
    fetchFn.mockReturnValueOnce(Promise.resolve(statusResponse(503))).mockReturnValueOnce(Promise.resolve(statusResponse(504)))
    const provider = providerWith(fetchFn)
    await expect(provider.generateText({ userPrompt: "x" })).resolves.toMatchObject({ text: "ok" })
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it("fails after exhausting retries on persistent 500", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => statusResponse(500))
    const provider = providerWith(fetchFn, { maxRetries: 2 })
    await expect(provider.generateText({ userPrompt: "x" })).rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" })
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it("does not retry beyond the configured maximum", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => statusResponse(503))
    const provider = providerWith(fetchFn, { maxRetries: 1 })
    await expect(provider.generateText({ userPrompt: "x" })).rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it("maps timeouts to AI_TIMEOUT and retries them", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" })
    const fetchFn = vi.fn<FetchFn>(async () => {
      throw timeout
    })
    const provider = providerWith(fetchFn, { maxRetries: 1 })
    await expect(provider.generateText({ userPrompt: "x" })).rejects.toMatchObject({ code: "AI_TIMEOUT" })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it("maps network failures to AI_NETWORK_ERROR", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => {
      throw new Error("connection refused")
    })
    const provider = providerWith(fetchFn, { maxRetries: 0 })
    await expect(provider.generateText({ userPrompt: "x" })).rejects.toMatchObject({ code: "AI_NETWORK_ERROR" })
  })

  it("throws AI_CONFIGURATION_ERROR without an API key and never calls fetch", async () => {
    const fetchFn = vi.fn<FetchFn>()
    const provider = new DeepSeekProvider({ fetchFn })
    expect(provider.configured).toBe(false)
    await expect(provider.generateText({ userPrompt: "x" })).rejects.toMatchObject({ code: "AI_CONFIGURATION_ERROR" })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  // ── Configuration ─────────────────────────────────────────────────────

  it("uses AI_MODEL, AI_BASE_URL and AI_API_KEY from the environment", async () => {
    vi.stubEnv("AI_MODEL", "env-model")
    vi.stubEnv("AI_BASE_URL", "https://env.example.com/v1")
    const fetchFn = vi.fn<FetchFn>(async () => okResponse("ok"))
    const provider = new DeepSeekProvider({ fetchFn, apiKey: "env-key" })
    await provider.generateText({ userPrompt: "x" })
    const [url, init] = fetchFn.mock.calls[0]!
    expect(String(url)).toBe("https://env.example.com/v1/chat/completions")
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer env-key")
    expect(JSON.parse(String(init!.body)).model).toBe("env-model")
    vi.unstubAllEnvs()
  })

  it("defaults model and base URL when unset", () => {
    const provider = new DeepSeekProvider({ apiKey: "k" })
    expect(provider.configured).toBe(true)
  })
})

// ── Mock provider ────────────────────────────────────────────────────────

describe("MockAIProvider", () => {
  it("returns deterministic text without network access", async () => {
    const provider = new MockAIProvider()
    const a = await provider.generateText({ userPrompt: "first line" })
    const b = await provider.generateText({ userPrompt: "first line" })
    expect(a.text).toBe(b.text)
    expect(a.text).toContain("first line")
    expect(a.model).toBe("mock")
    expect(provider.configured).toBe(true)
  })

  it("returns typed structured results for a test schema", async () => {
    const provider = new MockAIProvider()
    const result = await provider.generateStructured({ userPrompt: "x" }, TestSchema)
    expect(result).toEqual({ name: "test", score: 10 })
  })

  it("honors injected structured fixtures", async () => {
    const provider = new MockAIProvider({ structured: { name: "Test", score: 10 } })
    const result = await provider.generateStructured({ userPrompt: "x" }, TestSchema)
    expect(result).toEqual({ name: "Test", score: 10 })
  })

  it("surfaces schema failures as AI_SCHEMA_VALIDATION_ERROR", async () => {
    const provider = new MockAIProvider({ structured: { name: 42, score: 10 } })
    await expect(provider.generateStructured({ userPrompt: "x" }, TestSchema)).rejects.toMatchObject({ code: "AI_SCHEMA_VALIDATION_ERROR" })
  })

  it("supports callable text/structured handlers", async () => {
    const provider = new MockAIProvider({ structured: (req: { userPrompt: string }) => ({ name: req.userPrompt, score: 7 }) })
    await expect(provider.generateStructured({ userPrompt: "Fred" }, TestSchema)).resolves.toEqual({ name: "Fred", score: 7 })
  })
})

// ── Provider selection ───────────────────────────────────────────────────

describe("getAIProvider", () => {
  it("returns DeepSeekProvider for AI_PROVIDER=deepseek", () => {
    vi.stubEnv("AI_PROVIDER", "deepseek")
    expect(getAIProvider()).toBeInstanceOf(DeepSeekProvider)
    vi.unstubAllEnvs()
  })

  it("returns MockAIProvider for AI_PROVIDER=mock", () => {
    vi.stubEnv("AI_PROVIDER", "mock")
    expect(getAIProvider()).toBeInstanceOf(MockAIProvider)
    vi.unstubAllEnvs()
  })

  it("defaults to deepseek when unset or empty", () => {
    vi.stubEnv("AI_PROVIDER", "")
    expect(getAIProvider()).toBeInstanceOf(DeepSeekProvider)
    vi.stubEnv("AI_PROVIDER", "  ")
    expect(getAIProvider()).toBeInstanceOf(DeepSeekProvider)
    vi.unstubAllEnvs()
  })

  it("throws a controlled error for unknown providers", () => {
    vi.stubEnv("AI_PROVIDER", "anthropic")
    expect(() => getAIProvider()).toThrow(AIError)
    expect(() => getAIProvider()).toThrow(/Unknown AI_PROVIDER "anthropic"/)
    vi.unstubAllEnvs()
  })
})

// ── Parsing helpers ──────────────────────────────────────────────────────

describe("parseStructured", () => {
  it("extracts JSON from fenced or padded output", () => {
    expect(parseAIJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseStructured("prefix {\"name\":\"x\",\"score\":1} suffix", TestSchema)).toEqual({ name: "x", score: 1 })
  })

  it("throws AI_INVALID_RESPONSE when no JSON is present", () => {
    try {
      parseStructured("no json here", TestSchema)
      expect.unreachable("should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(AIError)
      expect((e as AIError).code).toBe("AI_INVALID_RESPONSE")
    }
  })
})

// ── Extraction integration (real DB, mock provider) ──────────────────────

describe("extraction integration", () => {
  const orgIds: string[] = []

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
  })

  it("runs the extraction pipeline through the generic AIProvider", async () => {
    const org = await prisma.organization.create({ data: { name: `AI Test Org ${Date.now()}` } })
    orgIds.push(org.id)
    const source = await prisma.leadSource.create({
      data: {
        organizationId: org.id,
        name: `AI Source ${Date.now()}`,
        slug: `ai-${Date.now()}`,
        type: LeadSourceType.CUSTOM,
        config: {},
      },
    })
    const run = await prisma.scraperRun.create({
      data: { organizationId: org.id, sourceId: source.id, status: ScraperRunStatus.COMPLETED },
    })
    const page = await prisma.rawPage.create({
      data: {
        organizationId: org.id,
        runId: run.id,
        sourceId: source.id,
        url: "https://acme-ai.example/about",
        statusCode: 200,
        textContent: "Acme AI builds developer tools. Our team is remote first.",
        fetchedAt: new Date(),
      },
    })
    await startExtraction(org.id, run.id)

    const mock = new MockAIProvider({
      structured: {
        company: {
          name: "Acme AI",
          domain: "acme-ai.example",
          website: "https://acme-ai.example",
          description: "Developer tools company",
          industry: "Software",
          country: "US",
          region: null,
          city: null,
        },
        contacts: [],
        socialLinks: [],
        jobs: [],
        confidence: 0.9,
      },
    })

    const outcome = await reprocessPage(org.id, page.id, mock)
    expect(outcome.status).toBe(CandidateStatus.EXTRACTED)

    const candidate = await prisma.leadCandidate.findFirst({
      where: { organizationId: org.id, rawPageId: page.id },
    })
    expect(candidate).not.toBeNull()
    expect(candidate?.companyName).toBe("Acme AI")
    expect(candidate?.companyDomain).toBe("acme-ai.example")
    expect(candidate?.aiUsed).toBe(true)

    const extractionRun = await prisma.extractionRun.findUnique({
      where: { organizationId_scraperRunId: { organizationId: org.id, scraperRunId: run.id } },
    })
    expect(extractionRun?.aiCalls).toBe(1)
    expect(extractionRun?.aiFailures).toBe(0)
  })
})
