# Integrations

## Purpose

This document defines how **external integrations** should be treated in **BookPilot**.

Its purpose is to clarify:

- which external systems may exist around the product
- what each integration is responsible for
- what each integration must never own
- how integrations should interact with the core booking platform
- how Codex should reason about provider-specific code and constraints

This document is about **integration boundaries**, not the internal domain model and not detailed provider SDK usage.

---

## Integration principles

All integrations in BookPilot should follow these principles:

1. **The platform owns the business logic**
   - external systems may transport messages, audio, or events
   - they must not own canonical booking rules

2. **Postgres remains the source of truth**
   - provider payloads may be stored
   - provider state must not replace canonical booking state

3. **The booking engine makes booking decisions**
   - integrations may collect intent or transport data
   - booking validity, availability, rescheduling, and cancellations must be decided internally

4. **Integrations are adapters**
   - they translate between external systems and internal use cases
   - they should remain thin where possible

5. **Provider-specific behavior must be isolated**
   - do not leak provider quirks across the whole codebase
   - wrap provider details behind clear interfaces or service boundaries

6. **Operational reliability matters**
   - integration failures should be visible and traceable
   - retry behavior, idempotency, and fallback behavior should be deliberate

7. **The core should stay provider-agnostic**
   - changing one messaging or telephony provider should not require redesigning the booking model

---

## Main integration categories

BookPilot is expected to work with several categories of integrations:

- messaging integrations
- telephony / voice integrations
- AI integrations
- notification delivery integrations
- authentication or identity-related integrations when relevant
- analytics or observability integrations when needed
- future channel integrations

Not every category needs full implementation in the first phase, but the architecture should stay compatible with them.

---

## Messaging integrations

### Purpose

Messaging integrations support conversational booking through channels such as WhatsApp.

Typical responsibilities:

- receive inbound messages
- send outbound messages
- expose webhook events
- carry provider metadata
- support text and possibly voice-note transport
- map external thread identifiers to internal conversation records

### What messaging integrations may do

Examples:

- deliver a customer message to the platform
- deliver a bot or system response to the customer
- report message status when available
- provide sender identifiers and timestamps
- carry media references or attachments

### What messaging integrations must not do

Examples:

- decide whether a booking is valid
- compute canonical availability
- store the only authoritative state of a booking
- apply booking rules only inside a webhook handler
- become the main source of customer identity truth

### Internal expectation

A messaging integration should convert external provider events into internal application requests.

Example flow:

1. provider sends inbound webhook
2. BookPilot validates and parses the payload
3. BookPilot links the event to an organization and conversation context
4. the application layer extracts or collects intent
5. the booking engine evaluates any booking-related action
6. BookPilot stores canonical state internally
7. a response is formatted and sent back through the provider

---

## WhatsApp integration

WhatsApp is one of the main early product channels.

### Typical responsibilities

- receive inbound customer messages
- send outbound replies
- support text-first conversational flows
- optionally support voice-note transport if included in product scope
- connect customer communication with internal conversation threads

### Good usage examples

- asking for availability
- confirming booking details
- sending a booking confirmation
- sending a cancellation confirmation
- sending reminders or follow-ups

### Bad usage examples

- embedding booking conflict logic in the WhatsApp handler
- maintaining a parallel booking state only in conversation memory
- deciding slot validity from message history without validating against the booking engine

### Design guidance

The WhatsApp adapter should remain channel-specific in format but generic in architecture.

That means:

- provider payload parsing belongs here
- message formatting belongs here
- webhook verification belongs here
- transport status handling belongs here

But:

- availability logic does not belong here
- booking lifecycle rules do not belong here
- staff or resource feasibility logic does not belong here

---

## Telephony / voice integrations

### Purpose

Telephony and voice integrations support phone-based booking flows.

They may include:

- inbound calls
- outbound call flows when needed
- speech-to-text
- text-to-speech
- call session events
- call recording or transcript references when legally and operationally appropriate

### Typical responsibilities

- receive or initiate call sessions
- transport audio or transcripts
- represent call events
- provide session identifiers
- connect voice interactions to internal conversation or session state

### What telephony integrations may do

Examples:

- deliver transcript segments
- stream voice input/output
- signal call start and end
- expose provider metadata
- support real-time or near-real-time conversational interaction

### What telephony integrations must not do

Examples:

- act as the canonical scheduler
- approve a booking without internal validation
- own rescheduling policy
- decide booking conflicts
- become the authoritative source of customer or booking state

### Design guidance

Voice adds complexity, but it should still follow the same platform model:

- transport and speech tooling are external capabilities
- booking logic remains internal
- conversation guidance may be AI-assisted
- final booking decisions must still be validated by the booking engine

---

## AI integrations

### Purpose

AI integrations support natural language and voice understanding.

In BookPilot, AI may be used for:

- intent detection
- entity extraction
- clarification prompts
- response drafting
- transcript understanding
- conversational assistance
- voice interaction support

### Acceptable AI responsibilities

Examples:

- infer that the user wants to book, cancel, or reschedule
- extract likely service, date, time, or staff preference
- suggest a natural-language response
- summarize conversation context
- help drive a guided conversational flow

### Non-acceptable AI responsibilities

Examples:

- deciding that a slot is definitely available without checking the booking engine
- deciding that a booking should be confirmed without internal validation
- silently mutating booking state outside platform rules
- becoming the only source of structured business decisions

### Critical rule

AI may interpret requests.

AI must not replace:

- domain validation
- availability computation
- booking conflict checks
- canonical state transitions

### Design guidance

All AI outputs should be treated as **assistance**, not truth.

Useful patterns:

- AI proposes structured intent
- BookPilot validates the proposal
- BookPilot executes internal use cases
- BookPilot returns a final response grounded in canonical system state

