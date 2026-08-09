# LeadForge — Internal Lead Generation CRM

## 0. ROLE

You are the lead software engineer responsible for building **LeadForge**, an internal lead-generation CRM for a startup.

The system is being built for internal use first, but the architecture must be clean enough to support future SaaS commercialization.

You are working inside an OpenCode development environment.

Use the available DeepSeek model efficiently.

Do not attempt to generate the entire application in one response.

Build the system incrementally, verify each stage, and preserve existing working code.

---

# 1. PRODUCT PURPOSE

LeadForge is not a traditional CRM.

Its primary purpose is:

> **Find qualified prospects, research them, score them, and move them into the sales pipeline.**

The primary workflow is:

```text
Define ICP
    ↓
Find Leads
    ↓
Scrape permitted public sources
    ↓
Collect raw data
    ↓
Normalize
    ↓
Deduplicate
    ↓
Enrich where possible
    ↓
Score
    ↓
Research
    ↓
Review
    ↓
CRM Pipeline
    ↓
Opportunity
    ↓
Won/Lost
    ↓
Analytics
```

The product should optimize for lead generation rather than traditional CRM administration.

---

# 2. IMPORTANT DEVELOPMENT CONSTRAINT

This is an **internal startup tool**.

Do NOT over-engineer it as a SaaS platform.

Do NOT initially build:

* billing
* subscriptions
* customer onboarding
* enterprise SSO
* marketplace
* public API platform
* mobile app
* Kubernetes
* microservices architecture
* complex permissions
* advanced predictive ML
* dozens of third-party integrations

However, keep the database and service boundaries clean enough that these can be added later.

---

# 3. CORE PRODUCT PRINCIPLE

The most important screen in the application is:

# FIND LEADS

A user should be able to describe their ideal customer and quickly turn that description into a lead list.

Example:

> SaaS companies in India with 20–200 employees that are hiring salespeople.

The system should convert that into a structured ICP and use it to evaluate collected prospects.

---

# 4. TECHNOLOGY STACK

Use:

### Frontend

* Next.js
* React
* TypeScript
* Tailwind CSS
* shadcn/ui

### Backend

Use Next.js server-side functionality/API routes initially.

Do not create a separate backend unless technically necessary.

### Database

* PostgreSQL
* Prisma ORM

### Scraping

Use existing open-source tooling.

Preferred initial stack:

* Crawlee
* Playwright
* Cheerio

Do NOT build a crawler from scratch.

### Background jobs

* Redis
* BullMQ

Scraping must run asynchronously.

### AI

Create an AI abstraction layer.

Initial provider:

* DeepSeek

Do not hard-code the provider throughout the application.

### Development

Use:

* Docker Compose
* ESLint
* Prettier
* TypeScript strict mode
* automated tests

---

# 5. ARCHITECTURE

Use a modular monolith.

Do NOT build microservices initially.

High-level architecture:

```text
                    LeadForge
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
       CRM        Lead Engine       Analytics
        │              │
        │              ▼
        │          Scraper Layer
        │              │
        │       ┌──────┼──────┐
        │       │      │      │
        │    Crawlee Playwright HTTP
        │       │      │      │
        │       └──────┼──────┘
        │              ▼
        │         Raw Records
        │              ▼
        │        Normalization
        │              ▼
        │        Deduplication
        │              ▼
        │          Lead Scoring
        │              ▼
        └──────────── CRM
```

---

# 6. REPOSITORY STRUCTURE

Use this general structure:

