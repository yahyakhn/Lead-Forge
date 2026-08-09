import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">LeadForge</h1>
        <Badge>internal</Badge>
      </div>
      <p className="text-lg text-muted-foreground">
        Find qualified prospects, research them, score them, and move them into
        the sales pipeline.
      </p>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project foundation</CardTitle>
          <CardDescription>
            Next.js, TypeScript, Tailwind, shadcn/ui, PostgreSQL, and Prisma are
            configured. The CRM and lead engine are built in upcoming stages.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button render={<a href="/api/health" />}>Check system status</Button>
        </CardContent>
      </Card>
    </main>
  )
}