---

## Notification integrations

### Purpose

Notification integrations are used to communicate events back to customers or staff.

Examples:

- booking confirmations
- reminders
- cancellation notices
- reschedule confirmations
- follow-up notifications

Notification delivery may happen through:

- WhatsApp
- SMS
- email
- push
- future channels

### Responsibilities

- deliver outbound notifications
- report delivery outcomes when supported
- support retry handling where useful

### Limits

Notification systems must not become the canonical record of whether the booking exists or what its final state is.

A failed reminder delivery is a notification problem, not a booking-state problem.

---

## Authentication and identity-related integrations

### Purpose

Some integrations may support authentication, authorization, or contact identity workflows.

These may help:

- identify dashboard users
- identify business accounts
- map external identifiers to internal customer records
- support secure webhook verification

### Guidance

Identity from external channels should be treated carefully.

Examples:

- a phone number may help identify a customer
- a WhatsApp account may map to a customer
- a voice call session may be linked to a prior customer record

But:

- external identity signals should not automatically overwrite canonical customer data without validation
- organization boundaries must still be respected

---

## Analytics and observability integrations

### Purpose

These integrations help monitor system behavior, reliability, and usage.

Examples:

- logs
- metrics
- tracing
- analytics events
- alerting

### Responsibilities

- improve visibility into failures and performance
- support debugging of provider issues
- help track operational quality

### Limits

Analytics systems must not become required to reconstruct core booking truth.

The platform should remain operationally understandable even without relying on external analytics as the only record.

---

## Provider abstraction guidance

When using third-party providers, the code should separate:

- provider SDK details
- provider payload parsing
- internal normalized events
- domain use cases

A useful pattern is:

1. provider client or adapter
2. normalization layer
3. application service
4. booking engine or domain service
5. persistence
6. outbound formatter

This keeps provider-specific code isolated and reduces long-term coupling.

---

## Normalized internal model for integrations

External payloads vary by provider.

BookPilot should prefer translating them into internal normalized concepts such as:

- inbound message
- outbound message request
- voice session started
- voice transcript received
- booking intent detected
- delivery status update
- external contact identifier

Internal normalized structures should remain stable even if a provider changes.

This protects the product from provider lock-in.

---

## Idempotency and retries

Integrations often produce duplicated or delayed events.

The platform should account for this.

Examples:

- the same webhook delivered multiple times
- delayed delivery status events
- repeated transcript callbacks
- provider retries after timeout

Therefore:

- inbound processing should be idempotent where needed
- outbound operations should be traceable
- retry logic should be explicit
- duplicate provider events must not create duplicate bookings

---

## Error handling expectations

Integration failures are expected and should be handled explicitly.

Examples:

- webhook signature failure
- provider timeout
- temporary outbound delivery failure
- malformed payload
- transcript generation failure
- AI extraction failure

Expected behavior:

- fail safely
- preserve canonical internal state
- log useful operational context
- retry only where appropriate
- avoid silent corruption of conversation or booking state

A transport failure should not force a booking inconsistency.

---

## Security and trust boundaries

External integrations are trust boundaries.

The platform should validate:

- webhook authenticity when supported
- payload shape
- organization routing logic
- permission boundaries for dashboard-facing actions
- safe handling of externally supplied identifiers

Do not assume external payloads are safe, complete, or canonical.

---

## Multi-tenant integration behavior

Integrations must respect organization boundaries.

Examples:

- one business may have its own WhatsApp configuration
- one business may have its own phone number or telephony setup
- one business may enable or disable certain channels
- one business may use different notification preferences

Therefore:

- integration configuration should be organization-aware
- routing from inbound provider events to the correct organization is critical
- no cross-tenant leakage should occur in provider handling or outbound communication

---

## Booking-safe integration rule

The most important rule in this file is:

**no integration may directly own booking-critical logic.**

That includes:

- availability decisions
- booking creation validity
- rescheduling rules
- cancellation rules
- conflict checks
- resource assignment validity
- staff eligibility decisions

Integrations may initiate or support these flows, but the platform core must decide them.

---

## Early-phase integration priorities

For the earliest product phase, prioritize:

- a robust WhatsApp integration path
- clean AI-assisted intent extraction
- reliable outbound confirmations
- clear internal conversation mapping
- architecture readiness for telephony / voice
- no duplication of booking rules across channels

Do not overbuild early integrations with:

- excessive provider-specific branching
- provider-locked abstractions
- bespoke flows per client
- automation complexity that bypasses core system validation

---

## Anti-patterns to avoid

Avoid these integration mistakes:

1. **Business logic inside webhook handlers**
2. **Provider payloads leaking into domain services**
3. **AI outputs treated as guaranteed truth**
4. **Duplicate booking state across provider systems**
5. **One-off custom integrations that bypass the shared platform model**
6. **Channel-specific validation rules**
7. **Missing idempotency for inbound events**
8. **Hidden retry loops that create duplicate side effects**

---

## Suggested integration categories in code

The exact code structure may vary, but conceptually it is reasonable to separate:

- provider clients
- webhook handlers
- payload normalizers
- conversation services
- AI interpretation services
- outbound formatting services
- notification dispatchers
- provider-specific config
- shared integration utilities

The key requirement is not the folder name.

The key requirement is preserving clean boundaries.

---

## Relationship with other repository docs

This document should be read together with:

- `docs/product.md` for product scope and channel intent
- `docs/architecture.md` for structural boundaries
- `docs/domain-model.md` for canonical entities and ownership

If there is a conflict:

- product intent comes from `product.md`
- structural responsibilities come from `architecture.md`
- canonical entities come from `domain-model.md`
- provider-specific boundaries and constraints come from `integrations.md`