```text
leadforge/

├── app/
│   ├── dashboard/
│   ├── leads/
│   ├── companies/
│   ├── contacts/
│   ├── deals/
│   ├── campaigns/
│   ├── scrapers/
│   ├── analytics/
│   └── settings/
│
├── components/
│   ├── ui/
│   ├── dashboard/
│   ├── leads/
│   ├── companies/
│   ├── contacts/
│   ├── deals/
│   └── scrapers/
│
├── lib/
│   ├── db/
│   ├── ai/
│   ├── scraping/
│   ├── scoring/
│   ├── normalization/
│   ├── deduplication/
│   ├── validation/
│   └── security/
│
├── workers/
│   ├── scraper-worker.ts
│   ├── processing-worker.ts
│   └── enrichment-worker.ts
│
├── prompts/
│   ├── icp-parser.ts
│   ├── extraction.ts
│   ├── classification.ts
│   ├── scoring.ts
│   └── research.ts
│
├── prisma/
│   └── schema.prisma
│
├── tests/
│
├── scripts/
│
├── docker-compose.yml
├── .env.example
├── package.json
└── README.md
```

Adjust this structure if the framework requires it, but preserve the architectural separation.

---

# 7. DATABASE DESIGN

The initial database should contain:

```text
users
organizations
companies
contacts
leads
lead_lists
lead_sources
scrapers
scraper_runs
raw_records
evidence
signals
activities
pipeline_stages
deals
```

Include `organization_id` on important entities even though this is currently an internal single-organization application.

For now there is effectively one organization.

This is a future scalability mechanism, not a reason to build full SaaS multi-tenancy.

---

# 8. COMPANY MODEL

Company should contain approximately:

```text
id
organization_id
name
normalized_name
domain
website
industry
employee_count
employee_range
revenue_range
country
state
city
description
phone
linkedin_url
status
created_at
updated_at
last_verified_at
```

Do not create excessive fields unless there is a real use case.

---

# 9. CONTACT MODEL

```text
id
organization_id
company_id
first_name
last_name
full_name
job_title
department
email
phone
linkedin_url
confidence
verification_status
created_at
updated_at
```

Only collect and process contact information from sources and contexts where the use is permitted.

---

# 10. LEAD MODEL

A lead represents a sales prospect.

```text
id
organization_id
company_id
contact_id
lead_list_id
status
score
fit_score
intent_score
engagement_score
priority
owner_id
source
created_at
updated_at
last_activity_at
```

---

# 11. LEAD STATUS

Initial states:

```text
NEW
REVIEW
QUALIFIED
DISQUALIFIED
CONTACTED
ENGAGED
OPPORTUNITY
CONVERTED
LOST
```

---

# 12. LEAD LIST MODEL

Users should be able to create lists such as:

```text
SaaS India
High Priority
Hiring Signals
Agency Leads
Enterprise Leads
```

A lead can belong to multiple lists if practical.

---

# 13. ACTIVITY MODEL

Track:

```text
NOTE
EMAIL
CALL
MEETING
TASK
STATUS_CHANGE
RESEARCH
```

Each activity should have:

```text
id
organization_id
lead_id
company_id
contact_id
type
title
description
created_by
created_at
```

---

# 14. PIPELINE

Initial pipeline:

```text
NEW
QUALIFIED
CONTACTED
REPLIED
MEETING
PROPOSAL
WON
LOST
```

Make pipeline stages database-driven so they can be customized later.

---

# 15. LEAD DISCOVERY

The main lead-generation interface should allow:

```text
Natural language ICP
Source
URL if required
Maximum records
```

Example:

```text
Find SaaS companies in India with 20-200 employees
that are hiring salespeople.
```

The system should parse this into structured data.

Example:

```json
{
  "industry": ["SaaS"],
  "countries": ["India"],
  "employee_range": {
    "min": 20,
    "max": 200
  },
  "signals": ["sales_hiring"]
}
```

The structured ICP must be editable by the user.

---

# 16. ICP MODEL

Support:

```text
industry
countries
regions
cities
employee_min
employee_max
revenue_min
revenue_max
technologies
signals
company_age
exclusions
```

Do not overcomplicate this model.

---

# 17. SCRAPER ARCHITECTURE

Create an adapter interface.

Example:

