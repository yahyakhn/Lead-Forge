import { z } from "zod"
import {
  ActivityType,
  CompanyStatus,
  ContactVerificationStatus,
  LeadPriority,
  LeadStatus,
} from "@/generated/prisma/client"
import { COMPANY_TYPES, SIGNALS, SUPPORTED_CURRENCIES } from "@/lib/crm/icp-shared"
import { ALL_SENIORITIES } from "@/lib/lead-engine/scoring/engine"

function opt(max: number) {
  return z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.string().trim().max(max).optional(),
  )
}

function optUrl(max: number) {
  return z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.url("Invalid URL").trim().max(max).optional(),
  )
}

function optInt(min: number, max: number) {
  return z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.coerce.number().int().min(min).max(max).optional(),
  )
}

function optFloat(min: number, max: number) {
  return z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.coerce.number().min(min).max(max).optional(),
  )
}

function optEnum<T extends Record<string, string>>(enumObject: T) {
  return z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.nativeEnum(enumObject).optional())
}

function optDate() {
  return z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), "Invalid date").optional(),
  )
}

const optionalClearable = (max: number) =>
  z.preprocess(
    (v) => (v === "" ? null : v === undefined ? undefined : v),
    z.url("Invalid URL").trim().max(max).nullable().optional(),
  )

export const companySchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(200),
  domain: optionalClearable(255),
  website: optUrl(1024),
  industry: opt(100),
  employeeCount: optInt(1, 500000),
  employeeRange: opt(50),
  revenueRange: opt(50),
  country: opt(100),
  state: opt(100),
  city: opt(100),
  description: opt(2000),
  phone: opt(50),
  linkedinUrl: optUrl(1024),
  status: optEnum(CompanyStatus),
})

export const contactSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: opt(100),
  jobTitle: opt(200),
  department: opt(100),
  email: opt(254).refine((v) => v === undefined || z.email().safeParse(v).success, "Invalid email"),
  phone: opt(50),
  linkedinUrl: optUrl(1024),
  confidence: optFloat(0, 1),
  verificationStatus: optEnum(ContactVerificationStatus),
  companyId: opt(100),
})

export const leadSchema = z.object({
  companyId: z.string().trim().min(1, "Lead requires a company").max(100),
  contactId: opt(100),
  ownerId: opt(100),
  status: optEnum(LeadStatus),
  priority: optEnum(LeadPriority),
  source: opt(200),
  score: optInt(0, 100),
  fitScore: optInt(0, 100),
  intentScore: optInt(0, 100),
  engagementScore: optInt(0, 100),
})

export const leadListSchema = z.object({
  name: z.string().trim().min(1, "List name is required").max(200),
  description: opt(2000),
})

export const activitySchema = z
  .object({
    type: z.nativeEnum(ActivityType, { message: "Invalid activity type" }),
    title: z.string().trim().min(1, "Title is required").max(200),
    description: opt(5000),
    leadId: opt(100),
    companyId: opt(100),
    contactId: opt(100),
  })
  .refine((a) => a.leadId || a.companyId || a.contactId, {
    message: "Activity must reference a lead, company, or contact",
    path: ["leadId"],
  })

export const dealSchema = z.object({
  name: z.string().trim().min(1, "Deal name is required").max(200),
  value: z
    .string()
    .trim()
    .min(1, "Value is required")
    .regex(/^\d+(\.\d{1,2})?$/, "Invalid monetary value"),
  currency: z.string().trim().toUpperCase().max(3, "Invalid currency").default("USD"),
  stageId: z.string().trim().min(1, "Stage is required").max(100),
  leadId: opt(100),
  companyId: opt(100),
  ownerId: opt(100),
  expectedCloseDate: optDate(),
  description: opt(5000),
})

export const pipelineStageSchema = z.object({
  name: z.string().trim().min(1, "Stage name is required").max(100),
  slug: opt(100),
  position: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    z.coerce.number().int().min(0).max(1000).optional(),
  ),
  color: opt(20),
  isClosed: z.preprocess(
    (v) => (v === "true" || v === true ? true : v === "false" || v === false ? false : undefined),
    z.boolean().optional(),
  ),
  isWon: z.preprocess(
    (v) => (v === "true" || v === true ? true : v === "false" || v === false ? false : undefined),
    z.boolean().optional(),
  ),
})

