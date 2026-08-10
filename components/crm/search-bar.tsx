"use client"

import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { SearchIcon } from "lucide-react"

export interface FilterOption {
  value: string
  label: string
}

export function SearchInput({
  param = "search",
  placeholder = "Search...",
  className,
}: {
  param?: string
  placeholder?: string
  className?: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlValue = searchParams.get(param) ?? ""
  const [local, setLocal] = useState(urlValue)
  const [prevUrl, setPrevUrl] = useState(urlValue)
  if (urlValue !== prevUrl) {
    setPrevUrl(urlValue)
    setLocal(urlValue)
  }
  const skip = useRef(true)

  useEffect(() => {
    if (skip.current) {
      skip.current = false
      return
    }
    const timer = setTimeout(() => {
      const search = new URLSearchParams(searchParams)
      if (local) search.set(param, local)
      else search.delete(param)
      search.set("page", "1")
      router.replace(`${pathname}?${search.toString()}`, { scroll: false })
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local])

  return (
    <div className={`relative ${className ?? ""}`}>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        role="searchbox"
        aria-label={placeholder}
        placeholder={placeholder}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        className="h-8 w-56 pl-8"
      />
    </div>
  )
}

export function FilterSelect({
  param,
  placeholder,
  options,
  className,
}: {
  param: string
  placeholder: string
  options: FilterOption[]
  className?: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const value = searchParams.get(param) ?? ""

  return (
    <Select
      value={value}
      onValueChange={(v) => {
        const search = new URLSearchParams(searchParams)
        if (v) search.set(param, v)
        else search.delete(param)
        search.set("page", "1")
        router.replace(`${pathname}?${search.toString()}`, { scroll: false })
      }}
    >
      <SelectTrigger className={className} data-placeholder={!value ? "" : undefined}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}