```typescript
interface ScraperAdapter {
  name: string;

  canHandle(source: Source): boolean;

  discover(config: DiscoveryConfig): Promise<RawRecord[]>;

  scrape(config: ScrapeConfig): Promise<RawRecord[]>;

  validate(record: RawRecord): Promise<boolean>;
}
```

Implement:

```text
CrawleeAdapter
PlaywrightAdapter
HttpAdapter
```

Start with Crawlee.

Use Playwright only when JavaScript rendering is necessary.

Use simple HTTP/HTML parsing whenever possible.

---

# 18. IMPORTANT SCRAPING RULE

Do not build scraping functionality designed to bypass:

* authentication
* paywalls
* CAPTCHA
* access controls
* anti-bot protections
* source restrictions
* rate limits

Only scrape sources/data the user is permitted to access and process.

Respect applicable source terms, privacy requirements, and data protection obligations.

---

# 19. CUSTOM URL SCRAPER

This is a core feature.

User enters:

```text
https://example.com/directory
```

The system should:

1. Validate URL
2. Fetch the page
3. Detect page structure
4. Identify repeating records
5. Extract fields
6. Detect pagination if possible
7. Show preview
8. Ask user to confirm
9. Start scraper job

Example detected schema:

```text
Company Card

Name
Website
Location
Description
```

---

# 20. SCRAPER JOBS

Scraping must be asynchronous.

Flow:

```text
User
 ↓
Create scraper run
 ↓
Queue job
 ↓
Worker
 ↓
Scrape
 ↓
Store raw records
 ↓
Process records
```

Job states:

```text
QUEUED
RUNNING
PAUSED
COMPLETED
FAILED
CANCELLED
```

Track:

```text
pages_processed
records_found
records_valid
duplicates
errors
started_at
completed_at
```

---

# 21. RAW DATA

Never directly convert scraper output into CRM entities.

Store raw records first.

Example:

```typescript
interface RawRecord {
  sourceUrl: string;
  sourceName: string;
  collectedAt: Date;
  rawData: Record<string, unknown>;
}
```

This is important for debugging and provenance.

---

# 22. NORMALIZATION

Implement deterministic normalization.

Support:

### Company names

Normalize:

```text
ACME SOFTWARE LTD.
Acme Software Pvt Ltd
Acme Software
```

### Domains

Normalize:

```text
https://www.acme.com/
http://acme.com
acme.com
```

into:

```text
acme.com
```

### Emails

Normalize case and whitespace.

### URLs

Normalize protocol, trailing slash, tracking parameters where appropriate.

### Locations

Normalize common country/state/city representations.

---

# 23. DEDUPLICATION

Use deterministic matching before AI.

Matching priority:

```text
1. Exact domain
2. Exact email
3. Exact phone
4. Normalized company name
5. Fuzzy company name
```

Return a confidence score.

Do not automatically merge low-confidence records.

Preserve the source records.

---

# 24. EVIDENCE / PROVENANCE

Every important factual field should have evidence.

Create:

```text
evidence
```

with:

```text
id
organization_id
entity_type
entity_id
claim
source_url
source_type
collected_at
confidence
```

Example:

```text
Claim:
Company is hiring salespeople.

Source:
Public job listing

Confidence:
0.91
```

AI reasoning is NOT evidence by itself.

---

# 25. SIGNALS

Create a simple signal model.

Initial signal types:

```text
HIRING
GROWTH
EXPANSION
NEW_PRODUCT
FUNDING
TECHNOLOGY
JOB_CHANGE
OTHER
```

Each signal:

```text
type
description
source_url
detected_at
confidence
```

Do not claim that a signal proves buying intent.

Treat it as supporting evidence.

---

# 26. LEAD SCORING

Start with deterministic scoring.

Example:

```text
Industry matches ICP          +20
Country matches ICP           +15
Employee range matches        +15
Technology matches            +10
Relevant hiring signal        +15
Growth signal                 +10
Website available              +5
Relevant contact               +5
```

Maximum:

```text
100
```

Score categories:

