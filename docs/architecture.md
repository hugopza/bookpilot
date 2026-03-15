# Architecture

## Purpose

This document defines the high-level architecture of **BookPilot**.

Its purpose is to clarify:

- the main system components
- the separation of responsibilities between layers
- where business logic should live
- how channels interact with the booking core
- which architectural constraints Codex should preserve when making changes

This file should describe structural decisions, not product marketing and not low-level implementation details.

---

## Architectural summary

BookPilot is a **multi-tenant omnichannel booking platform** for service businesses.

The system has multiple customer-facing entry points:

- public booking website
- WhatsApp booking
- phone / voice booking

It also includes an internal:

- web dashboard for business operations

All booking operations must converge into the same central system behavior.

The architecture is built around one core rule:

**all booking-critical decisions must go through the central booking engine, backed by Postgres as the source of truth.**

---

## Core architecture principles

The architecture should preserve the following principles:

1. **Postgres is the source of truth**

   Canonical booking state, availability-related entities, customers, schedules, and booking events must live in the database.

2. **The booking engine is the core**

   Availability lookup, booking creation, rescheduling, cancellation, conflict checking, and booking consistency belong to the central booking logic.

3. **Channels are adapters, not decision-makers**

   Web, WhatsApp, and voice are input/output layers. They collect user intent, present responses, and call internal services, but they must not own critical booking rules.

4. **The product is multi-tenant by default**

   All major entities and flows must respect organization boundaries and configuration.

5. **The core must remain generic**

   Architecture and domain decisions should favor reusable concepts that work across multiple appointment-based service businesses.

6. **External integrations must not own critical business logic**

   Providers may support messaging, voice, AI, notifications, or transport, but they must not become the canonical source of booking truth.

7. **Operational reliability matters more than cleverness**

   A simpler architecture with clear consistency rules is preferred over overly distributed or opaque automation.

---

## High-level system view

BookPilot can be understood as six main layers.

### 1. Customer-facing channels

These are the product entry points used by customers:

- public booking website
- WhatsApp conversations
- phone / voice conversations

Responsibilities:

- receive user input
- authenticate or identify the interaction when relevant
- transform external input into internal requests
- display or communicate system responses
- remain thin and reusable

These layers must not implement booking-critical logic directly.

### 2. Internal dashboard

This is the operational interface used by the business.

Responsibilities:

- manage services, staff, schedules, and availability configuration
- inspect bookings and customers
- create, edit, cancel, or reschedule bookings through internal flows
- expose operational controls over the same core system

The dashboard is an internal UI surface, not a separate booking logic system.

### 3. Application / orchestration layer

This layer coordinates requests before they reach the domain core.

Responsibilities:

- normalize requests coming from different channels
- manage request-level workflows
- handle permissions and role-aware actions
- coordinate calls to booking services, conversation services, notification services, and persistence
- prepare response payloads for channels and dashboard

This layer may contain use-case orchestration, but should not become a dumping ground for domain rules.

### 4. Booking engine / domain core

This is the most important layer in the system.

Responsibilities:

- availability computation
- slot generation
- booking creation
- booking mutation
- rescheduling
- cancellation
- conflict prevention
- consistency enforcement
- validation of booking invariants
- booking event generation when needed

If a rule affects whether a booking is valid, allowed, conflicting, or available, it belongs here or in closely related domain services.

### 5. Persistence layer

This layer manages access to the database and storage of canonical entities.

Responsibilities:

- read and write domain entities
- execute transactional operations
- preserve consistency through schema design and constraints
- support migrations and future model evolution

Persistence should support the domain core, not replace it with scattered query-side logic.

### 6. Integrations and infrastructure services

These are supporting services such as:

- WhatsApp provider integration
- telephony / voice provider integration
- OpenAI-based language or voice capabilities
- notification delivery
- asynchronous jobs
- logging and operational support services

These services support communication and automation but must not become the owner of core booking rules.

---

## Main component model

A reasonable conceptual component split for BookPilot is:

- **Channel adapters**
  - web booking adapter
  - WhatsApp adapter
  - voice adapter

- **Internal web app**
  - dashboard UI
  - admin / staff operational flows

- **Application services**
  - booking request handling
  - dashboard actions
  - conversation orchestration
  - customer interaction workflows

- **Domain services**
  - availability service
  - booking service
  - rescheduling service
  - cancellation service
  - scheduling policy service
  - conflict validation

- **Data access**
  - repositories / query services
  - migrations
  - transaction boundaries

- **Support services**
  - notification jobs
  - AI interpretation / response helpers
  - audit / booking event recording
  - provider clients

This split is conceptual. Actual code structure may vary, but responsibility boundaries should remain clear.

---

## Where business logic lives

### Belongs in the booking engine or domain core

Examples:

- whether a slot is available
- whether a service can be booked at a given time
- whether staff assignment is required or optional
- whether a booking conflicts with another booking
- whether a reschedule is allowed
- whether a cancellation is allowed
- how duration and schedule constraints affect slot generation
- how resources and staff affect booking feasibility

### Belongs in application / orchestration

Examples:

- converting a WhatsApp message into a booking intent request
- collecting missing parameters across multiple conversation turns
- coordinating a booking confirmation flow
- triggering notifications after a successful booking action
- routing dashboard commands to the correct domain service

### Belongs in channel adapters

Examples:

- parsing transport-specific payloads
- formatting responses for WhatsApp, voice, or web
- handling provider-specific metadata
- converting external events into internal commands

### Must not be buried inside channels or providers

Examples:

- custom slot logic in WhatsApp handlers
- booking conflict rules embedded in web forms
- cancellation policy enforced only in the voice channel
- channel-specific booking validation that bypasses the central booking engine

