# Domain model

## Purpose

This document defines the conceptual domain model for **BookPilot**.

Its purpose is to make clear:

- which entities belong to the core product
- how those entities relate to each other
- which concepts are canonical
- which invariants the system must preserve
- which abstractions should remain generic across industries

This is a **domain-level document**, not a final database schema.

It should guide:

- database design
- migrations
- backend logic
- API design
- validation rules
- future architectural decisions

If implementation details change, the core domain rules described here should remain stable unless there is a deliberate product or architecture decision.

---

## Domain model principles

The domain model should preserve the following principles:

1. **Multi-tenant by default**
   - the organization is the primary tenant boundary

2. **Generic booking core**
   - the model should support multiple appointment-based service businesses without being hardcoded for one vertical

3. **Canonical scheduling state**
   - bookings, availability-related entities, and scheduling constraints must be represented in the core system

4. **Shared model across all channels**
   - web, WhatsApp, voice, and dashboard flows must use the same underlying entities

5. **Configurability over hardcoding**
   - tenant-specific behavior should come from configuration and rules, not separate parallel models

6. **Clear distinction between core entities and support entities**
   - scheduling truth belongs to the booking core
   - transport, messaging, AI, and notification artifacts support the product but do not redefine core booking state

---

## Core entity overview

The core BookPilot domain should revolve around these entities:

- organization
- location
- service
- staff member
- resource
- customer
- booking
- booking event
- availability rule
- time-off / exception
- conversation thread
- message
- notification job

Not all entities must be fully implemented in the first milestone, but the model should evolve consistently with this general structure.

---

## Primary tenant entity

### Organization

An **organization** represents one business account using BookPilot.

Examples:
- one salon
- one physiotherapy clinic
- one training studio
- one consulting business

An organization is the main ownership boundary for operational data.

Typical responsibilities:

- owns business configuration
- owns locations
- owns services
- owns staff
- owns resources
- owns customers
- owns bookings
- owns scheduling rules
- owns channel settings

### Invariants

- every scheduling-related entity belongs to one organization
- cross-organization booking logic is not valid
- data access must always be organization-scoped unless there is an explicit platform-level reason

---

## Operational structure entities

### Location

A **location** represents a physical or logical place where services happen.

Examples:
- a specific salon branch
- a clinic office
- a consultation office
- an online or virtual appointment context when supported

Locations help define where a booking takes place and what staff/services are available there.

### Typical relationships

- one organization can have many locations
- one location can support many services
- one location can have many staff members
- one location can have many bookings

### Notes

A location should remain generic. It should not assume physical-only usage if future virtual appointments are supported.

---

### Service

A **service** represents something a customer can book.

Examples:
- haircut
- beard trim
- physiotherapy session
- personal training session
- consultation

A service is one of the core booking dimensions.

### Typical attributes

- name
- description
- default duration
- active/inactive state
- organization ownership
- optional location constraints
- optional staff eligibility
- optional resource requirements
- booking-related configuration

### Typical relationships

- one organization can have many services
- one service may be available at one or more locations
- one service may be bookable by one or more staff members
- one service may be referenced by many bookings

### Invariants

- a booking must reference a valid service
- service duration must be compatible with slot generation logic
- service-level rules must not conflict with organization ownership

---

### Staff member

A **staff member** represents a person who can perform services or be assigned to bookings.

Examples:
- barber
- stylist
- physiotherapist
- coach
- consultant

This entity is about booking participation, not necessarily full HR modeling.

### Typical relationships

- one organization can have many staff members
- one staff member may operate at one or more locations
- one staff member may perform one or more services
- one staff member may have working hours and time-off rules
- one staff member may be assigned to many bookings

### Invariants

- staff assignment must respect organization ownership
- if a booking requires staff assignment, assigned staff must be eligible for the selected service and context
- staff availability must respect working hours, exceptions, and existing bookings

---

### Resource

A **resource** represents a non-human schedulable asset that may constrain bookings.

Examples:
- treatment room
- chair
- equipment
- shared cabin
- specialized machine

Resources are optional in the earliest product phase, but the model should support them.

### Typical relationships

- one organization can have many resources
- one resource may be linked to one or more locations
- one resource may be required by one or more services
- one resource may be allocated to many bookings over time

### Invariants

- a resource cannot be double-booked when the domain rules require exclusive use
- resource ownership must remain organization-scoped

---

## Scheduling entities

### Availability rule

An **availability rule** represents recurring or base scheduling availability.

Examples:
- opening hours for a location
- working hours for a staff member
- service availability window
- channel-specific booking windows if supported
- business rules for when booking is allowed

This concept should remain flexible. Different implementations may split it into more than one table or structure, but the domain idea is important.

### Typical scope

Availability rules may apply to:

- organization
- location
- staff member
- service
- resource

### Invariants

- recurring availability rules alone do not guarantee a slot is bookable
- final availability must also consider time off, existing bookings, and constraints
- availability rules should be composable rather than duplicated per channel

---

### Time off / exception