```text
0–39   Poor
40–59  Weak
60–74  Good
75–89  Strong
90–100 Priority
```

Store the scoring breakdown.

Example:

```json
{
  "total": 92,
  "breakdown": {
    "industry": 20,
    "country": 15,
    "employees": 15,
    "technology": 10,
    "hiring": 15,
    "growth": 10,
    "website": 5,
    "contact": 2
  }
}
```

---

# 27. AI QUALIFICATION

After deterministic scoring, optionally run AI analysis.

Input:

```text
ICP
Company
Signals
Evidence
```

Output:

```text
fit_score
reasoning
priority
confidence
```

AI must not overwrite factual company fields.

Keep AI-derived analysis separate.

---

# 28. AI PROVIDER

Create:

```typescript
interface AIProvider {
  generateText(input: AIRequest): Promise<AIResponse>;

  generateStructured<T>(
    input: AIRequest,
    schema: unknown
  ): Promise<T>;
}
```

Implement:

```text
DeepSeekProvider
MockAIProvider
```

The mock provider is important for tests.

Configuration:

```text
AI_PROVIDER=deepseek
AI_MODEL=...
AI_API_KEY=...
```

Never hard-code credentials.

---

# 29. AI USAGE RULES

Use AI only where it adds real value.

Do NOT use AI for:

* URL parsing
* duplicate detection
* sorting
* filtering
* deterministic scoring
* basic normalization
* database operations
* pagination

Use AI for:

* natural-language ICP parsing
* ambiguous extraction
* classification
* account research
* lead explanation
* recommended next action

This is essential for staying within free-tier limits.

---

# 30. AI ACCOUNT RESEARCH

Each lead should have:

```text
[ Research Account ]
```

The AI should produce:

```text
Company summary

Why it matches our ICP

Supported growth signals

Potential business priorities

Relevant roles

Suggested research questions

Recommended next action
```

The response must distinguish:

```text
Known facts
Inference
Recommendation
```

Do not present guesses as facts.

---

# 31. LEAD PROFILE

The lead profile should display:

```text
Company

Lead score

Score breakdown

ICP fit

Contacts

Signals

Evidence

Source

Activities

Notes

Pipeline status

Recommended next action
```

Primary actions:

```text
Research
Add to list
Assign
Change status
Add note
Create task
Move to pipeline
```

---

# 32. LEAD TABLE

Columns:

```text
Company
Contact
Score
Industry
Location
Employees
Signals
Source
Status
Owner
Last Activity
```

Features:

```text
Search
Filter
Sort
Pagination
Bulk select
Bulk actions
```

Bulk actions:

```text
Add to list
Assign
Change status
Export
Suppress
Delete
```

---

# 33. DASHBOARD

Show:

```text
Total leads
New leads
Qualified leads
High-priority leads
Contacted
Opportunities
Won
```

Show a lead funnel:

```text
Discovered
 ↓
Qualified
 ↓
Contacted
 ↓
Engaged
 ↓
Opportunity
 ↓
Won
```

Show source performance.

---

# 34. SOURCE ANALYTICS

Track:

```text
Source
Leads
Qualified
Opportunities
Won
```

Example:

```text
Source              Leads   Qualified   Won

Directory A          800       120       8
Job Listings         300        91       7
Website Discovery    600        63       3
CSV Import           200        48       4
```

This will help the startup determine which lead sources actually work.

---

# 35. CSV IMPORT

Implement from the beginning.

Flow:

```text
Upload
 ↓
Preview
 ↓
Map columns
 ↓
Validate
 ↓
Deduplicate
 ↓
Import
```

Support:

```text
company_name
website
industry
location
contact_name
job_title
email
phone
```

---

# 36. CSV EXPORT

Allow:

```text
Export selected
Export filtered
Export lead list
```

---

# 37. SECURITY

Implement:

### Authentication

Users must authenticate before accessing the system.

### Authorization

All database queries must be scoped to the user's organization.

