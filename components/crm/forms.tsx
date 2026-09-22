"use client"

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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { useState, useTransition, type ReactNode, type FormEvent } from "react"
import type { ActionResult } from "@/lib/actions"
import {
  CompanyStatus,
  ContactVerificationStatus,
  LeadPriority,
  LeadStatus,
  ActivityType,
} from "@/generated/prisma/enums"
import { SearchableSelect, type SearchOption } from "@/components/crm/searchable-select"

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  )
}

export function FormDialog({
  title,
  description,
  trigger,
  submitLabel = "Save",
  onSubmit,
  children,
  className,
}: {
  title: string
  description?: string
  trigger: ReactNode
  submitLabel?: string
  onSubmit: (values: Record<string, unknown>) => Promise<ActionResult>
  children: ReactNode
  className?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState("")

  return (
    <Dialog>
      <DialogTrigger>{trigger}</DialogTrigger>
      <DialogContent className={className}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault()
            setError("")
            const values = Object.fromEntries(new FormData(e.currentTarget).entries())
            startTransition(async () => {
              const result = await onSubmit(values)
              if (result.ok) {
                toast.success("Saved")
                if (result.redirectTo) window.location.href = result.redirectTo
                else router.refresh()
              } else {
                setError(result.error)
              }
            })
          }}
        >
          <div className="grid gap-4">{children}</div>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="mt-4">
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending} className="bg-primary">
              {pending ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SimpleSelectField({
  name,
  label,
  options,
  placeholder,
  defaultValue,
  className,
}: {
  name: string
  label: string
  options: { value: string; label: string }[]
  placeholder: string
  defaultValue?: string
  className?: string
}) {
  const [value, setValue] = useState(defaultValue ?? "")
  return (
    <Field label={label} className={className}>
      <input type="hidden" name={name} value={value} />
      <SearchableSelect
        options={options}
        value={value}
        onValueChange={setValue}
        placeholder={placeholder}
        className="w-full"
      />
    </Field>
  )
}

function enumOptions<T extends Record<string, string>>(e: T): { value: string; label: string }[] {
  return Object.entries(e)
    .filter(([, v]) => typeof v === "string")
    .map(([k, v]) => ({ value: v, label: k }))
}

export const LEAD_STATUS_OPTIONS = enumOptions(LeadStatus)
export const LEAD_PRIORITY_OPTIONS = enumOptions(LeadPriority)
export const COMPANY_STATUS_OPTIONS = enumOptions(CompanyStatus)
export const VERIFICATION_OPTIONS = enumOptions(ContactVerificationStatus)
export const ACTIVITY_TYPE_OPTIONS = enumOptions(ActivityType)

export function CompanyForm({ action }: { action: (input: unknown) => Promise<ActionResult> }) {
  return (
    <FormDialog
      title="New Company"
      description="Add a company to your CRM."
      trigger={<Button>New Company</Button>}
      submitLabel="Create Company"
      onSubmit={action}
      className="sm:max-w-lg"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name *">
          <Input name="name" required placeholder="Acme Software" />
        </Field>
        <Field label="Domain">
          <Input name="domain" placeholder="acme.com" />
        </Field>
        <Field label="Website">
          <Input name="website" type="url" placeholder="https://acme.com" />
        </Field>
        <Field label="Industry">
          <Input name="industry" placeholder="SaaS" />
        </Field>
        <Field label="Employee count">
          <Input name="employeeCount" type="number" min={1} placeholder="120" />
        </Field>
        <Field label="Employee range">
          <Input name="employeeRange" placeholder="20-200" />
        </Field>
        <Field label="Country">
          <Input name="country" placeholder="India" />
        </Field>
        <Field label="State">
          <Input name="state" placeholder="Karnataka" />
        </Field>
        <Field label="City">
          <Input name="city" placeholder="Bangalore" />
        </Field>
        <Field label="Status">
          <SimpleSelectField name="status" label="Status" options={COMPANY_STATUS_OPTIONS} placeholder="Select status" />
        </Field>
        <Field label="Phone">
          <Input name="phone" placeholder="+91 98... " />
        </Field>
        <Field label="LinkedIn URL">
          <Input name="linkedinUrl" type="url" placeholder="https://linkedin.com/company/..." />
        </Field>
      </div>
      <Field label="Description">
        <Textarea name="description" rows={3} placeholder="What does this company do?" />
      </Field>
    </FormDialog>
  )
}

function useFormAction(action: (input: unknown) => Promise<ActionResult>) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState("")
  const submit = (values: Record<string, unknown>) => {
    setError("")
    startTransition(async () => {
      const result = await action(values)
      if (result.ok) {
        toast.success("Saved")
        router.refresh()
      } else {
        setError(result.error)
      }
    })
  }
  return { pending, error, submit }
}

