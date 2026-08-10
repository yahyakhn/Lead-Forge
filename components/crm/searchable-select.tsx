"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { useState } from "react"
import { SearchIcon } from "lucide-react"

export interface SearchOption {
  value: string
  label: string
  hint?: string
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder,
  className,
}: {
  options: SearchOption[]
  value: string
  onValueChange: (value: string) => void
  placeholder: string
  className?: string
}) {
  const [query, setQuery] = useState("")

  const filtered = query
    ? options.filter(
        (o) => o.label.toLowerCase().includes(query.toLowerCase()) || o.hint?.toLowerCase().includes(query.toLowerCase()),
      )
    : options

  return (
    <Select value={value} onValueChange={(v) => onValueChange(v ?? "")}>
      <SelectTrigger className={className} data-placeholder={!value ? "" : undefined}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <div className="relative border-b p-1.5">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            role="combobox"
            aria-label={`Search ${placeholder}`}
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 pl-7 text-sm"
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">No matches</p>
        ) : (
          filtered.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <span className="truncate">{o.label}</span>
              {o.hint ? <span className="text-xs text-muted-foreground">{o.hint}</span> : null}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  )
}