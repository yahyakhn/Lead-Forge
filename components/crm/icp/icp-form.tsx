"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import type { ActionResult } from "@/lib/actions"
import { TagInput } from "@/components/crm/icp/tag-input"
import { CriteriaSummary } from "@/components/crm/icp/criteria-summary"
import { SearchableSelect, type SearchOption } from "@/components/crm/searchable-select"
import {
  COMPANY_TYPES,
  EMPLOYEE_PRESETS,
  SIGNALS,
  SUPPORTED_CURRENCIES,
  humanize,
  normalizeCriteria,
  type ICPCriteria,
} from "@/lib/crm/icp-shared"
import { ALL_SENIORITIES, DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS, DEFAULT_UNKNOWN_CREDIT } from "@/lib/lead-engine/scoring/engine"
import { cn } from "@/lib/utils"

const CURRENCY_OPTIONS: SearchOption[] = SUPPORTED_CURRENCIES.map((c) => ({ value: c, label: c }))
const COMPANY_TYPE_OPTIONS = COMPANY_TYPES.map((t) => ({ value: t, label: humanize(t) }))
const SIGNAL_OPTIONS = SIGNALS.map((s) => ({ value: s, label: humanize(s) }))
const SENIORITY_OPTIONS = ALL_SENIORITIES.map((s) => ({ value: s, label: humanize(s) }))
const WEIGHT_KEYS = ["industry", "companySize", "location", "title", "keyword", "domain", "quality"] as const

export interface ICPFormInitial {
  name: string
  description: string | null
  criteria: ICPCriteria
}

function toNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const n = Number(trimmed)
  return Number.isNaN(n) ? undefined : n
}

function rangeToInput(value: number | undefined): string {
  return value !== undefined && value !== null ? String(value) : ""
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <div className="grid gap-4">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  )
}

function CheckboxGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: string; label: string }[]
  value: string[]
  onChange: (value: string[]) => void
}) {
  return (
    <Field label={label}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {options.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.includes(option.value)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, option.value] : value.filter((v) => v !== option.value))
              }
              className="size-4 accent-primary"
            />
            {option.label}
          </label>
        ))}
      </div>
    </Field>
  )
}

