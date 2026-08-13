"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  DialogClose,
  DialogHeader,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { logoutAction } from "@/lib/actions"
import { cn } from "@/lib/utils"
import {
  Building2Icon,
  ContactIcon,
  FlaskConicalIcon,
  KanbanSquareIcon,
  LayoutDashboardIcon,
  ListIcon,
  MenuIcon,
  RadarIcon,
  LayersIcon,
  ScanLineIcon,
  TargetIcon,
  Users2Icon,
  ChevronsUpDownIcon,
  LogOutIcon,
  XIcon,
  SparklesIcon,
  SettingsIcon,
  MailIcon,
  ShieldCheckIcon,
} from "lucide-react"

interface NavItem {
  href: string
  label: string
  icon: typeof LayoutDashboardIcon
}

interface NavGroup {
  section?: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  { items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon }] },
  {
    section: "Lead Engine",
    items: [
      { href: "/find-leads", label: "Find Leads", icon: RadarIcon },
      { href: "/icp", label: "ICP Profiles", icon: TargetIcon },
      { href: "/lead-lists", label: "Lead Lists", icon: ListIcon },
      { href: "/scrapers", label: "Scrapers", icon: ScanLineIcon },
      { href: "/scrapers/runs", label: "Scraper Runs", icon: FlaskConicalIcon },
      { href: "/lead-engine/candidates", label: "Candidates", icon: RadarIcon },
      { href: "/lead-engine/duplicates", label: "Duplicates", icon: LayersIcon },
      { href: "/lead-engine/enrichment", label: "Enrichment", icon: SparklesIcon },
      { href: "/lead-engine/email/discovery", label: "Email Discovery", icon: MailIcon },
      { href: "/lead-engine/email/verification", label: "Email Verification", icon: ShieldCheckIcon },
    ],
  },
  {
    section: "CRM",
    items: [
      { href: "/leads", label: "Leads", icon: Users2Icon },
      { href: "/companies", label: "Companies", icon: Building2Icon },
      { href: "/contacts", label: "Contacts", icon: ContactIcon },
      { href: "/pipeline", label: "Pipeline", icon: KanbanSquareIcon },
    ],
  },
  {
    section: "Settings",
    items: [{ href: "/settings/enrichment", label: "Enrichment", icon: SettingsIcon }, { href: "/settings/email", label: "Email", icon: MailIcon }],
  },
]

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
      {NAV.map((group, i) => (
        <div key={i} className="space-y-0.5">
          {group.section ? (
            <p className="px-2 pb-1 text-[0.7rem] font-medium tracking-widest text-muted-foreground/70 uppercase">
              {group.section}
            </p>
          ) : null}
          {group.items.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <item.icon className="size-4 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

function UserMenu({ orgName, userName, userEmail }: { orgName: string; userName: string; userEmail: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className="w-full justify-start gap-2 px-2" aria-label="User menu" />}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-xs font-semibold">
          {userName.slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">
          <span className="block truncate text-sm font-medium">{userName}</span>
          <span className="block truncate text-xs text-muted-foreground">{userEmail}</span>
        </span>
        <ChevronsUpDownIcon className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{orgName}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <form action={logoutAction}>
          <button type="submit" className="w-full">
            <DropdownMenuItem className="w-full cursor-pointer">
              <LogOutIcon /> Log out
            </DropdownMenuItem>
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DesktopSidebar({ orgName, userName, userEmail }: { orgName: string; userName: string; userEmail: string }) {
  const pathname = usePathname()
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-muted/30 lg:flex">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
          LF
        </span>
        <span className="text-sm font-semibold">LeadForge</span>
        <span className="ml-1 truncate text-xs text-muted-foreground">{orgName}</span>
      </div>
      <NavLinks pathname={pathname} />
      <div className="border-t p-2">
        <UserMenu orgName={orgName} userName={userName} userEmail={userEmail} />
      </div>
    </aside>
  )
}

export function MobileMenuButton({ orgName, userName, userEmail }: { orgName: string; userName: string; userEmail: string }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon" className="-ml-2 lg:hidden" aria-label="Open menu" />}>
        <MenuIcon />
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="top-0 left-0 h-dvh w-72 max-w-[85vw] translate-x-0 -translate-y-0 rounded-none p-0 sm:max-w-[85vw] lg:hidden">
        <div className="flex h-full flex-col">
          <DialogHeader className="border-b p-4">
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
                LF
              </span>
              LeadForge
            </DialogTitle>
            <DialogClose className="absolute top-2 right-2" render={<Button variant="ghost" size="icon-sm" aria-label="Close menu" />}>
              <XIcon />
            </DialogClose>
          </DialogHeader>
          <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
          <div className="border-t p-2">
            <UserMenu orgName={orgName} userName={userName} userEmail={userEmail} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}