# AGENTS.md

## Product

This repository contains **BookPilot**, a SaaS platform for **omnichannel appointment booking** for service businesses.

The system supports booking management through:

- WhatsApp
- phone calls
- a public booking website

It also includes a **web dashboard** for the business's internal operations.

Customers can book, cancel, or reschedule appointments through conversation or a web flow.

The product is designed as a **generic and configurable system**, adaptable to different service industries without changing the core product.

The core of the system is the **booking engine**: the layer responsible for availability, bookings, rescheduling, cancellations, and data consistency.

---

## Official stack

This project uses the following base stack:

### Database
- **Supabase Postgres**
- Postgres is the system's **source of truth**

### Web dashboard
- **Next.js**
- TypeScript

### Backend and orchestration
- TypeScript
- modular architecture
- custom API for business logic, channels, and integrations

### AI
- OpenAI for text and voice understanding and generation

### External channels
- WhatsApp integration
- telephony/voice integration
- public booking website

### Infrastructure
- monorepo
- SQL migrations
- external integrations only for transport, communication, or auxiliary services

Do not change this stack unless there is a clear reason and the task explicitly requires it.

---

## Architecture principles

This project follows these principles:

1. **Postgres is the source of truth**

   All domain entities, availability, bookings, and related events must live in the database.

2. **The booking engine is the core**

   Every booking, reschedule, or cancellation must go through the system's central booking logic.

3. **Clear separation of responsibilities**

   The system should maintain clear separation between:
   - input channels (WhatsApp, voice, web)
   - orchestration
   - booking engine
   - dashboard and internal UI

4. **The product is multi-tenant**

   Each organization may have:
   - locations
   - services
   - staff
   - resources
   - customers
   - schedules
   - bookings

5. **The core must remain generic**

   Avoid models or decisions that are too specific to a single industry when the problem can be solved with a more general and reusable abstraction.

6. **External integrations must not contain critical business logic**

   External services are used for communication, transport, voice, messaging, or operational support, but critical business logic must remain inside the system.

---

## Expectations for agent reasoning

Codex may propose technical solutions, internal structures, and concrete implementations as long as they:

- respect the official stack
- respect the architecture principles
- remain consistent with the domain model
- do not expand the task scope without justification

A single rigid implementation is not required if there is a better alternative within the project context.

When several reasonable options exist, prioritize:

- simplicity
- maintainability
- consistency with the existing architecture
- data safety
- ease of future evolution

---

## Repository workflow

Before considering a task complete, run the applicable project validations.

As a general rule, a task should not be considered finished if it breaks any of these validations:

- install
- lint
- typecheck
- test
- build

If any of them do not apply yet in an early project stage, state that explicitly.

---

## Coding conventions

General rules:

- use strict TypeScript
- avoid `any` unless justified
- prefer small, composable, clear functions
- use consistent and descriptive naming
- avoid unnecessary duplication
- do not introduce large dependencies without real need
- make small, focused changes

Important rules:

- business logic must not be buried inside channel handlers
- channels should act as input/output adapters
- central logic must be reusable across web, WhatsApp, and voice
- avoid coupling UI, integrations, and domain logic

---

## Database rules

The database is a critical part of the project.

Therefore:

- any schema change must go through **migrations**
- do not manually modify schema outside the migration flow
- maintain consistency with the domain model
- avoid breaking changes unless clearly necessary
- consider permissions, consistency, and future model evolution

The base domain model is expected to flexibly support entities such as:

- organizations
- locations
- staff
- resources
- services
- availability rules
- time off
- customers
- bookings
- booking events
- conversation threads
- messages
- notification jobs

This list is intended as guidance for the expected domain. It does not require implementing everything immediately or permanently locking all names from the start.

---

## Project documentation

Before modifying important parts of the system, review the relevant repository documentation.

At minimum, take these into account when they exist:

- `docs/product.md`
- `docs/architecture.md`
- `docs/domain-model.md`
- `docs/integrations.md`

If more specific `AGENTS.md` files exist inside subdirectories, their instructions take priority for that part of the codebase.

---

## Documentation maintenance

When a recurring mistake, failed assumption, or repository-specific gotcha is discovered, update the smallest relevant documentation file so future runs do not repeat it.

Use this rule of thumb:

- update `AGENTS.md` only for durable repository-wide rules
- update `docs/architecture.md` for structural decisions
- update `docs/domain-model.md` for domain or schema decisions
- update `docs/integrations.md` for provider-specific behavior, constraints, or edge cases
- update a dedicated notes file for recurring implementation gotchas

Do not create unnecessary documentation churn. Prefer precise, minimal updates.

---

## Definition of done

A task is considered complete when:

- the change solves the requested problem
- the code is consistent with the project architecture
- the code compiles or remains in a consistent state for the current project phase
- applicable validations pass
- scope was not expanded without explanation
- related files were updated when necessary

---

## Restrictions

Codex **must not**:

- change the base project stack unless the task requires it
- replace Supabase/Postgres as the system foundation
- invent parallel architecture outside the repository context
- introduce overly industry-specific models without good reason
- perform broad refactors unrelated to the task
- implement out-of-scope functionality without explaining it
- add heavy dependencies without clear justification

---

## General principle

Make **small, coherent, and well-reasoned changes**, preserving product flexibility and respecting the system's overall architecture.

---

## Documentation and process notes

Never create a new `.md` file only to describe the steps taken for a routine task.

Default behavior:

- explain completed work in the task response, commit message, or PR description
- update existing docs when persistent project knowledge changes
- create a plan document only for complex work that benefits from an explicit execution plan

Prefer updating an existing document over creating a new one.

Only create a new documentation file when the information is:

- durable
- reusable across future tasks
- clearly out of scope for existing docs

Do not create ad hoc logs such as:
- `what-was-done.md`
- `implementation-notes.md`
- `process.md`

unless explicitly requested or unless the task is large enough to justify a dedicated execution plan.

If a change affects long-term project understanding, update the relevant existing file:
- `product.md`
- `architecture.md`
- `domain-model.md`
- `integrations.md`
- `workflows.md`
- `AGENTS.md`