A **time off** or **exception** represents a non-recurring override to normal availability.

Examples:
- staff vacation
- sick leave
- a holiday closure
- a temporary schedule change
- blocked time for internal reasons

### Typical relationships

- belongs to an organization
- may apply to a location, a staff member, a resource, or other schedulable scope

### Invariants

- exceptions override recurring availability where relevant
- exception handling must be considered in slot generation and booking validation

---

### Booking

A **booking** is the central transactional entity of the product.

A booking represents a scheduled appointment between a customer and the business under defined conditions.

### Typical attributes

- organization reference
- location reference
- service reference
- customer reference
- scheduled start time
- scheduled end time or duration snapshot
- status
- optional staff assignment
- optional resource allocation
- channel of origin
- notes or metadata when needed

### Typical statuses

The exact status set may evolve, but the concept should support states such as:

- pending
- confirmed
- cancelled
- completed
- no-show
- rescheduled

A simpler early implementation may start with fewer states.

### Invariants

- every booking belongs to one organization
- every booking references a valid service
- every booking references a valid customer, unless a temporary early-phase design explicitly allows otherwise
- a booking must have a valid scheduled time range
- a booking must not violate conflict constraints
- a booking must respect staff, location, and resource constraints when those are applicable
- booking state changes must remain internally consistent

### Important note

A booking is the canonical scheduling commitment. Channels may discuss it, notifications may reference it, and booking events may describe its lifecycle, but the booking remains the central state entity.

---

### Booking event

A **booking event** represents an important lifecycle event related to a booking.

Examples:
- booking created
- booking confirmed
- booking cancelled
- booking rescheduled
- staff assignment changed
- customer details updated in a relevant way

This entity improves traceability, auditability, debugging, and future analytics.

### Typical relationships

- one booking can have many booking events
- each booking event belongs to exactly one booking
- booking events belong indirectly to one organization through the booking

### Invariants

- booking events must reflect actual state transitions or relevant booking lifecycle moments
- booking events must not replace the booking as canonical current state
- the current booking state must still be derivable from the booking record itself

---

## Customer and communication entities

### Customer

A **customer** represents the person receiving the service or requesting the booking.

A customer should exist independently of a specific channel whenever possible.

### Typical attributes

- organization reference
- name
- phone
- email
- preferred contact details
- notes when appropriate
- channel-related identifiers when needed

### Typical relationships

- one organization can have many customers
- one customer can have many bookings
- one customer can have many conversation threads

### Invariants

- customer identity should be organization-scoped
- the same real-world person may appear in different organizations without implying shared records
- channel-specific identifiers must not become the only conceptual definition of a customer

---

### Conversation thread

A **conversation thread** represents an ongoing interaction context between a customer and the business through a channel.

Examples:
- a WhatsApp conversation
- a phone call session or linked call conversation history
- future messaging threads on other supported channels

This entity helps support conversational booking flows, follow-ups, and context continuity.

### Typical relationships

- belongs to one organization
- usually linked to one customer when identity is known
- belongs to one channel type
- can contain many messages
- may reference one or more bookings when relevant

### Invariants

- conversation state is support context, not canonical booking truth
- a conversation may lead to a booking, modify a booking, or discuss a booking, but it must not replace the booking record

---

### Message

A **message** represents one unit of communication inside a conversation thread.

Examples:
- inbound WhatsApp message
- outbound WhatsApp response
- user voice transcript segment
- system-generated conversational reply

### Typical relationships

- belongs to one conversation thread
- may reference booking-related actions or extracted intents
- may contain transport metadata

### Invariants

- messages are communication records, not scheduling truth
- transport/provider payloads may be stored for debugging or operational reasons, but core business decisions should still map into the booking domain

---

## Operational support entities

### Notification job

A **notification job** represents a queued or tracked outbound notification action when reliable delivery workflows are needed.

Examples:
- booking confirmation message
- reminder
- cancellation notice
- reschedule confirmation

This entity is useful when asynchronous delivery and retry behavior matter.

### Typical relationships

- belongs to one organization
- may reference a booking
- may reference a customer
- may reference a conversation thread or channel context
- may have one or more delivery attempts when reliable processing is required

### Typical attributes

- event or notification type
- processing status
- retry counters or attempt limits
- next-attempt scheduling state
- last known processing error when relevant
- payload needed by downstream delivery adapters

### Invariants

- notification tracking must not become the source of booking truth
- failed or delayed notification delivery must not corrupt canonical booking state
- retry and idempotency state should remain inside the platform rather than inside transport providers
- provider feedback events may update operational delivery status timelines, but must not redefine canonical booking state

---

### Organization channel/provider configuration

An **organization channel/provider configuration** represents tenant-level control over which notification-capable channels are enabled and which provider key is used per channel.

Examples:
- WhatsApp notifications enabled for one organization and disabled for another
- one organization using provider A for email while another uses provider B

### Typical relationships

- belongs to one organization
- scoped to one notification-capable channel (for example: whatsapp, sms, email, push, voice)