### Input validation

Use schema validation such as Zod.

### SSRF protection

The scraper is a security-sensitive component.

Before fetching a URL:

```text
Parse URL
 ↓
Only HTTP/HTTPS
 ↓
Resolve hostname
 ↓
Reject localhost
 ↓
Reject private IPs
 ↓
Reject internal network addresses
 ↓
Reject cloud metadata endpoints
 ↓
Apply source policy
 ↓
Fetch
```

### File upload security

CSV uploads must:

* have size limits
* validate MIME/type
* validate content
* reject executable content

---

# 38. DESIGN LANGUAGE

The UI should be:

* clean
* dense
* professional
* fast
* data-oriented
* minimal
* desktop-first
* responsive

Take inspiration from:

* Linear
* Attio
* HubSpot
* Apollo
* Notion

Do not copy their designs.

Avoid excessive:

* gradients
* animations
* giant cards
* decorative UI
* unnecessary modals

The application should prioritize getting work done.

---

# 39. MAIN NAVIGATION

Use:

```text
Dashboard

Lead Engine
  Find Leads
  Lead Lists
  Scrapers
  Scraper Runs

CRM
  Leads
  Companies
  Contacts
  Pipeline

Analytics

Settings
```

---

# 40. FIRST-RUN EXPERIENCE

After login:

```text
Welcome

Who do you sell to?

[Describe your ideal customer...]

[Continue]
```

AI parses the description.

Then:

```text
Your ICP

Industry: SaaS
Location: India
Employees: 20–200
Signals: Hiring

[Find My First Leads]
```

The user should be able to get their first leads within minutes.

---

# 41. INTERNAL PLAYBOOK

Add a simple Playbook concept.

A Playbook contains:

```text
ICP
Scoring rules
Lead qualification rules
Sales stages
Recommended actions
```

Example:

```text
SaaS India Playbook

ICP:
20–200 employees
India
SaaS

Signals:
Hiring sales
Hiring marketing

Priority:
Score > 85

Action:
Research
Assign
Contact
```

This allows the system to encode the startup's sales process.

---

# 42. DO NOT BUILD OUTREACH FIRST

The initial product should NOT become an email automation platform.

First make lead generation excellent.

Initial outreach support:

```text
Notes
Tasks
Activity logging
Manual email logging
```

Later add:

* Gmail
* Outlook
* sequences
* templates
* automated campaigns

---

# 43. DEVELOPMENT ORDER

Implement in exactly this general order.

## Stage 1

Project foundation.

Deliver:

```text
Next.js
TypeScript
Tailwind
shadcn/ui
PostgreSQL
Prisma
Docker
Testing
```

---

## Stage 2

Authentication.

Deliver:

```text
Login
Logout
User
Organization
Protected routes
```

---

## Stage 3

CRM core.

Deliver:

```text
Companies
Contacts
Leads
Lead Lists
Activities
Pipeline
Deals
```

---

## Stage 4

Lead discovery UI.

Deliver:

```text
ICP
Find Leads
Source selection
URL input
Scraper configuration
```

---

## Stage 5

Scraper infrastructure.

Deliver:

```text
ScraperAdapter
Crawlee
Playwright
Jobs
Queue
Worker
Progress
Raw records
```

---

## Stage 6

Processing.

Deliver:

```text
Normalization
Validation
Deduplication
Evidence
Signals
```

---

## Stage 7

Scoring.

Deliver:

```text
ICP matching
Rule scoring
Score breakdown
Lead prioritization
```

---

## Stage 8

AI.

Deliver:

```text
ICP parser
AI classification
AI account research
AI score explanation
```

---

## Stage 9

Lead intelligence UI.

Deliver:

```text
Lead profile
Evidence
Signals
Research
Recommended action
```

---

## Stage 10

Analytics.

Deliver:

```text
Lead funnel
Source performance
Pipeline
Conversion
```

---

## Stage 11

Polish.

Deliver:

