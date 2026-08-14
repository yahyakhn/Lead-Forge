// TASK 020: Lead Finder setup — pick an ICP (existing or describe with AI),
// pick where to look, start the discovery run. All writes go through the
// existing server actions; this component never touches the database.

"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { parseIcpPromptAction, createICPAction, createLeadSourceAction, runScraperAction } from "@/lib/actions"
import { criteriaToInput, type ParsedIcp } from "@/lib/crm/icp-parse"
import { icpCriteriaLines } from "@/lib/lead-engine/finder"
import type { ICPCriteria } from "@/lib/crm/icp-shared"
import { SparklesIcon, WandSparklesIcon, Loader2Icon } from "lucide-react"

interface IcpOption {
  id: string
  name: string
  criteria: ICPCriteria | null
}

interface SourceOption {
  id: string
  name: string
}

interface Props {
  icps: IcpOption[]
  sources: SourceOption[]
  activeIcpId: string | null
}

const MAX_PAGES_DEFAULT = 100
const MAX_DEPTH_DEFAULT = 2

function commaToArray(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

function arrayToComma(values: string[] | undefined): string {
  return (values ?? []).join(", ")
}

export function LeadFinderSetup({ icps, sources, activeIcpId }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [mode, setMode] = useState<"existing" | "describe">(icps.length > 0 && activeIcpId ? "existing" : "describe")
  const [selectedIcpId, setSelectedIcpId] = useState(activeIcpId ?? icps[0]?.id ?? "")
  const [description, setDescription] = useState("")
  const [parseState, setParseState] = useState<"idle" | "parsing" | "error">("idle")
  const [parsed, setParsed] = useState<ParsedIcp | null>(null)
  const [editing, setEditing] = useState(false)
  const [industries, setIndustries] = useState("")
  const [countries, setCountries] = useState("")
  const [technologies, setTechnologies] = useState("")
  const [employeeMin, setEmployeeMin] = useState("")
  const [employeeMax, setEmployeeMax] = useState("")

  const [sourceMode, setSourceMode] = useState<"existing" | "url">(sources.length > 0 ? "existing" : "url")
  const [selectedSourceId, setSelectedSourceId] = useState(sources[0]?.id ?? "")
  const [url, setUrl] = useState("")
  const [maxPages, setMaxPages] = useState(String(MAX_PAGES_DEFAULT))
  const [maxDepth, setMaxDepth] = useState(String(MAX_DEPTH_DEFAULT))

  const selectedCriteria = icps.find((icp) => icp.id === selectedIcpId)?.criteria ?? null
  const activeCriteria = parsed?.criteria ?? null

  const parse = () =>
    startTransition(async () => {
      setParseState("parsing")
      const result = await parseIcpPromptAction({ text: description })
      if (result.ok && "parsed" in result) {
        setParsed(result.parsed)
        setEditing(false)
        setIndustries(arrayToComma(result.parsed.criteria.industries))
        setCountries(arrayToComma(result.parsed.criteria.countries))
        setTechnologies(arrayToComma(result.parsed.criteria.technologies))
        setEmployeeMin(result.parsed.criteria.employeeRange?.min != null ? String(result.parsed.criteria.employeeRange.min) : "")
        setEmployeeMax(result.parsed.criteria.employeeRange?.max != null ? String(result.parsed.criteria.employeeRange.max) : "")
      } else if (!result.ok) {
        setParseState("error")
        toast.error(result.error)
      }
    })

  const applyEdits = () => {
    if (!parsed) return
    setParsed({
      ...parsed,
      criteria: {
        ...parsed.criteria,
        industries: commaToArray(industries).length ? commaToArray(industries) : parsed.criteria.industries,
        countries: commaToArray(countries).length ? commaToArray(countries) : parsed.criteria.countries,
        technologies: commaToArray(technologies).length ? commaToArray(technologies) : parsed.criteria.technologies,
        employeeRange: {
          min: employeeMin.trim() ? Number(employeeMin) : undefined,
          max: employeeMax.trim() ? Number(employeeMax) : undefined,
        },
      },
    })
    setEditing(false)
  }

  const start = () =>
    startTransition(async () => {
      let icpId = selectedIcpId
      if (mode === "describe") {
        if (!parsed) {
          toast.error("Parse a description first")
          return
        }
        const name = `AI — ${description.trim().slice(0, 60)}`
        const created = await createICPAction({ name, description: description.trim(), ...criteriaToInput(parsed.criteria) })
        if (!created.ok || !created.id) {
          if (!created.ok) toast.error(created.error)
          return
        }
        icpId = created.id
      }
      if (!icpId) {
        toast.error("Select an ICP or describe one first")
        return
      }

      let sourceId = selectedSourceId
      if (sourceMode === "url") {
        const target = url.trim()
        if (!/^https?:\/\//.test(target)) {
          toast.error("Enter a full URL starting with http:// or https://")
          return
        }
        const created = await createLeadSourceAction({
          name: `Lead Finder ${new URL(target).hostname} ${Date.now().toString(36)}`,
          type: "WEBSITE",
          config: {
            startUrls: [target],
            maxPages: Number(maxPages) || MAX_PAGES_DEFAULT,
            maxDepth: Number(maxDepth) || MAX_DEPTH_DEFAULT,
          },
          isActive: true,
        })
        if (!created.ok || !created.id) {
          if (!created.ok) toast.error(created.error)
          return
        }
        sourceId = created.id
      }
      if (!sourceId) {
        toast.error("Pick a source or enter a URL first")
        return
      }

      const run = await runScraperAction(sourceId, icpId, false, "Lead Finder")
      if (!run.ok) {
        toast.error(run.error)
        return
      }
      if (run.id) {
        toast.success("Discovery started")
        router.push(`/find-leads?run=${run.id}&icp=${icpId}`)
      }
    })

  const criteriaLines = mode === "describe" ? (parsed ? icpCriteriaLines(activeCriteria) : []) : icpCriteriaLines(selectedCriteria)

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Ideal customer profile</CardTitle>
          <div className="flex gap-1 rounded-lg border bg-muted/40 p-0.5 text-xs">
            <Button
              size="sm"
              variant={mode === "existing" ? "secondary" : "ghost"}
              onClick={() => setMode("existing")}
              disabled={pending}
            >
              Existing ICP
            </Button>
            <Button
              size="sm"
              variant={mode === "describe" ? "secondary" : "ghost"}
              onClick={() => setMode("describe")}
              disabled={pending}
            >
              Describe with AI
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === "existing" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="finder-icp">Which ICP should the leads match?</Label>
                <select
                  id="finder-icp"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  value={selectedIcpId}
                  onChange={(e) => setSelectedIcpId(e.target.value)}
                  disabled={pending}
                >
                  {icps.length === 0 && <option value="">No ICPs yet — describe one with AI</option>}
                  {icps.map((icp) => (
                    <option key={icp.id} value={icp.id}>
                      {icp.name}
                    </option>
                  ))}
                </select>
              </div>
              {criteriaLines.length > 0 && (
                <ul className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                  {criteriaLines.map((line) => (
                    <li key={line}>• {line}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : parsed ? (
            <div className="space-y-4">
              {!editing ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    From <span className="font-medium text-foreground">“{description.trim()}”</span>
                  </p>
                  {criteriaLines.length > 0 ? (
                    <ul className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                      {criteriaLines.map((line) => (
                        <li key={line}>• {line}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No criteria extracted — edit them manually before continuing.</p>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={pending}>
                      Edit criteria
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setParsed(null)} disabled={pending}>
                      Start over
                    </Button>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Correct any criteria before starting the search.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Industries (comma-separated)">
                      <Input value={industries} onChange={(e) => setIndustries(e.target.value)} />
                    </Field>
                    <Field label="Countries">
                      <Input value={countries} onChange={(e) => setCountries(e.target.value)} />
                    </Field>
                    <Field label="Technologies">
                      <Input value={technologies} onChange={(e) => setTechnologies(e.target.value)} />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Employees min">
                        <Input type="number" min={0} value={employeeMin} onChange={(e) => setEmployeeMin(e.target.value)} />
                      </Field>
                      <Field label="Employees max">
                        <Input type="number" min={0} value={employeeMax} onChange={(e) => setEmployeeMax(e.target.value)} />
                      </Field>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={applyEdits} disabled={pending}>
                      Save criteria
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="finder-description">Describe your ideal customer</Label>
                <Textarea
                  id="finder-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. SaaS companies in India with 50–500 employees using React and AWS"
                  rows={3}
                />
              </div>
              <Button size="sm" variant="outline" onClick={parse} disabled={pending || parseState === "parsing" || !description.trim()}>
                {parseState === "parsing" ? <Loader2Icon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
                {parseState === "parsing" ? "Parsing…" : "Parse with AI"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Where to look</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex w-fit gap-1 rounded-lg border bg-muted/40 p-0.5 text-xs">
            <Button
              size="sm"
              variant={sourceMode === "existing" ? "secondary" : "ghost"}
              onClick={() => setSourceMode("existing")}
              disabled={pending || sources.length === 0}
            >
              Active source
            </Button>
            <Button size="sm" variant={sourceMode === "url" ? "secondary" : "ghost"} onClick={() => setSourceMode("url")} disabled={pending}>
              Public URL
            </Button>
          </div>

          {sourceMode === "existing" ? (
            <div className="space-y-1.5">
              <Label htmlFor="finder-source">Source</Label>
              <select
                id="finder-source"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                value={selectedSourceId}
                onChange={(e) => setSelectedSourceId(e.target.value)}
                disabled={pending}
              >
                {sources.length === 0 && <option value="">No sources yet — use a URL</option>}
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="finder-url">Website URL</Label>
              <Input
                id="finder-url"
                type="url"
                placeholder="https://www.example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={pending}
              />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="finder-pages">Max pages</Label>
                  <Input id="finder-pages" type="number" min={1} max={1000} value={maxPages} onChange={(e) => setMaxPages(e.target.value)} disabled={pending} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="finder-depth">Max depth</Label>
                  <Input id="finder-depth" type="number" min={0} max={5} value={maxDepth} onChange={(e) => setMaxDepth(e.target.value)} disabled={pending} />
                </div>
              </div>
            </div>
          )}

          <Button className="w-full" onClick={start} disabled={pending}>
            {pending ? <Loader2Icon className="size-4 animate-spin" /> : <WandSparklesIcon className="size-4" />}
            Find leads
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}