---

## Canonical booking flow

Regardless of entry point, the system should conceptually follow the same flow:

1. A channel or dashboard receives a booking-related request.
2. The request is normalized into an internal use-case input.
3. The application layer coordinates the required workflow.
4. The booking engine evaluates availability and booking rules.
5. The persistence layer commits the canonical state.
6. Related events, notifications, or follow-up actions are triggered.
7. The result is returned to the requesting channel or UI.

This means:

- the web flow must not create bookings using a separate logic path
- WhatsApp must not maintain a parallel booking state
- voice flows must not bypass booking validation
- dashboard manual actions must still use the same booking rules

---

## Availability architecture

Availability is a core capability, not just a UI concern.

Availability computation should be based on canonical scheduling data such as:

- organization settings
- locations
- services
- service duration
- staff availability
- working hours
- time off / exceptions
- existing bookings
- resource constraints when applicable

Availability results shown in any channel should come from shared booking logic, not from channel-specific approximations.

The same conceptual availability engine should support:

- public slot lookup on the web
- conversational slot suggestions in WhatsApp
- conversational slot suggestions in voice
- manual booking support in the dashboard

---

## Multi-tenant boundaries

BookPilot is multi-tenant by design.

The tenant boundary is typically the organization.

Each organization may have its own:

- locations
- services
- staff
- resources
- schedules
- availability rules
- customers
- bookings
- channel configurations

Architecture should ensure:

- data isolation between organizations
- organization-scoped queries and operations
- no accidental cross-tenant reads or writes
- configuration-driven behavior per organization where applicable

Tenant boundaries must be treated as a first-class architectural constraint.

---

## Data ownership and consistency

### Canonical data

Canonical data belongs in Postgres.

Examples:

- organizations
- locations
- services
- staff
- customers
- bookings
- booking events
- schedules
- availability rules
- time-off records
- conversation threads and messages when they are part of product history
- notification jobs when needed for reliable delivery workflows

### Derived or temporary state

Some state may be derived, cached, or temporary, but it must never replace canonical booking truth.

Examples:

- temporary conversation context
- transport-level provider payloads
- cached availability responses
- short-lived AI interpretation artifacts

These may improve performance or UX, but booking-critical state must remain reconstructable from the canonical system.

---

## Integration boundaries

### WhatsApp integration

Should handle:

- message transport
- webhook ingestion
- outbound message delivery
- provider-specific metadata

Should not own:

- booking validity rules
- availability rules
- canonical booking state

### Voice / telephony integration

Should handle:

- call transport
- speech input/output pipeline
- provider events
- session-level communication

Should not own:

- booking confirmation rules
- rescheduling logic
- business schedule truth

### OpenAI or AI services

May help with:

- intent extraction
- entity extraction
- response generation
- conversational assistance
- voice understanding

Must not become the canonical decision-maker for:

- whether a slot is actually available
- whether a booking is valid
- whether a cancellation is allowed

AI may interpret requests, but the booking engine must validate and decide.

---

## Asynchronous behavior

Some operations may happen asynchronously, but asynchronous execution must not weaken consistency.

Typical async candidates:

- sending notifications
- follow-up reminders
- low-priority enrichment
- transcript processing
- analytics events
- retries to external providers

Booking-critical writes should use safe transactional boundaries.

If retries or async workflows are introduced, they should be designed with:

- idempotency
- traceability
- explicit failure handling
- no duplication of canonical bookings

---

## Internal dashboard relationship to the core

The dashboard is not a separate backoffice system with independent rules.

It is an internal surface over the same product core.

This means dashboard actions such as:

- manual booking creation
- moving an appointment
- cancelling an appointment
- changing staff assignment

should still pass through shared booking services and consistency rules.

The dashboard may expose privileged actions, but not a separate booking universe.

---

## Early-phase architectural priorities

For the earliest phases of the product, prioritize:

- a strong central booking engine
- correct availability computation
- clear separation between channels and domain logic
- web booking support
- WhatsApp booking support
- dashboard operations
- architecture readiness for voice / phone support

Avoid early architectural complexity for:

- highly specialized vertical workflows
- custom per-client branching logic
- deep CRM behavior
- marketplace discovery logic
- advanced billing-heavy designs
- distributed logic spread across integrations

---

## Anti-patterns to avoid

Avoid the following architectural mistakes:

1. **Channel-specific booking logic**
   - different booking rules for web, WhatsApp, and voice

2. **Provider-owned business rules**
   - critical logic embedded inside third-party integration handlers

3. **UI-driven domain logic**
   - important rules enforced only in frontend code

4. **A fragmented booking model**
   - separate booking concepts per channel or surface

5. **Over-specialization too early**
   - hardcoding models for one vertical before the generic core is proven

6. **Parallel sources of truth**
   - storing canonical booking decisions outside Postgres

7. **Large unstructured service layers**
   - letting orchestration become an undifferentiated blob of business logic

---

## Expected evolution

The architecture should support future growth such as:

- richer voice automation
- more advanced scheduling policies
- resource-aware booking strategies
- stronger event history and auditability
- more configurable tenant behavior
- additional channels or integrations

Future growth should extend the same core architecture, not replace it with parallel systems.

---

## Relationship with other repository docs

This document should be read together with:

- `docs/product.md` for product intent and scope
- `docs/domain-model.md` for entities, relationships, and domain constraints
- `docs/integrations.md` for provider-specific behavior and limitations

If there is a conflict:

- product intent comes from `product.md`
- structural decisions come from `architecture.md`
- entity and schema decisions come from `domain-model.md`
- provider constraints come from `integrations.md`