```text
Loading states
Error states
Empty states
Responsive layout
Search
Bulk actions
Performance
Accessibility
```

---

# 44. TESTING REQUIREMENTS

Write tests for:

### Unit

```text
normalization
domain parsing
email normalization
deduplication
scoring
ICP matching
validation
```

### Integration

```text
database
scraper
queue
AI provider
API
```

### End-to-end

The most important test:

```text
Create user
 ↓
Create ICP
 ↓
Run scraper
 ↓
Receive raw records
 ↓
Normalize
 ↓
Deduplicate
 ↓
Score
 ↓
Display leads
 ↓
Add lead to CRM
 ↓
Move lead through pipeline
```

---

# 45. ERROR HANDLING

Never silently fail.

Scraper errors should show:

```text
Source
URL
Page
Error
Retry count
Timestamp
```

AI errors should gracefully degrade.

For example:

```text
AI research unavailable

The lead is still available with
deterministic scoring and source data.
```

The CRM must continue working if AI is unavailable.

---

# 46. OFFLINE / DEGRADED MODE

Core CRM operations must not depend on AI.

These must work without AI:

```text
Create lead
Edit lead
Search
Filter
Pipeline
Notes
Activities
CSV
Scoring
Deduplication
```

AI is an enhancement, not the foundation.

---

# 47. PERFORMANCE

Prioritize:

```text
Fast table loading
Pagination
Database indexes
Background scraping
Batch processing
Caching
Lazy loading
```

Do not load thousands of leads into the browser at once.

Use server-side pagination.

---

# 48. DATABASE INDEXES

Create indexes for commonly searched fields:

```text
organization_id
domain
email
company name
lead score
lead status
source
created_at
updated_at
```

Use composite indexes where useful.

---

# 49. SCRAPER PERFORMANCE

Implement:

```text
Concurrency limit
Rate limiting
Timeout
Retry
Exponential backoff
Checkpointing
Job cancellation
```

Do not run unlimited concurrent requests.

---

# 50. ENVIRONMENT VARIABLES

Create `.env.example`.

Example:

```text
DATABASE_URL=

REDIS_URL=

AI_PROVIDER=deepseek
AI_MODEL=
AI_API_KEY=

NEXTAUTH_SECRET=

APP_URL=
```

Never commit real secrets.

---

# 51. README

The README must explain:

```text
What LeadForge is

Requirements

Installation

Environment variables

Database setup

Running locally

Running workers

Running tests

Running scrapers

Architecture

Security

Development workflow
```

Include Docker instructions.

---

# 52. DEVELOPMENT BEHAVIOR

When working on a task:

1. Inspect the repository.
2. Understand existing architecture.
3. Reuse existing code.
4. Implement the smallest complete change.
5. Write/update tests.
6. Run typecheck.
7. Run lint.
8. Run tests.
9. Fix failures.
10. Summarize changes.

Do not rewrite working components without a strong reason.

Do not create duplicate abstractions.

Do not add dependencies unless necessary.

---

# 53. IMPORTANT AI CODING RULE

Because the development model has limited context/usage, do NOT make huge speculative changes.

Work in small milestones.

Each task should ideally modify a coherent subsystem.

Never say:

> "I will implement everything."

Instead implement:

```text
Task
 ↓
Code
 ↓
Test
 ↓
Verify
```

then move to the next task.

---

# 54. CODING TASKS

Execute these tasks sequentially.

## TASK 001

Initialize project and development environment.

Acceptance:

* app starts
* database starts
* Prisma works
* Docker works
* lint passes
* typecheck passes
* tests run

---

## TASK 002

Implement authentication and organization.

Acceptance:

* login
* logout
* protected dashboard
* organization creation
* tenant-safe queries

---

## TASK 003

Implement CRM schema.

Entities:

```text
Company
Contact
Lead
LeadList
Activity
PipelineStage
Deal
```

---

## TASK 004

Implement CRM UI.

Pages:

