"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { ScraperRunStatus } from "@/generated/prisma/enums"

export function RunStatusPoller({ status }: { status: ScraperRunStatus }) {
  const router = useRouter()

  useEffect(() => {
    if (status !== ScraperRunStatus.QUEUED && status !== ScraperRunStatus.RUNNING) return
    const interval = setInterval(() => router.refresh(), 2500)
    return () => clearInterval(interval)
  }, [status, router])

  return null
}