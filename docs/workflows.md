# Workflows

## Purpose

This document defines the main product workflows in **BookPilot**.

Its purpose is to clarify:

- how the core booking flows should behave
- which steps are common across channels
- which decisions must always pass through the central booking engine
- which workflow stages belong to channels, orchestration, and domain logic
- how Codex should reason about user-facing booking interactions

This document describes **canonical business workflows**, not UI mockups and not provider-specific webhook details.

---

## Workflow principles

All workflows in BookPilot should preserve these rules:

1. **All booking-critical actions must go through the same core logic**
   - web, WhatsApp, voice, and dashboard must not implement different booking rules

2. **The booking engine decides**
   - availability, conflicts, cancellations, reschedules, and final booking validity must be validated centrally

3. **Channels collect intent**
   - channels may gather information gradually
   - they must not act as independent booking systems

4. **Postgres is the source of truth**
   - conversation context may support a workflow
   - canonical booking state must be stored in the core platform

5. **Workflows should remain generic**
   - flows should support many appointment-based businesses without assuming one vertical too early

---

## Workflow categories

The most important early workflows are:

- check availability
- create booking
- confirm booking
- cancel booking
- reschedule booking
- manual booking from dashboard
- customer identification and conversation linking
- outbound confirmations and reminders

These are the product-critical workflows that Codex should understand before implementing features.

---

## Canonical cross-channel pattern

Most booking-related workflows should conceptually follow this shared pattern:

1. the user or staff initiates an action
2. the channel or dashboard captures the request
3. the request is normalized into an internal use case
4. missing information is collected if needed
5. the booking engine validates the request
6. canonical state is created or updated
7. follow-up communication is triggered
8. the result is returned through the appropriate channel

This pattern should stay consistent even if the UX differs between channels.

---

## Workflow: check availability

### Goal

Allow a customer or staff user to discover bookable time options for a given service context.

### Typical inputs

Examples:

- service
- preferred date
- preferred time window
- location
- preferred staff member
- channel context
- tenant / organization context

### Canonical flow

1. the request arrives from web, WhatsApp, voice, or dashboard
2. the platform identifies the organization context
3. the request is normalized into an internal availability query
4. if required information is missing, the system asks for clarification
5. the booking engine evaluates:
   - service constraints
   - location constraints
   - staff constraints
   - recurring availability rules
   - time-off or exceptions
   - existing bookings
   - resource constraints when applicable
6. the platform returns valid slot options
7. the channel formats the result appropriately

### Important rule

Displayed availability must come from shared booking logic, not from channel-specific shortcuts.

### Examples of invalid implementation

- precomputing web slots with one logic path and WhatsApp slots with another
- suggesting slots in AI conversation without validating them against the booking engine

---

## Workflow: create booking

### Goal

Create a valid booking in the canonical system.

### Typical inputs

Examples:

- organization
- customer identity or customer details
- service
- time slot
- location when applicable
- staff assignment when applicable
- resource requirements when applicable
- channel of origin

### Canonical flow

1. the user expresses booking intent
2. the platform collects all required booking parameters
3. the application layer normalizes the request
4. the booking engine validates:
   - service validity
   - slot validity
   - location compatibility
   - staff eligibility and availability when relevant
   - resource availability when relevant
   - conflict constraints
5. if valid, the booking is created in canonical storage
6. a booking event may be recorded
7. confirmation-related follow-up actions may be triggered
8. the channel communicates the result back to the user

### Success outcome

A booking exists in the canonical platform state and can be inspected consistently from all surfaces.

### Failure outcome

The system must return a clear reason or a safe fallback prompt, without creating inconsistent partial booking state.

### Important rule

No channel may create a booking that bypasses the central booking engine.

---

## Workflow: booking confirmation

### Goal

Confirm to the customer or operator that a booking was successfully created or updated.

### Canonical flow

1. the booking operation succeeds internally
2. the canonical booking state is committed
3. any notification or response is generated from that canonical result
4. the customer receives confirmation via the initiating channel or another configured channel

### Notes

Confirmation is a communication step, not the source of booking truth.

A provider failure while sending a confirmation must not mean the booking does not exist.

---

## Workflow: cancel booking

### Goal

Cancel an existing booking safely and consistently.

### Typical inputs

Examples:

- booking identifier or resolvable booking context
- customer or operator identity
- cancellation intent
- channel of origin

### Canonical flow

1. the user or operator requests cancellation
2. the system identifies the target booking
3. the application layer verifies the actor has the right context to cancel
4. the booking engine validates whether cancellation is allowed
5. the booking state is updated canonically
6. a booking event may be recorded
7. related notifications may be queued
8. the result is communicated back

### Important rule

Cancellation policy must be enforced centrally.

It must not depend on whether the booking was cancelled from web, WhatsApp, voice, or dashboard.

---

## Workflow: reschedule booking

### Goal

Move an existing booking to a new valid slot.

### Canonical flow

1. the user or operator identifies the booking to change
2. the system captures the desired new time or asks for new preferences
3. the booking engine evaluates the new candidate slot using the same feasibility logic as a new booking
4. if valid, the booking is updated canonically
5. a booking event may be recorded
6. follow-up notifications may be triggered
7. the result is returned

