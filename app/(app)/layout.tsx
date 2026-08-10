import { requireSession } from "@/lib/auth"
import { DesktopSidebar, MobileMenuButton } from "@/components/crm/sidebar"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession()

  return (
    <div className="flex min-h-dvh">
      <DesktopSidebar
        orgName={session.organization.name}
        userName={session.user.name}
        userEmail={session.user.email}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:px-6 lg:justify-end">
          <MobileMenuButton
            orgName={session.organization.name}
            userName={session.user.name}
            userEmail={session.user.email}
          />
          <div className="hidden lg:flex lg:items-center lg:gap-2">
            <span className="text-sm text-muted-foreground">{session.organization.name}</span>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}