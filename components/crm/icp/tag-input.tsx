"use client"

import { Input } from "@/components/ui/input"
import { XIcon } from "lucide-react"
import { useState, type KeyboardEvent } from "react"

export function TagInput({
  values,
  onChange,
  placeholder,
  ariaLabel,
}: {
  values: string[]
  onChange: (values: string[]) => void
  placeholder: string
  ariaLabel: string
}) {
  const [draft, setDraft] = useState("")

  const add = (raw: string) => {
    const value = raw.trim()
    if (!value) return
    if (values.some((v) => v.toLowerCase() === value.toLowerCase())) return
    onChange([...values, value])
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      add(draft)
      setDraft("")
    } else if (e.key === "Backspace" && !draft && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-card p-1.5 focus-within:ring-2 focus-within:ring-ring focus-within:outline-none">
      {values.map((value) => (
        <span
          key={value}
          className="inline-flex items-center gap-1 rounded-md border bg-muted/60 px-1.5 py-0.5 text-xs font-medium"
        >
          {value}
          <button
            type="button"
            aria-label={`Remove ${value}`}
            className="rounded-sm text-muted-foreground hover:text-foreground"
            onClick={() => onChange(values.filter((v) => v !== value))}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      <Input
        value={draft}
        aria-label={ariaLabel}
        placeholder={values.length === 0 ? placeholder : ""}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (draft.trim()) {
            add(draft)
            setDraft("")
          }
        }}
        className="h-6 w-36 border-0 shadow-none focus-visible:ring-0"
      />
    </div>
  )
}