### Important rule

Rescheduling is not a UI-only update.

It is a booking mutation that must go through the same availability and conflict logic as booking creation.

---

## Workflow: manual booking from dashboard

### Goal

Allow internal staff or business operators to manage bookings manually.

### Canonical flow

1. a dashboard user starts a booking action
2. the dashboard collects the required parameters
3. the request is sent into the same application and domain flow used by customer-facing channels
4. the booking engine validates feasibility
5. canonical booking state is written
6. the dashboard reflects the result

### Important rule

The dashboard may expose privileged actions, but it must not become a separate booking system with different consistency rules.

---

## Workflow: customer identification

### Goal

Associate an interaction with the correct customer record when possible.

### Canonical flow

1. the interaction arrives from a channel
2. the system extracts available identity signals
   - phone number
   - email
   - existing conversation link
   - operator lookup
3. the system attempts to match or create customer context according to platform rules
4. the workflow proceeds using the internal customer entity

### Important rule

Channel identity helps map users to customers, but channel identifiers must not become the only definition of the customer.

---

## Workflow: conversational booking

### Goal

Support multi-turn booking interactions through channels such as WhatsApp and voice.

### Canonical flow

1. the customer expresses a booking-related request in natural language
2. the platform interprets the intent
3. missing parameters are collected over one or more turns
4. once enough structured data exists, the internal booking or availability workflow is executed
5. the result is returned conversationally

### Important rule

Conversation state is support context, not canonical scheduling state.

AI may help interpret the request, but the final booking or availability decision must still be validated internally.

---

## Workflow: reminder and notification flow

### Goal

Communicate important booking lifecycle events after the canonical state is already known.

### Examples

- booking confirmation
- upcoming reminder
- cancellation notice
- reschedule confirmation

### Canonical flow

1. a booking lifecycle event occurs internally
2. the platform determines whether an outbound communication should be sent
3. the notification job or outbound action is created
4. delivery is attempted via the appropriate channel
5. delivery outcome may be tracked operationally
6. provider delivery feedback callbacks may be ingested and reconciled into operational delivery status timelines

### Important rule

Notifications follow canonical state. They do not define it.

---

## Workflow: failure handling

### Goal

Ensure workflow failures do not corrupt canonical state.

### Common failure types

Examples:

- provider timeout
- malformed message payload
- AI extraction failure
- booking conflict discovered late
- missing required customer information
- duplicate webhook event

### Expected behavior

- fail safely
- do not create duplicate bookings
- do not leave canonical state ambiguous
- ask for clarification when the issue is missing information
- retry only where it is operationally appropriate
- preserve traceability for debugging

---

## Workflow: internal API token lifecycle

### Goal

Allow internal operators to safely manage internal API access without direct SQL.

### Canonical flow

1. an authenticated internal actor requests token issue, rotate, revoke, or list
2. the platform validates actor role and tenant scope
3. token lifecycle action is executed in canonical Postgres state
4. raw token material is returned only on issue/rotate and never persisted plaintext
5. audit fields such as active state, expiration, and last-used timestamp remain queryable for operations

### Important rule

Token lifecycle management is an internal access-control workflow and must not alter booking-domain business logic.

---

## Workflow responsibilities by layer

### Channels

Responsible for:

- collecting input
- presenting output
- transporting messages, transcripts, or UI actions

Not responsible for:

- final booking validity
- conflict resolution
- canonical availability rules

### Application layer

Responsible for:

- workflow orchestration
- collecting missing data
- linking conversations, customers, and actions
- calling domain services
- coordinating follow-up actions

### Booking engine / domain core

Responsible for:

- availability calculation
- booking feasibility
- conflict detection
- cancellation validity
- rescheduling validity
- canonical state changes

### Integrations

Responsible for:

- transport
- provider communication
- delivery
- event ingestion

Not responsible for:

- owning booking truth
- replacing domain validation

---

## Early-phase workflow priorities

In the earliest phases, prioritize robust support for:

- availability lookup
- booking creation
- booking cancellation
- booking rescheduling
- dashboard manual operations
- WhatsApp conversational booking
- reliable confirmations

Avoid overcomplicating early workflows with:

- excessive branching per tenant
- highly specialized industry flows
- deep CRM side-effects
- billing-heavy post-booking flows
- custom one-off logic for individual clients

---

## Anti-patterns to avoid

Avoid these workflow mistakes:

1. different booking rules per channel
2. AI-generated slot suggestions not validated by the booking engine
3. dashboard actions bypassing booking validation
4. treating message history as the only source of booking truth
5. creating bookings before required validation is complete
6. silent retries that duplicate booking side effects
7. cancellation or reschedule rules enforced only in frontend or provider code

---

## Relationship with other repository docs

This document should be read together with:

- `docs/product.md` for product scope and intended user value
- `docs/architecture.md` for layer responsibilities and structural boundaries
- `docs/domain-model.md` for canonical entities and invariants
- `docs/integrations.md` for provider-specific boundaries and transport behavior

If there is a conflict:

- product intent comes from `product.md`
- structural boundaries come from `architecture.md`
- canonical entities come from `domain-model.md`
- provider limits come from `integrations.md`
- workflow behavior comes from `workflows.md`
