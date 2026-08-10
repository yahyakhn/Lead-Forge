import type { ClassificationInput, ClassificationResult, PageCategory } from "@/lib/lead-engine/extraction/types"

// Deterministic page classification (spec §8-§11): URL, title, headings and
// link text contribute weighted signals; low-value pages (privacy, terms,
// login, ...) are skipped entirely and never reach AI.

const CATEGORY_SCORES: Partial<Record<PageCategory, number>> = {
  TEAM: 5,
  PEOPLE: 5,
  CONTACT: 4,
  ABOUT: 3,
  CAREERS: 2,
  JOB: 2,
  COMPANY_HOME: 1,
  PRODUCT: 1,
  PRICING: 0,
  BLOG: -1,
  NEWS: -1,
  DIRECTORY: 3,
  SOCIAL_PROFILE: 2,
}

const URL_PATTERNS: Array<[RegExp, PageCategory]> = [
  [/\/about(?:\/|$)/, "ABOUT"],
  [/\/team(?:\/|$)/, "TEAM"],
  [/\/people(?:\/|$)/, "PEOPLE"],
  [/\/contact(?:\/|$)/, "CONTACT"],
  [/\/contact-us(?:\/|$)/, "CONTACT"],
  [/\/careers?(?:\/|$)/, "CAREERS"],
  [/\/jobs?(?:\/|$)/, "JOB"],
  [/\/company(?:\/|$)/, "ABOUT"],
  [/\/leadership(?:\/|$)/, "TEAM"],
  [/\/founders(?:\/|$)/, "TEAM"],
  [/\/news(?:\/|$)/, "NEWS"],
  [/\/blog(?:\/|$)/, "BLOG"],
  [/\/pricing(?:\/|$)/, "PRICING"],
  [/\/product(?:\/|$)/, "PRODUCT"],
]

const TITLE_PATTERNS: Array<[RegExp, PageCategory]> = [
  [/about\s*(us|the company)?/, "ABOUT"],
  [/our team|the team|leadership|founders|meet the team/, "TEAM"],
  [/our people/, "PEOPLE"],
  [/contact\s*(us)?/, "CONTACT"],
  [/careers|we are hiring|join us|jobs/, "CAREERS"],
  [/pricing/, "PRICING"],
  [/blog|articles?|insights/, "BLOG"],
  [/news|press/, "NEWS"],
  [/directory|find a .* (partner|dealer|client)/, "DIRECTORY"],
]

const LINK_PATTERNS: Array<[RegExp, PageCategory]> = [
  [/^about(\s+us)?$/, "ABOUT"],
  [/^our team$|^team$|^leadership$|^founders$/, "TEAM"],
  [/^people$/, "PEOPLE"],
  [/^contact(\s+us)?$/, "CONTACT"],
  [/^careers$|^jobs$|^join us$/, "CAREERS"],
  [/^pricing$/, "PRICING"],
]

const HEADING_PATTERNS: Array<[RegExp, PageCategory]> = [
  [/^about(\s+us)?/i, "ABOUT"],
  [/^(our )?team|leadership|founders/i, "TEAM"],
  [/^people/i, "PEOPLE"],
  [/^contact(\s+us)?/i, "CONTACT"],
  [/^careers|^jobs|we are hiring/i, "CAREERS"],
  [/^pricing/i, "PRICING"],
]

// Low-value page signals (§11): never worth an AI call.
const SKIP_PATTERNS: Array<[RegExp, string]> = [
  [/privacy/, "privacy policy"],
  [/^terms?(\b|$)/, "terms"],
  [/cookie/, "cookie policy"],
  [/legal|imprint|disclaimer/, "legal page"],
  [/login|sign\s*in|signup|register/, "authentication page"],
  [/cart|checkout|order/, "cart/checkout"],
  [/search/, "search results"],
  [/^\/?404$|not.found/, "not found"],
  [/sitemap/, "sitemap"],
  [/\/feed\/|rss/, "rss feed"],
]

function matchScore(patterns: Array<[RegExp, PageCategory]>, value: string): PageCategory | null {
  for (const [pattern, category] of patterns) {
    if (pattern.test(value)) return category
  }
  return null
}

function isHomeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.pathname === "/" || parsed.pathname === ""
  } catch {
    return false
  }
}

export function classifyPage(input: ClassificationInput): ClassificationResult {
  const url = input.url.toLowerCase()
  const title = (input.title ?? "").toLowerCase()
  const skipped = SKIP_PATTERNS.find(([pattern]) => pattern.test(url) || pattern.test(title))
  if (skipped) {
    return { category: "OTHER", score: 0, skip: true, skipReason: skipped[1] }
  }

  const scores = new Map<PageCategory, number>()
  const bump = (category: PageCategory | null, weight: number) => {
    if (!category) return
    scores.set(category, (scores.get(category) ?? 0) + weight)
  }

  bump(matchScore(URL_PATTERNS, url), 2)
  bump(matchScore(TITLE_PATTERNS, title), 2)
  for (const linkText of input.linkTexts.map((t) => t.trim().toLowerCase())) {
    bump(matchScore(LINK_PATTERNS, linkText), 1)
  }

  const firstHeadingMatch: PageCategory[] = []
  for (const heading of input.headings.map((h) => h.toLowerCase())) {
    const hit = matchScore(HEADING_PATTERNS, heading)
    if (hit && !firstHeadingMatch.includes(hit)) firstHeadingMatch.push(hit)
  }
  firstHeadingMatch.slice(0, 3).forEach((category) => bump(category, 1))

  if (isHomeUrl(url)) {
    scores.set("COMPANY_HOME", (scores.get("COMPANY_HOME") ?? 0) + CATEGORY_SCORES.COMPANY_HOME!)
  } else if (scores.size === 0) {
    return { category: "OTHER", score: 0, skip: false }
  }

  let best: PageCategory = "OTHER"
  let bestScore = -Infinity
  for (const [category, score] of scores) {
    if (score > bestScore) {
      best = category
      bestScore = score
    }
  }

  return { category: best, score: bestScore + (CATEGORY_SCORES[best] ?? 0), skip: false }
}

// Pages unlikely to contain lead information; sending them to AI is wasted
// money (§11, §32).
export function isAIWorthyCategory(category: PageCategory): boolean {
  return ["TEAM", "PEOPLE", "CONTACT", "ABOUT", "COMPANY_HOME"].includes(category)
}