### Invariants

- channel/provider configuration is organization-scoped
- provider selection must not move booking-state decisions out of the platform
- disabled channels should fail notification delivery operationally without corrupting booking truth

---

### Internal API access token

An **internal API access token** represents an internal operator credential used to access organization-scoped operational APIs safely.

### Typical attributes

- token hash (not raw secret)
- role (for example: platform admin or organization operator)
- optional organization scope
- active/disabled state
- optional expiration
- last-used timestamp

### Invariants

- internal access credentials must be validated before operational API access
- organization-scoped roles must not access other organizations
- platform-wide roles should be explicit and limited
- auth state must remain operational support state and must not redefine canonical booking truth

---

### Internal API token audit event

An **internal API token audit event** is an immutable operational record of token lifecycle actions such as issue, rotate, and revoke.

### Typical attributes

- event type
- actor token id, role, and optional organization scope
- target token id, role, and optional organization scope
- occurred-at timestamp
- non-sensitive metadata relevant for operations

### Invariants

- audit events are append-only in platform behavior
- audit events must not contain raw token material
- lifecycle actions should record audit events atomically with token-state changes when practical
- audit state supports traceability and operations and does not redefine booking-domain truth

---

## Key relationships summary

A simplified conceptual relationship map is:

- organization has many locations
- organization has many services
- organization has many staff members
- organization has many resources
- organization has many customers
- organization has many bookings
- organization has many availability rules
- organization has many time-off records
- organization has many conversation threads
- organization has many notification jobs

- location has many bookings
- service has many bookings
- customer has many bookings
- booking has many booking events

- conversation thread has many messages
- customer may have many conversation threads
- booking may be referenced by conversation threads, messages, and notification jobs

Some relationships may be many-to-many in implementation.

Examples:
- services ↔ staff members
- services ↔ locations
- services ↔ resources
- staff members ↔ locations

Those implementation choices should remain flexible as long as the domain meaning stays clear.

---

## Booking feasibility model

A booking is feasible only when all relevant constraints are satisfied.

Depending on product phase and tenant configuration, these constraints may include:

- the service exists and is active
- the selected time falls within allowed availability
- the location is valid
- the assigned staff member is eligible and available
- required resources are available
- the booking does not conflict with existing bookings
- the booking respects business policies such as lead time or scheduling limits when supported

This means availability is not a single field stored on one entity. It is the result of evaluating multiple domain entities together.

---

## Canonical ownership model

The following should be treated as canonical domain state:

- organizations
- locations
- services
- staff members
- resources
- customers
- bookings
- booking events
- availability rules
- time-off records

The following are support entities rather than core scheduling truth:

- conversation threads
- messages
- notification jobs
- AI interpretation artifacts
- provider-specific transport metadata
- caches or temporary workflow state

Support entities are still important, but they must not silently redefine core scheduling state.

---

## Minimal early-phase model

For the earliest product version, a smaller subset may be enough.

A reasonable minimal model is:

- organization
- service
- staff member
- customer
- booking
- availability rule
- time-off / exception
- conversation thread
- message

A slightly richer early model may also include:

- location
- booking event
- notification job

Resources may remain optional until the booking core is proven.

This allows the product to stay simple while preserving a clear evolution path.

---

## Domain boundaries and non-goals

The core domain model should avoid absorbing unrelated concerns too early.

Not primary early-phase domain goals:

- deep CRM pipelines
- invoicing-heavy finance models
- marketplace discovery entities
- advanced restaurant table allocation
- highly specialized medical workflow modeling
- bespoke per-customer domain forks

These may be added later if justified, but they should not distort the early generic booking core.

---

## Naming guidance

The model should prefer clear, generic names such as:

- organization
- location
- service
- staff
- resource
- customer
- booking
- booking_event
- availability_rule
- time_off
- conversation_thread
- message
- notification_job

Equivalent implementation names are acceptable if they remain consistent.

Avoid names that hardcode one specific industry unless explicitly justified.

Bad early examples:

- barber_chair_booking
- salon_client_flow
- clinic_super_slot

Prefer generic concepts that can survive product expansion.

---

## Evolution guidance

The domain model should evolve by extending the generic core, not by replacing it with vertical-specific parallel models.

Good evolution examples:

- adding service categories
- adding resource requirements
- adding stronger booking event history
- adding configurable cancellation policies
- adding richer availability policies
- adding channel capability configuration per organization

Risky evolution examples:

- introducing a separate booking model per channel
- duplicating customer records per integration
- embedding scheduling truth in transport-specific tables
- creating one-off schemas for each client

---

## Relationship with other repository docs

This document should be read together with:

- `docs/product.md` for product scope and intent
- `docs/architecture.md` for responsibility boundaries and system structure
- `docs/integrations.md` for external provider behavior and constraints

If there is a conflict:

- product intent comes from `product.md`
- architecture boundaries come from `architecture.md`
- domain and schema direction come from `domain-model.md`
- provider behavior comes from `integrations.md`
