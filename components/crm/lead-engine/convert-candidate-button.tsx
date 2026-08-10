"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ArrowRightLeftIcon } from "lucide-react"
import { convertCandidateAction } from "@/lib/actions"

export function ConvertCandidateButton({ candidateId, variant = "default" }: { candidateId: string; variant?: "default" | "outline" }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Button
      size="sm"
      variant={variant}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await convertCandidateAction(candidateId)
          if (result.ok) {
            toast.success("Converted to CRM entities.")
            router.refresh()
            if (result.redirectTo) router.push(result.redirectTo)
          } else {
            toast.error(result.error ?? "Conversion failed")
          }
        })
      }
    >
      <ArrowRightLeftIcon className="size-4" />
      Convert to CRM
    </Button>
  )
}