export function ICPForm({
  action,
  submitLabel,
  initial,
}: {
  action: (input: unknown) => Promise<ActionResult>
  submitLabel: string
  initial?: ICPFormInitial
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState("")

  const [name, setName] = useState(initial?.name ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [industries, setIndustries] = useState<string[]>(initial?.criteria.industries ?? [])
  const [countries, setCountries] = useState<string[]>(initial?.criteria.countries ?? [])
  const [regions, setRegions] = useState<string[]>(initial?.criteria.regions ?? [])
  const [cities, setCities] = useState<string[]>(initial?.criteria.cities ?? [])
  const [employeeMin, setEmployeeMin] = useState(rangeToInput(initial?.criteria.employeeRange?.min))
  const [employeeMax, setEmployeeMax] = useState(rangeToInput(initial?.criteria.employeeRange?.max))
  const [revenueMin, setRevenueMin] = useState(rangeToInput(initial?.criteria.revenueRange?.min))
  const [revenueMax, setRevenueMax] = useState(rangeToInput(initial?.criteria.revenueRange?.max))
  const [currency, setCurrency] = useState(initial?.criteria.revenueRange?.currency ?? "USD")
  const [technologies, setTechnologies] = useState<string[]>(initial?.criteria.technologies ?? [])
  const [companyTypes, setCompanyTypes] = useState<string[]>(initial?.criteria.companyTypes ?? [])
  const [signals, setSignals] = useState<string[]>(initial?.criteria.signals ?? [])
  const [ageMin, setAgeMin] = useState(rangeToInput(initial?.criteria.companyAge?.min))
  const [ageMax, setAgeMax] = useState(rangeToInput(initial?.criteria.companyAge?.max))
  const [excludeIndustries, setExcludeIndustries] = useState<string[]>(initial?.criteria.exclusions.industries ?? [])
  const [excludeCountries, setExcludeCountries] = useState<string[]>(initial?.criteria.exclusions.countries ?? [])
  const [excludeCompanyTypes, setExcludeCompanyTypes] = useState<string[]>(initial?.criteria.exclusions.companyTypes ?? [])
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>(initial?.criteria.exclusions.keywords ?? [])

  const scoring = initial?.criteria.scoring ?? {
    keywords: [],
    jobTitles: [],
    seniorities: [],
    domains: [],
    weights: DEFAULT_WEIGHTS,
    thresholds: DEFAULT_THRESHOLDS,
    unknownCredit: DEFAULT_UNKNOWN_CREDIT,
  }
  const [scoringKeywords, setScoringKeywords] = useState<string[]>(scoring.keywords)
  const [scoringJobTitles, setScoringJobTitles] = useState<string[]>(scoring.jobTitles)
  const [scoringSeniorities, setScoringSeniorities] = useState<string[]>(scoring.seniorities)
  const [scoringDomains, setScoringDomains] = useState<string[]>(scoring.domains)
  const [scoringWeights, setScoringWeights] = useState<Record<string, number>>(scoring.weights)
  const [scoringThresholdHot, setScoringThresholdHot] = useState<number>(scoring.thresholds.hot)
  const [scoringThresholdGood, setScoringThresholdGood] = useState<number>(scoring.thresholds.good)
  const [scoringThresholdMaybe, setScoringThresholdMaybe] = useState<number>(scoring.thresholds.maybe)
  const [scoringUnknownCredit, setScoringUnknownCredit] = useState<number>(scoring.unknownCredit)

  const liveCriteria = normalizeCriteria({
    industries, countries, regions, cities,
    employeeMin: toNumber(employeeMin), employeeMax: toNumber(employeeMax),
    revenueMin: toNumber(revenueMin), revenueMax: toNumber(revenueMax), revenueCurrency: currency,
    technologies, companyTypes, signals,
    companyAgeMin: toNumber(ageMin), companyAgeMax: toNumber(ageMax),
    excludeIndustries, excludeCountries, excludeCompanyTypes, excludeKeywords,
    scoringKeywords, scoringJobTitles, scoringSeniorities, scoringDomains,
    scoringWeightIndustry: scoringWeights.industry,
    scoringWeightCompanySize: scoringWeights.companySize,
    scoringWeightLocation: scoringWeights.location,
    scoringWeightTitle: scoringWeights.title,
    scoringWeightKeyword: scoringWeights.keyword,
    scoringWeightDomain: scoringWeights.domain,
    scoringWeightQuality: scoringWeights.quality,
    scoringThresholdHot,
    scoringThresholdGood,
    scoringThresholdMaybe,
    scoringUnknownCredit,
  })

  const applyPreset = (preset: (typeof EMPLOYEE_PRESETS)[number]) => {
    setEmployeeMin(String(preset.min))
    setEmployeeMax(preset.max !== undefined ? String(preset.max) : "")
  }

  const activePreset = (preset: (typeof EMPLOYEE_PRESETS)[number]) => {
    const presetMin = String(preset.min)
    const presetMax = preset.max !== undefined ? String(preset.max) : ""
    return employeeMin === presetMin && employeeMax === presetMax
  }

  const updateWeight = (key: string, value: number) => {
    setScoringWeights((prev) => ({ ...prev, [key]: Math.max(0, Math.min(100, value)) }))
  }

  const submit = () => {
    setError("")
    startTransition(async () => {
      const result = await action({
        name,
        description: description.trim() || undefined,
        industries, countries, regions, cities,
        employeeMin: toNumber(employeeMin), employeeMax: toNumber(employeeMax),
        revenueMin: toNumber(revenueMin), revenueMax: toNumber(revenueMax),
        revenueCurrency: currency,
        technologies, companyTypes, signals,
        companyAgeMin: toNumber(ageMin), companyAgeMax: toNumber(ageMax),
        excludeIndustries, excludeCountries, excludeCompanyTypes, excludeKeywords,
        scoringKeywords, scoringJobTitles, scoringSeniorities, scoringDomains,
        scoringWeightIndustry: scoringWeights.industry,
        scoringWeightCompanySize: scoringWeights.companySize,
        scoringWeightLocation: scoringWeights.location,
        scoringWeightTitle: scoringWeights.title,
        scoringWeightKeyword: scoringWeights.keyword,
        scoringWeightDomain: scoringWeights.domain,
        scoringWeightQuality: scoringWeights.quality,
        scoringThresholdHot,
        scoringThresholdGood,
        scoringThresholdMaybe,
        scoringUnknownCredit,
      })
      if (result.ok) {
        toast.success(submitLabel === "Create ICP" ? "ICP created." : "ICP updated.")
        router.push("/icp")
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <form
      className="grid gap-6 lg:grid-cols-[1fr_320px]"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="space-y-6">
        <Section title="Basic Information">
          <Field label="ICP Name *">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="India SaaS ICP" />
          </Field>
          <Field label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} placeholder="Mid-market SaaS companies in India that are actively growing." />
          </Field>
        </Section>

        <Section title="Company Profile">
          <Field label="Industries">
            <TagInput values={industries} onChange={setIndustries} placeholder="Add industry (e.g. SaaS)" ariaLabel="Add industry" />
          </Field>
          <CheckboxGroup label="Company type" options={COMPANY_TYPE_OPTIONS} value={companyTypes} onChange={setCompanyTypes} />
        </Section>

        <Section title="Geography">
          <Field label="Countries">
            <TagInput values={countries} onChange={setCountries} placeholder="Add country (e.g. India)" ariaLabel="Add country" />
          </Field>
          <Field label="Regions / States">
            <TagInput values={regions} onChange={setRegions} placeholder="Add region or state" ariaLabel="Add region" />
          </Field>
          <Field label="Cities">
            <TagInput values={cities} onChange={setCities} placeholder="Add city" ariaLabel="Add city" />
          </Field>
        </Section>

        <Section title="Company Size">
          <Field label="Employee range">
            <div className="flex flex-wrap items-center gap-2">
              <Input type="number" min={0} value={employeeMin} onChange={(e) => setEmployeeMin(e.target.value)} placeholder="Min" className="w-28" inputMode="numeric" />
              <span className="text-muted-foreground">–</span>
              <Input type="number" min={0} value={employeeMax} onChange={(e) => setEmployeeMax(e.target.value)} placeholder="Max" className="w-28" inputMode="numeric" />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EMPLOYEE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                    activePreset(preset)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Revenue minimum (USD)">
              <Input type="number" min={0} value={revenueMin} onChange={(e) => setRevenueMin(e.target.value)} placeholder="e.g. 1000000" inputMode="decimal" />
            </Field>
            <Field label="Revenue maximum (USD)">
              <Input type="number" min={0} value={revenueMax} onChange={(e) => setRevenueMax(e.target.value)} placeholder="e.g. 50000000" inputMode="decimal" />
            </Field>
            <Field label="Currency">
              <SearchableSelect options={CURRENCY_OPTIONS} value={currency} onValueChange={setCurrency} placeholder="Currency" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Company age minimum (years)">
              <Input type="number" min={0} max={200} value={ageMin} onChange={(e) => setAgeMin(e.target.value)} placeholder="Min" inputMode="numeric" />
            </Field>
            <Field label="Company age maximum (years)">
              <Input type="number" min={0} max={200} value={ageMax} onChange={(e) => setAgeMax(e.target.value)} placeholder="Max" inputMode="numeric" />
            </Field>
          </div>
        </Section>

        <Section title="Technologies">
          <Field label="Technologies">
            <TagInput values={technologies} onChange={setTechnologies} placeholder="Add technology (e.g. AWS, React, Stripe)" ariaLabel="Add technology" />
          </Field>
        </Section>

        <Section title="Signals">
          <CheckboxGroup label="Signals we care about" options={SIGNAL_OPTIONS} value={signals} onChange={setSignals} />
        </Section>

        <Section title="Exclusions">
          <Field label="Excluded industries">
            <TagInput values={excludeIndustries} onChange={setExcludeIndustries} placeholder="e.g. Government, Non-profit" ariaLabel="Add excluded industry" />
          </Field>
          <Field label="Excluded countries">
            <TagInput values={excludeCountries} onChange={setExcludeCountries} placeholder="Add country to exclude" ariaLabel="Add excluded country" />
          </Field>
          <CheckboxGroup label="Excluded company types" options={COMPANY_TYPE_OPTIONS} value={excludeCompanyTypes} onChange={setExcludeCompanyTypes} />
          <Field label="Excluded keywords">
            <TagInput values={excludeKeywords} onChange={setExcludeKeywords} placeholder="e.g. consulting, outsourcing" ariaLabel="Add excluded keyword" />
          </Field>
        </Section>

        <Section title="Lead Scoring Configuration">
          <Field label="Target Keywords">
            <TagInput values={scoringKeywords} onChange={setScoringKeywords} placeholder="e.g. CRM, SaaS, sales, automation" ariaLabel="Add target keyword" />
            <p className="text-xs text-muted-foreground">Keywords to match against company name, description, industry, and title.</p>
          </Field>
          <Field label="Target Job Titles">
            <TagInput values={scoringJobTitles} onChange={setScoringJobTitles} placeholder="e.g. CEO, CTO, VP Sales, Head of Growth" ariaLabel="Add target job title" />
            <p className="text-xs text-muted-foreground">Exact or partial title matches (normalized).</p>
          </Field>
          <CheckboxGroup label="Target Seniorities" options={SENIORITY_OPTIONS} value={scoringSeniorities} onChange={setScoringSeniorities} />
          <Field label="Target Domains">
            <TagInput values={scoringDomains} onChange={setScoringDomains} placeholder="e.g. software.com, example.io" ariaLabel="Add target domain" />
            <p className="text-xs text-muted-foreground">Domain patterns to match (supports subdomain matching).</p>
          </Field>

          <div className="grid gap-4">
            <Field label="Qualification Thresholds">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs font-medium">HOT ≥</Label>
                  <Input type="number" min={1} max={100} value={scoringThresholdHot} onChange={(e) => setScoringThresholdHot(Number(e.target.value))} inputMode="numeric" />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs font-medium">GOOD ≥</Label>
                  <Input type="number" min={1} max={100} value={scoringThresholdGood} onChange={(e) => setScoringThresholdGood(Number(e.target.value))} inputMode="numeric" />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs font-medium">MAYBE ≥</Label>
                  <Input type="number" min={0} max={99} value={scoringThresholdMaybe} onChange={(e) => setScoringThresholdMaybe(Number(e.target.value))} inputMode="numeric" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Scores below MAYBE are classified as LOW.</p>
            </Field>
            <Field label="Unknown Data Credit (%)">
              <Input type="number" min={0} max={100} value={scoringUnknownCredit} onChange={(e) => setScoringUnknownCredit(Number(e.target.value))} inputMode="numeric" />
              <p className="text-xs text-muted-foreground">Partial credit when a criterion has no data (default 40%).</p>
            </Field>
          </div>

          <Field label="Criterion Weights (sum normalizes to 100)">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {WEIGHT_KEYS.map((key) => (
                <div key={key} className="grid gap-1.5">
                  <Label className="text-xs font-medium capitalize">{key}</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={scoringWeights[key] ?? DEFAULT_WEIGHTS[key]}
                    onChange={(e) => updateWeight(key, Number(e.target.value))}
                    inputMode="numeric"
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Weights are automatically normalized to sum to 100.</p>
          </Field>
        </Section>
      </div>

      <aside className="h-fit rounded-xl border bg-card p-4 lg:sticky lg:top-20">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">ICP Summary</h2>
        <div className="mt-3">
          <CriteriaSummary criteria={liveCriteria} />
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={() => router.push("/icp")}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : submitLabel}
          </Button>
        </div>
      </aside>
    </form>
  )
}