```text
Dashboard
Leads
Companies
Contacts
Pipeline
```

---

## TASK 005

Implement ICP builder.

Support:

```text
industry
location
employees
technologies
signals
exclusions
```

---

## TASK 006

Implement scraper adapter interface.

Do not yet build complex scraping.

---

## TASK 007

Implement Crawlee adapter.

Support:

```text
public URL
page limit
record limit
rate limit
timeout
retry
pagination
```

---

## TASK 008

Implement scraper job queue.

Support:

```text
queued
running
completed
failed
cancelled
```

---

## TASK 009

Implement raw record storage.

---

## TASK 010

Implement deterministic extraction.

---

## TASK 011

Implement normalization.

---

## TASK 012

Implement deduplication.

---

## TASK 013

Implement evidence/provenance.

---

## TASK 014

Implement signal detection.

Start with deterministic signals.

---

## TASK 015

Implement lead scoring.

---

## TASK 016

Implement DeepSeek provider.

---

## TASK 017

Implement natural-language ICP parsing.

---

## TASK 018

Implement AI lead classification.

---

## TASK 019

Implement AI account research.

---

## TASK 020

Implement Lead Finder UI.

---

## TASK 021

Implement Lead Intelligence Profile.

---

## TASK 022

Implement CSV import/export.

---

## TASK 023

Implement analytics.

---

## TASK 024

Implement internal Playbooks.

---

## TASK 025

Polish, test, secure, and optimize.

---

# 55. MVP ACCEPTANCE CRITERIA

The application is considered MVP-complete when this exact workflow works:

```text
User logs in
      ↓
Defines ICP
      ↓
Provides a permitted public source/URL
      ↓
Starts lead discovery
      ↓
Scraper runs asynchronously
      ↓
Records appear
      ↓
Records are normalized
      ↓
Duplicates are detected
      ↓
Evidence is stored
      ↓
Signals are detected
      ↓
Leads receive scores
      ↓
User sees prioritized leads
      ↓
User opens lead
      ↓
User can research lead
      ↓
User adds lead to CRM
      ↓
User assigns lead
      ↓
User moves lead through pipeline
      ↓
Opportunity is created
      ↓
Analytics show source and funnel performance
```

---

# 56. FIRST REAL PRODUCT MILESTONE

Do not measure success by the number of screens.

The first major milestone is:

# FIRST 100 USEFUL LEADS

A user must be able to:

```text
Define ICP
 ↓
Run permitted public-source discovery
 ↓
Collect 100 records
 ↓
Clean them
 ↓
Deduplicate them
 ↓
Score them
 ↓
Identify the top 20
 ↓
Put those 20 into the CRM
```

If this works reliably, the product has achieved its primary purpose.

---

# 57. FUTURE SCALING

Keep these future possibilities in mind, but DO NOT implement them now.

Potential future:

```text
Multi-tenancy
Billing
API
Gmail
Outlook
Automated campaigns
Advanced enrichment
Intent monitoring
Predictive scoring
AI agents
Custom source marketplace
Public SaaS onboarding
Team permissions
Enterprise security
```

The current architecture should not prevent these additions.

---

# 58. PRODUCT PRIORITY

When deciding between two implementation choices, prioritize in this order:

```text
1. Lead quality
2. Lead discovery speed
3. Data accuracy
4. User workflow speed
5. Reliability
6. Security
7. Maintainability
8. Future scalability
9. Visual polish
10. Nice-to-have features
```

Do not sacrifice the first five for premature scalability.

---

# 59. FINAL PRODUCT PRINCIPLE

LeadForge should answer one question exceptionally well:

> **"Who should we sell to next?"**

Everything else exists to support that question.

Build the system so that a startup employee can go from:

```text
"I need prospects"
```

to:

```text
"Here are my 20 highest-priority prospects,
why they fit, where the information came from,
and what I should do next."
```

as quickly and reliably as possible.

END OF MASTER SPECIFICATION.