function listOfStrings(max = 50) {
  return z.preprocess(
    (v) => {
      if (Array.isArray(v)) return v
      if (typeof v === "string" && v.trim() !== "") {
        try {
          const parsed = JSON.parse(v)
          return Array.isArray(parsed) ? parsed : v
        } catch {
          return v
        }
      }
      return []
    },
    z.array(z.string().trim().min(1, "Values must not be empty").max(100)).max(max),
  )
}

function enumList<T extends readonly string[]>(values: T, max = 20) {
  return z.preprocess(
    (v) => {
      if (Array.isArray(v)) return v
      if (typeof v === "string" && v.trim() !== "") {
        try {
          const parsed = JSON.parse(v)
          return Array.isArray(parsed) ? parsed : v
        } catch {
          return v
        }
      }
      return []
    },
    z.array(z.enum(values, { message: "Invalid value in list" })).max(max),
  )
}

const moneyRangeMax = 1e12
const ageMax = 200

export const icpSchema = z
  .object({
    name: z.string().trim().min(1, "ICP name is required").max(120),
    description: opt(500),
    industries: listOfStrings(),
    countries: listOfStrings(),
    regions: listOfStrings(30),
    cities: listOfStrings(30),
    employeeMin: optInt(0, 10_000_000),
    employeeMax: optInt(0, 10_000_000),
    revenueMin: optFloat(0, moneyRangeMax),
    revenueMax: optFloat(0, moneyRangeMax),
    revenueCurrency: z.preprocess(
      (v) => (v === "" || v === undefined ? undefined : v),
      z.enum(SUPPORTED_CURRENCIES, { message: "Unsupported currency" }).optional(),
    ),
    technologies: listOfStrings(),
    companyTypes: enumList(COMPANY_TYPES),
    signals: enumList(SIGNALS),
    companyAgeMin: optInt(0, ageMax),
    companyAgeMax: optInt(0, ageMax),
    excludeIndustries: listOfStrings(),
    excludeCountries: listOfStrings(),
    excludeCompanyTypes: enumList(COMPANY_TYPES),
    excludeKeywords: listOfStrings(),
    scoringKeywords: listOfStrings(),
    scoringJobTitles: listOfStrings(),
    scoringSeniorities: enumList(ALL_SENIORITIES),
    scoringDomains: listOfStrings(),
    scoringWeightIndustry: optInt(0, 100),
    scoringWeightCompanySize: optInt(0, 100),
    scoringWeightLocation: optInt(0, 100),
    scoringWeightTitle: optInt(0, 100),
    scoringWeightKeyword: optInt(0, 100),
    scoringWeightDomain: optInt(0, 100),
    scoringWeightQuality: optInt(0, 100),
    scoringThresholdHot: optInt(1, 100),
    scoringThresholdGood: optInt(1, 100),
    scoringThresholdMaybe: optInt(0, 99),
    scoringUnknownCredit: optInt(0, 100),
  })
  .refine((d) => d.employeeMax === undefined || d.employeeMin === undefined || d.employeeMax >= d.employeeMin, {
    message: "Employee maximum must be at least the minimum",
    path: ["employeeMax"],
  })
  .refine((d) => d.revenueMax === undefined || d.revenueMin === undefined || d.revenueMax >= d.revenueMin, {
    message: "Revenue maximum must be at least the minimum",
    path: ["revenueMax"],
  })
  .refine((d) => d.companyAgeMax === undefined || d.companyAgeMin === undefined || d.companyAgeMax >= d.companyAgeMin, {
    message: "Company age maximum must be at least the minimum",
    path: ["companyAgeMax"],
  })
  .refine(
    (d) =>
      d.scoringThresholdHot === undefined || d.scoringThresholdGood === undefined || d.scoringThresholdHot > d.scoringThresholdGood,
    { message: "HOT threshold must be higher than GOOD", path: ["scoringThresholdHot"] },
  )
  .refine(
    (d) =>
      d.scoringThresholdGood === undefined || d.scoringThresholdMaybe === undefined || d.scoringThresholdGood > d.scoringThresholdMaybe,
    { message: "GOOD threshold must be higher than MAYBE", path: ["scoringThresholdGood"] },
  )

export type CompanyInput = z.infer<typeof companySchema>
export type ContactInput = z.infer<typeof contactSchema>
export type LeadInput = z.infer<typeof leadSchema>
export type LeadListInput = z.infer<typeof leadListSchema>
export type ActivityInput = z.infer<typeof activitySchema>
export type DealInput = z.infer<typeof dealSchema>
export type PipelineStageInput = z.infer<typeof pipelineStageSchema>
export type IcpInput = z.infer<typeof icpSchema>