export function LeadForm({
  action,
  companies,
  contacts,
  owners,
  defaultCompanyId,
}: {
  action: (input: unknown) => Promise<ActionResult>
  companies: SearchOption[]
  contacts: SearchOption[]
  owners: SearchOption[]
  defaultCompanyId?: string
}) {
  const { pending, error, submit } = useFormAction(action)
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? "")
  const [contactId, setContactId] = useState("")
  const [ownerId, setOwnerId] = useState("")
  const [status, setStatus] = useState("NEW")
  const [priority, setPriority] = useState("MEDIUM")

  return (
    <Dialog>
      <DialogTrigger>
        <Button>New Lead</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Lead</DialogTitle>
          <DialogDescription>Add a prospect to your pipeline.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            submit({
              companyId,
              contactId,
              ownerId,
              status,
              priority,
              source: fd.get("source") ?? "",
            })
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company *">
              <input type="hidden" name="companyId" value={companyId} />
              <SearchableSelect
                options={companies}
                value={companyId}
                onValueChange={setCompanyId}
                placeholder="Select company"
                className="w-full"
              />
            </Field>
            <Field label="Contact">
              <input type="hidden" name="contactId" value={contactId} />
              <SearchableSelect
                options={contacts}
                value={contactId}
                onValueChange={setContactId}
                placeholder="Select contact"
                className="w-full"
              />
            </Field>
            <Field label="Status">
              <input type="hidden" name="status" value={status} />
              <SearchableSelect
                options={LEAD_STATUS_OPTIONS}
                value={status}
                onValueChange={setStatus}
                placeholder="Status"
                className="w-full"
              />
            </Field>
            <Field label="Priority">
              <input type="hidden" name="priority" value={priority} />
              <SearchableSelect
                options={LEAD_PRIORITY_OPTIONS}
                value={priority}
                onValueChange={setPriority}
                placeholder="Priority"
                className="w-full"
              />
            </Field>
            <Field label="Owner">
              <input type="hidden" name="ownerId" value={ownerId} />
              <SearchableSelect
                options={owners}
                value={ownerId}
                onValueChange={setOwnerId}
                placeholder="Assign owner"
                className="w-full"
              />
            </Field>
            <Field label="Source">
              <Input name="source" placeholder="e.g. LinkedIn, Directory" defaultValue="" />
            </Field>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Create Lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CompanyEditForm({
  action,
  company,
}: {
  action: (input: unknown) => Promise<ActionResult>
  company: {
    id: string
    name: string
    domain: string | null
    website: string | null
    industry: string | null
    employeeCount: number | null
    employeeRange: string | null
    country: string | null
    state: string | null
    city: string | null
    description: string | null
    phone: string | null
    linkedinUrl: string | null
    status: string
  }
}) {
  const { pending, error, submit } = useFormAction(action)
  const [status, setStatus] = useState(company.status)
  return (
    <Dialog>
      <DialogTrigger>
        <Button variant="outline">Edit Company</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {company.name}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            submit({ ...Object.fromEntries(fd.entries()), status })
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name *">
              <Input name="name" required defaultValue={company.name} />
            </Field>
            <Field label="Domain">
              <Input name="domain" defaultValue={company.domain ?? ""} placeholder="acme.com" />
            </Field>
            <Field label="Website">
              <Input name="website" type="url" defaultValue={company.website ?? ""} />
            </Field>
            <Field label="Industry">
              <Input name="industry" defaultValue={company.industry ?? ""} />
            </Field>
            <Field label="Employee count">
              <Input name="employeeCount" type="number" min={1} defaultValue={company.employeeCount ?? ""} />
            </Field>
            <Field label="Employee range">
              <Input name="employeeRange" defaultValue={company.employeeRange ?? ""} />
            </Field>
            <Field label="Country">
              <Input name="country" defaultValue={company.country ?? ""} />
            </Field>
            <Field label="State">
              <Input name="state" defaultValue={company.state ?? ""} />
            </Field>
            <Field label="City">
              <Input name="city" defaultValue={company.city ?? ""} />
            </Field>
            <Field label="Status">
              <input type="hidden" name="status" value={status} />
              <SearchableSelect options={COMPANY_STATUS_OPTIONS} value={status} onValueChange={setStatus} placeholder="Status" className="w-full" />
            </Field>
            <Field label="Phone">
              <Input name="phone" defaultValue={company.phone ?? ""} />
            </Field>
            <Field label="LinkedIn URL">
              <Input name="linkedinUrl" type="url" defaultValue={company.linkedinUrl ?? ""} />
            </Field>
          </div>
          <Field label="Description">
            <Textarea name="description" rows={3} defaultValue={company.description ?? ""} />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ContactForm({
  action,
  companies,
  defaultCompanyId,
}: {
  action: (input: unknown) => Promise<ActionResult>
  companies: SearchOption[]
  defaultCompanyId?: string
}) {
  const { pending, error, submit } = useFormAction(action)
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? "")

  return (
    <Dialog>
      <DialogTrigger>
        <Button>New Contact</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Contact</DialogTitle>
          <DialogDescription>Add a contact to your CRM.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            submit({ ...Object.fromEntries(fd.entries()), companyId })
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name *">
              <Input name="firstName" required placeholder="Jane" />
            </Field>
            <Field label="Last name">
              <Input name="lastName" placeholder="Doe" />
            </Field>
            <Field label="Job title">
              <Input name="jobTitle" placeholder="VP Marketing" />
            </Field>
            <Field label="Department">
              <Input name="department" placeholder="Marketing" />
            </Field>
            <Field label="Company">
              <input type="hidden" name="companyId" value={companyId} />
              <SearchableSelect
                options={companies}
                value={companyId}
                onValueChange={setCompanyId}
                placeholder="Select company"
                className="w-full"
              />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" placeholder="jane@acme.com" />
            </Field>
            <Field label="Phone">
              <Input name="phone" placeholder="+1 555 0100" />
            </Field>
            <Field label="LinkedIn URL">
              <Input name="linkedinUrl" type="url" placeholder="https://linkedin.com/in/..." />
            </Field>
          </div>
          <Field label="Verification status">
            <SimpleSelectField name="verificationStatus" label="Verification" options={VERIFICATION_OPTIONS} placeholder="Select status" />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Create Contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function LeadListForm({ action }: { action: (input: unknown) => Promise<ActionResult> }) {
  return (
    <FormDialog
      title="New Lead List"
      description="Group leads into a list for a campaign or segment."
      trigger={<Button>New List</Button>}
      submitLabel="Create List"
      onSubmit={action}
      className="sm:max-w-md"
    >
      <Field label="Name *">
        <Input name="name" required placeholder="SaaS India" />
      </Field>
      <Field label="Description">
        <Textarea name="description" rows={3} placeholder="What is this list for?" />
      </Field>
    </FormDialog>
  )
}

export function ActivityForm({
  action,
  leadId,
  companyId,
  contactId,
  trigger,
}: {
  action: (input: unknown) => Promise<ActionResult>
  leadId?: string
  companyId?: string
  contactId?: string
  trigger?: ReactNode
}) {
  const [type, setType] = useState("NOTE")
  return (
    <FormDialog
      title="Add Activity"
      trigger={trigger ?? <Button variant="outline">Add Activity</Button>}
      submitLabel="Add Activity"
      onSubmit={action}
      className="sm:max-w-md"
    >
      {leadId ? <input type="hidden" name="leadId" value={leadId} /> : null}
      {companyId ? <input type="hidden" name="companyId" value={companyId} /> : null}
      {contactId ? <input type="hidden" name="contactId" value={contactId} /> : null}
      <Field label="Type">
        <input type="hidden" name="type" value={type} />
        <SearchableSelect options={ACTIVITY_TYPE_OPTIONS} value={type} onValueChange={setType} placeholder="Type" className="w-full" />
      </Field>
      <Field label="Title *">
        <Input name="title" required placeholder="Spoke with prospect" />
      </Field>
      <Field label="Description">
        <Textarea name="description" rows={3} placeholder="Details…" />
      </Field>
    </FormDialog>
  )
}

export function DealForm({
  action,
  stages,
  owners,
  leadId,
  defaultName,
}: {
  action: (input: unknown) => Promise<ActionResult>
  stages: SearchOption[]
  owners: SearchOption[]
  leadId?: string
  defaultName?: string
}) {
  const [stageId, setStageId] = useState("")
  const [ownerId, setOwnerId] = useState("")
  return (
    <FormDialog
      title="Create Deal"
      trigger={<Button>New Deal</Button>}
      submitLabel="Create Deal"
      onSubmit={action}
      className="sm:max-w-md"
    >
      {leadId ? <input type="hidden" name="leadId" value={leadId} /> : null}
      <Field label="Name *">
        <Input name="name" required defaultValue={defaultName} placeholder="Acme — Annual plan" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Value *">
          <Input name="value" required defaultValue="0" inputMode="decimal" placeholder="12000" />
        </Field>
        <Field label="Currency">
          <Input name="currency" defaultValue="USD" maxLength={3} />
        </Field>
        <Field label="Stage *">
          <input type="hidden" name="stageId" value={stageId} />
          <SearchableSelect options={stages} value={stageId} onValueChange={setStageId} placeholder="Select stage" className="w-full" />
        </Field>
        <Field label="Owner">
          <input type="hidden" name="ownerId" value={ownerId} />
          <SearchableSelect options={owners} value={ownerId} onValueChange={setOwnerId} placeholder="Assign owner" className="w-full" />
        </Field>
      </div>
      <Field label="Expected close date">
        <Input name="expectedCloseDate" type="date" />
      </Field>
      <Field label="Description">
        <Textarea name="description" rows={3} placeholder="Deal context…" />
      </Field>
    </FormDialog>
  )
}

export function AddToListDialog({
  lists,
  leadId,
  add,
  remove,
}: {
  lists: { id: string; name: string; member: boolean }[]
  leadId: string
  add: (listId: string, leadId: string) => Promise<ActionResult>
  remove: (listId: string, leadId: string) => Promise<ActionResult>
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(lists.map((l) => [l.id, l.member])),
  )
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState("")

  return (
    <Dialog>
      <DialogTrigger>
        <Button variant="outline">Add to List</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to List</DialogTitle>
          <DialogDescription>Select one or more lists for this lead.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          {lists.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No lists yet. Create a list first on the Lead Lists page.
            </p>
          ) : (
            lists.map((l) => (
              <Label key={l.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                <input
                  type="checkbox"
                  checked={checked[l.id] ?? false}
                  onChange={(e) => setChecked((c) => ({ ...c, [l.id]: e.target.checked }))}
                />
                <span className="text-sm">{l.name}</span>
              </Label>
            ))
          )}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError("")
                for (const l of lists) {
                  const want = checked[l.id] ?? false
                  if (want && !l.member) {
                    const r = await add(l.id, leadId)
                    if (!r.ok) return setError(r.error)
                  }
                  if (!want && l.member) {
                    const r = await remove(l.id, leadId)
                    if (!r.ok) return setError(r.error)
                  }
                }
                toast.success("Lists updated")
              })
            }
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ContactEditForm({
  action,
  contact,
  companies,
}: {
  action: (input: unknown) => Promise<ActionResult>
  contact: {
    id: string
    firstName: string
    lastName: string | null
    jobTitle: string | null
    department: string | null
    companyId: string | null
    email: string | null
    phone: string | null
    linkedinUrl: string | null
    verificationStatus: string
  }
  companies: SearchOption[]
}) {
  const { pending, error, submit } = useFormAction(action)
  const [companyId, setCompanyId] = useState(contact.companyId ?? "")
  const [verificationStatus, setVerificationStatus] = useState(contact.verificationStatus)
  return (
    <Dialog>
      <DialogTrigger>
        <Button variant="outline">Edit Contact</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {contact.firstName} {contact.lastName ?? ""}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            submit({ ...Object.fromEntries(fd.entries()), companyId, verificationStatus })
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name *">
              <Input name="firstName" required defaultValue={contact.firstName} />
            </Field>
            <Field label="Last name">
              <Input name="lastName" defaultValue={contact.lastName ?? ""} />
            </Field>
            <Field label="Job title">
              <Input name="jobTitle" defaultValue={contact.jobTitle ?? ""} />
            </Field>
            <Field label="Department">
              <Input name="department" defaultValue={contact.department ?? ""} />
            </Field>
            <Field label="Company">
              <input type="hidden" name="companyId" value={companyId} />
              <SearchableSelect options={companies} value={companyId} onValueChange={setCompanyId} placeholder="Select company" className="w-full" />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" defaultValue={contact.email ?? ""} />
            </Field>
            <Field label="Phone">
              <Input name="phone" defaultValue={contact.phone ?? ""} />
            </Field>
            <Field label="LinkedIn URL">
              <Input name="linkedinUrl" type="url" defaultValue={contact.linkedinUrl ?? ""} />
            </Field>
            <Field label="Verification status">
              <input type="hidden" name="verificationStatus" value={verificationStatus} />
              <SearchableSelect options={VERIFICATION_OPTIONS} value={verificationStatus} onValueChange={setVerificationStatus} placeholder="Verification" className="w-full" />
            </Field>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
