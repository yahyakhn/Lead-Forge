"use client"

import { useState, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { UploadIcon } from "lucide-react"
import type { CsvPreview, CsvStrategy } from "@/lib/lead-engine/csv/service"

const MAPPABLE_OPTIONS = [
  { label: "Company name", value: "company.name" },
  { label: "Domain", value: "company.domain" },
  { label: "Website", value: "company.website" },
  { label: "Company status", value: "company.status" },
  { label: "Industry", value: "company.industry" },
  { label: "Employees (count)", value: "company.employeeCount" },
  { label: "Employees (range)", value: "company.employeeRange" },
  { label: "Revenue (range)", value: "company.revenueRange" },
  { label: "Country", value: "company.country" },
  { label: "State", value: "company.state" },
  { label: "City", value: "company.city" },
  { label: "Description", value: "company.description" },
  { label: "Company phone", value: "company.phone" },
  { label: "LinkedIn (company)", value: "company.linkedinUrl" },
  { label: "Contact first name", value: "contact.firstName" },
  { label: "Contact last name", value: "contact.lastName" },
  { label: "Job title", value: "contact.jobTitle" },
  { label: "Department", value: "contact.department" },
  { label: "Email", value: "contact.email" },
  { label: "Phone", value: "contact.phone" },
  { label: "LinkedIn (contact)", value: "contact.linkedinUrl" },
  { label: "Lead status", value: "lead.status" },
  { label: "Lead priority", value: "lead.priority" },
  { label: "Lead source", value: "lead.source" },
  { label: "Owner", value: "lead.owner" },
]

const NONE = "__none__"

const STATUS_STYLES: Record<string, string> = {
  NEW: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40",
  EXISTING: "bg-slate-100 text-slate-800 dark:bg-slate-900/40",
  DUPLICATE: "bg-amber-100 text-amber-800 dark:bg-amber-900/40",
  INVALID: "bg-red-100 text-red-800 dark:bg-red-900/40",
}

export function CsvImportDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [csv, setCsv] = useState("")
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [strategy, setStrategy] = useState<CsvStrategy>("CREATE")
  const [preview, setPreview] = useState<CsvPreview | null>(null)
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  const runPreview = (text: string, map: Record<string, string> = mapping) =>
    startTransition(async () => {
      setError("")
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text, mapping: map, strategy }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Couldn't preview this CSV")
        setPreview(null)
        return
      }
      setCsv(text)
      setMapping(data.mapping ?? map)
      setPreview(data)
    })

  const handleFile = (file: File | undefined) => {
    if (!file) return
    if (file.size > 1_000_000) {
      setError("File is larger than the 1 MB limit")
      return
    }
    file.text().then((text) => runPreview(text))
  }

  const confirmImport = () =>
    startTransition(async () => {
      setError("")
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, mapping, strategy, confirm: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Import failed")
        return
      }
      toast.success(
        `Imported ${data.created} new, ${data.updated} updated, ${data.duplicates} duplicates, ${data.skipped} skipped, ${data.failed} failed`,
      )
      setOpen(false)
      setPreview(null)
      setCsv("")
      router.refresh()
    })

  const reset = () => {
    setPreview(null)
    setCsv("")
    setMapping({})
    setError("")
    if (fileRef.current) fileRef.current.value = ""
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <UploadIcon />
        Import CSV
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import leads from CSV</DialogTitle>
          <DialogDescription>
            Preview first — every row is validated and matched against existing companies, contacts and leads before anything
            is imported.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,text/csv"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-sm text-muted-foreground hover:bg-muted/50"
            >
              <UploadIcon className="size-6" />
              Choose a CSV file
            </button>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                Choose another file
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,text/csv"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Duplicates:</span>
                <Select value={strategy} onValueChange={(v) => setStrategy(v as CsvStrategy)}>
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CREATE">Create new</SelectItem>
                    <SelectItem value="UPDATE">Update existing</SelectItem>
                    <SelectItem value="SKIP">Skip</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Column mapping</p>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
                {preview.headers.map((header) => {
                  const value = (preview.mapping[header] ?? "") || NONE
                  const tag = preview.ambiguousColumns.includes(header)
                    ? "ambiguous"
                    : preview.protectedColumns.includes(header)
                      ? "protected"
                      : preview.unknownColumns.includes(header)
                        ? "unmapped"
                        : null
                  return (
                    <div key={header} className="flex items-center gap-2">
                      <span className="w-40 shrink-0 truncate text-xs font-medium">{header}</span>
                      {tag && <span className="text-[10px] text-amber-600">{tag}</span>}
                      <Select
                        value={value}
                        onValueChange={(v) => {
                          const next = { ...mapping, [header]: v === NONE || !v ? "" : v }
                          setMapping(next)
                          runPreview(csv, next)
                        }}
                      >
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Don&apos;t import</SelectItem>
                          {MAPPABLE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES.NEW}`}>{preview.newRows} new</span>
              <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES.EXISTING}`}>{preview.existingRows} existing</span>
              <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES.DUPLICATE}`}>{preview.duplicateRows} duplicates</span>
              <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES.INVALID}`}>{preview.invalidRows} invalid</span>
              <span className="ml-auto self-center text-muted-foreground">{preview.totalRows} rows total</span>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <tbody>
                  {preview.sample.map((row) => (
                    <tr key={row.row} className="border-b last:border-0">
                      <td className="px-2 py-1">
                        <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES[row.status]}`}>{row.status}</span>
                      </td>
                      <td className="max-w-56 truncate px-2 py-1 text-muted-foreground">{row.matchReason ?? row.errors.map((e) => e.error).join("; ") ?? ""}</td>
                      <td className="max-w-80 truncate px-2 py-1">{row.values.join(" | ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          {preview && (
            <Button disabled={pending || preview.invalidRows === preview.totalRows} onClick={confirmImport}>
              Import {preview.validRows} row{preview.validRows === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}