"use client";

import { type FormEvent, useEffect, useState } from "react";

import { apiRequest } from "./lib/api-client";
import {
  appendIsoDateTimeSearchParam,
  appendTrimmedSearchParam,
  emptyStringToNull,
  emptyStringToUndefined,
  formatDateTime,
  parseJsonObject,
  toDateTimeLocalInput,
  toErrorMessage,
  toIsoDateTime,
} from "./lib/ui-utils";
import {
  CHANNELS,
  type AvailabilityRule,
  type AvailabilitySlot,
  type Booking,
  type CreateBookingResult,
  type InternalAuthPrincipal,
  type NotificationChannel,
  type NotificationChannelConfiguration,
  type NotificationDeliveryObservabilityJobDetails,
  type NotificationDeliveryObservabilityJobListItem,
  type Organization,
  type Service,
  type SessionState,
  type StaffMember,
  type TimeOff,
} from "./lib/types";

const DEFAULT_API_BASE_URL =
  process.env.NEXT_PUBLIC_INTERNAL_API_BASE_URL ?? "http://localhost:3001";
const SESSION_STORAGE_KEY = "bookpilot_internal_admin_session";

export function AdminConsole() {
  const [session, setSession] = useState<SessionState>({
    apiBaseUrl: DEFAULT_API_BASE_URL,
    token: "",
    organizationId: "",
  });

  const [runningAction, setRunningAction] = useState<string>("idle");
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [principal, setPrincipal] = useState<InternalAuthPrincipal | null>(null);

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [availabilityRules, setAvailabilityRules] = useState<AvailabilityRule[]>([]);
  const [timeOffs, setTimeOffs] = useState<TimeOff[]>([]);
  const [availabilitySlots, setAvailabilitySlots] = useState<AvailabilitySlot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [channelConfigs, setChannelConfigs] = useState<
    NotificationChannelConfiguration[]
  >([]);
  const [notificationJobs, setNotificationJobs] = useState<
    NotificationDeliveryObservabilityJobListItem[]
  >([]);
  const [selectedNotificationJob, setSelectedNotificationJob] =
    useState<NotificationDeliveryObservabilityJobDetails | null>(null);

  const [orgDraft, setOrgDraft] = useState({ name: "", slug: "", timeZone: "UTC" });
  const [serviceDraft, setServiceDraft] = useState({
    name: "",
    description: "",
    durationMinutes: "30",
    active: true,
  });
  const [staffDraft, setStaffDraft] = useState({ fullName: "", active: true });
  const [ruleDraft, setRuleDraft] = useState({
    staffMemberId: "",
    dayOfWeek: "1",
    startTime: "09:00",
    endTime: "17:00",
    isActive: true,
  });
  const [timeOffDraft, setTimeOffDraft] = useState({
    staffMemberId: "",
    startsAt: toDateTimeLocalInput(new Date()),
    endsAt: toDateTimeLocalInput(new Date(Date.now() + 60 * 60 * 1000)),
    reason: "",
  });
  const [availabilitySearchDraft, setAvailabilitySearchDraft] = useState({
    serviceId: "",
    startsAt: toDateTimeLocalInput(new Date()),
    endsAt: toDateTimeLocalInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
    staffMemberId: "",
    slotIntervalMinutes: "15",
  });
  const [bookingDraft, setBookingDraft] = useState({
    serviceId: "",
    startsAt: "",
    staffMemberId: "",
    customerFullName: "",
    customerPhone: "",
    customerEmail: "",
    channelOrigin: "dashboard",
  });
  const [bookingFilters, setBookingFilters] = useState({
    startsAt: "",
    endsAt: "",
    status: "",
    staffMemberId: "",
    serviceId: "",
    customerId: "",
  });
  const [cancelDraft, setCancelDraft] = useState({ bookingId: "" });
  const [rescheduleDraft, setRescheduleDraft] = useState({
    bookingId: "",
    startsAt: toDateTimeLocalInput(new Date(Date.now() + 60 * 60 * 1000)),
    staffMemberId: "",
  });
  const [channelConfigDraft, setChannelConfigDraft] = useState({
    channel: "email" as NotificationChannel,
    enabled: true,
    notificationProviderKey: "",
    providerConfigJson: "{}",
  });
  const [notificationFilters, setNotificationFilters] = useState({
    status: "",
    deliveryChannel: "",
    eventType: "",
    limit: "50",
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const serialized = window.localStorage.getItem(SESSION_STORAGE_KEY);

    if (!serialized) {
      return;
    }

    try {
      const parsed = JSON.parse(serialized) as Partial<SessionState>;
      setSession({
        apiBaseUrl: typeof parsed.apiBaseUrl === "string"
          ? parsed.apiBaseUrl
          : DEFAULT_API_BASE_URL,
        token: typeof parsed.token === "string" ? parsed.token : "",
        organizationId: typeof parsed.organizationId === "string"
          ? parsed.organizationId
          : "",
      });
    } catch {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, []);

  async function runAction(label: string, callback: () => Promise<void>) {
    setRunningAction(label);
    setSuccessMessage("");
    setErrorMessage("");

    try {
      await callback();
      setSuccessMessage(`${label} completed.`);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setRunningAction("idle");
    }
  }

  function requireOrganizationId(): string {
    const organizationId = session.organizationId.trim();

    if (!organizationId) {
      throw new Error("organizationId is required.");
    }

    return organizationId;
  }

  function saveSession() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    }

    setSuccessMessage("Session saved in browser local storage.");
    setErrorMessage("");
  }

  async function connectAndLoadScope() {
    await runAction("Connect", async () => {
      const me = await apiRequest<InternalAuthPrincipal>(session, {
        method: "GET",
        path: "/internal/auth/me",
      });
      setPrincipal(me);

      if (!session.organizationId && me.organizationId) {
        setSession((current) => ({ ...current, organizationId: me.organizationId ?? "" }));
      }

      if (me.role === "platform_admin") {
        await loadOrganizationsInternal();
      } else {
        setOrganizations([]);
      }
    });
  }

  async function loadOrganizationsInternal() {
    const result = await apiRequest<Organization[]>(session, {
      method: "GET",
      path: "/organizations",
    });
    setOrganizations(result);
  }

  async function loadOrganizations() {
    await runAction("Load organizations", loadOrganizationsInternal);
  }

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction("Create organization", async () => {
      const organization = await apiRequest<Organization>(session, {
        method: "POST",
        path: "/organizations",
        body: {
          name: orgDraft.name,
          slug: orgDraft.slug,
          timeZone: orgDraft.timeZone,
        },
      });
      setOrganizations((current) => [organization, ...current]);
      setSession((current) => ({ ...current, organizationId: organization.id }));
      setOrgDraft({ name: "", slug: "", timeZone: organization.timeZone });
    });
  }

  async function loadServicesInternal(organizationId: string) {
    const result = await apiRequest<Service[]>(session, {
      method: "GET",
      path: `/organizations/${organizationId}/services`,
    });
    setServices(result);
  }

  async function loadStaffInternal(organizationId: string) {
    const result = await apiRequest<StaffMember[]>(session, {
      method: "GET",
      path: `/organizations/${organizationId}/staff-members`,
    });
    setStaffMembers(result);
  }

  async function loadAvailabilityRulesInternal(organizationId: string) {
    const result = await apiRequest<AvailabilityRule[]>(session, {
      method: "GET",
      path: `/organizations/${organizationId}/availability-rules`,
    });
    setAvailabilityRules(result);
  }

  async function loadTimeOffInternal(organizationId: string) {
    const result = await apiRequest<TimeOff[]>(session, {
      method: "GET",
      path: `/organizations/${organizationId}/time-off`,
    });
    setTimeOffs(result);
  }

  async function loadChannelConfigsInternal(organizationId: string) {
    const result = await apiRequest<NotificationChannelConfiguration[]>(session, {
      method: "GET",
      path: `/organizations/${organizationId}/notification-channel-configurations`,
    });
    setChannelConfigs(result);
  }

  async function loadOrgData() {
    await runAction("Load organization data", async () => {
      const organizationId = requireOrganizationId();
      await Promise.all([
        loadServicesInternal(organizationId),
        loadStaffInternal(organizationId),
        loadAvailabilityRulesInternal(organizationId),
        loadTimeOffInternal(organizationId),
        loadChannelConfigsInternal(organizationId),
        loadBookingsInternal(organizationId),
        loadNotificationJobsInternal(organizationId),
      ]);
    });
  }

  async function createService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction("Create service", async () => {
      const organizationId = requireOrganizationId();
      const durationMinutes = Number.parseInt(serviceDraft.durationMinutes, 10);

      if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
        throw new Error("durationMinutes must be a positive integer.");
      }

      await apiRequest<Service>(session, {
        method: "POST",
        path: `/organizations/${organizationId}/services`,
        body: {
          name: serviceDraft.name,
          description: emptyStringToUndefined(serviceDraft.description),
          durationMinutes,
          active: serviceDraft.active,
        },
      });

      await loadServicesInternal(organizationId);
      setServiceDraft({ name: "", description: "", durationMinutes: "30", active: true });
    });
  }

  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction("Create staff member", async () => {
      const organizationId = requireOrganizationId();
      await apiRequest<StaffMember>(session, {
        method: "POST",
        path: `/organizations/${organizationId}/staff-members`,
        body: {
          fullName: staffDraft.fullName,
          active: staffDraft.active,
        },
      });
      await loadStaffInternal(organizationId);
      setStaffDraft({ fullName: "", active: true });
    });
  }

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction("Create availability rule", async () => {
      const organizationId = requireOrganizationId();
      await apiRequest<AvailabilityRule>(session, {
        method: "POST",
        path: `/organizations/${organizationId}/availability-rules`,
        body: {
          staffMemberId: emptyStringToUndefined(ruleDraft.staffMemberId),
          dayOfWeek: Number.parseInt(ruleDraft.dayOfWeek, 10),
          startTime: ruleDraft.startTime,
          endTime: ruleDraft.endTime,
          isActive: ruleDraft.isActive,
        },
      });
      await loadAvailabilityRulesInternal(organizationId);
    });
  }

  async function createTimeOff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction("Create time off", async () => {
      const organizationId = requireOrganizationId();
      await apiRequest<TimeOff>(session, {
        method: "POST",
        path: `/organizations/${organizationId}/time-off`,
        body: {
          staffMemberId: emptyStringToUndefined(timeOffDraft.staffMemberId),
          startsAt: toIsoDateTime(timeOffDraft.startsAt, "startsAt"),
          endsAt: toIsoDateTime(timeOffDraft.endsAt, "endsAt"),
          reason: emptyStringToUndefined(timeOffDraft.reason),
        },
      });
      await loadTimeOffInternal(organizationId);
    });
  }

  async function searchAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction("Search availability", async () => {
      const organizationId = requireOrganizationId();
      const slots = await apiRequest<AvailabilitySlot[]>(session, {
        method: "POST",
        path: "/availability/search",
        body: {
          organizationId,
          serviceId: availabilitySearchDraft.serviceId,
          startsAt: toIsoDateTime(availabilitySearchDraft.startsAt, "startsAt"),
          endsAt: toIsoDateTime(availabilitySearchDraft.endsAt, "endsAt"),
          staffMemberId: emptyStringToUndefined(availabilitySearchDraft.staffMemberId),
          slotIntervalMinutes: Number.parseInt(
            availabilitySearchDraft.slotIntervalMinutes,
            10,
          ),
        },
      });
      setAvailabilitySlots(slots);
    });
  }

  async function createBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction("Create booking", async () => {
      const organizationId = requireOrganizationId();
      const customerPhone = emptyStringToUndefined(bookingDraft.customerPhone);
      const customerEmail = emptyStringToUndefined(bookingDraft.customerEmail);

      if (!customerPhone && !customerEmail) {
        throw new Error("At least one of customerPhone/customerEmail is required.");
      }

      const result = await apiRequest<CreateBookingResult>(session, {
        method: "POST",
        path: "/bookings",
        body: {
          organizationId,
          serviceId: bookingDraft.serviceId,
          startsAt: toIsoDateTime(bookingDraft.startsAt, "startsAt"),
          staffMemberId: emptyStringToUndefined(bookingDraft.staffMemberId),
          channelOrigin: bookingDraft.channelOrigin,
          customer: {
            fullName: bookingDraft.customerFullName,
            phone: customerPhone,
            email: customerEmail,
          },
        },
      });

      await Promise.all([
        loadBookingsInternal(organizationId),
        loadNotificationJobsInternal(organizationId),
      ]);
      setCancelDraft({ bookingId: result.booking.id });
      setRescheduleDraft((current) => ({ ...current, bookingId: result.booking.id }));
    });
  }

  async function loadBookingsInternal(organizationId: string) {
    const searchParams = new URLSearchParams();
    appendIsoDateTimeSearchParam(searchParams, "startsAt", bookingFilters.startsAt);
    appendIsoDateTimeSearchParam(searchParams, "endsAt", bookingFilters.endsAt);
    appendTrimmedSearchParam(searchParams, "status", bookingFilters.status);
    appendTrimmedSearchParam(searchParams, "staffMemberId", bookingFilters.staffMemberId);
    appendTrimmedSearchParam(searchParams, "serviceId", bookingFilters.serviceId);
    appendTrimmedSearchParam(searchParams, "customerId", bookingFilters.customerId);
    const query = searchParams.toString();
    const path = query
      ? `/organizations/${organizationId}/bookings?${query}`
      : `/organizations/${organizationId}/bookings`;

    const result = await apiRequest<Booking[]>(session, {
      method: "GET",
      path,
    });
    setBookings(result);
  }

  async function loadBookings() {
    await runAction("Load bookings", async () => {
      const organizationId = requireOrganizationId();
      await loadBookingsInternal(organizationId);
    });
  }

  async function cancelBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction("Cancel booking", async () => {
      const organizationId = requireOrganizationId();
      await apiRequest<Booking>(session, {
        method: "POST",
        path: `/organizations/${organizationId}/bookings/${cancelDraft.bookingId}/cancel`,
      });
      await Promise.all([
        loadBookingsInternal(organizationId),
        loadNotificationJobsInternal(organizationId),
      ]);
    });
  }

  async function rescheduleBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction("Reschedule booking", async () => {
      const organizationId = requireOrganizationId();
      await apiRequest<Booking>(session, {
        method: "POST",
        path:
          `/organizations/${organizationId}/bookings/${rescheduleDraft.bookingId}/` +
          "reschedule",
        body: {
          startsAt: toIsoDateTime(rescheduleDraft.startsAt, "startsAt"),
          staffMemberId: emptyStringToUndefined(rescheduleDraft.staffMemberId),
        },
      });
      await Promise.all([
        loadBookingsInternal(organizationId),
        loadNotificationJobsInternal(organizationId),
      ]);
    });
  }

  async function saveChannelConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction("Save channel configuration", async () => {
      const organizationId = requireOrganizationId();
      await apiRequest<NotificationChannelConfiguration>(session, {
        method: "PUT",
        path:
          `/organizations/${organizationId}/notification-channel-configurations/` +
          channelConfigDraft.channel,
        body: {
          enabled: channelConfigDraft.enabled,
          notificationProviderKey: emptyStringToNull(
            channelConfigDraft.notificationProviderKey,
          ),
          providerConfig: parseJsonObject(
            channelConfigDraft.providerConfigJson,
            "providerConfig",
          ),
        },
      });
      await loadChannelConfigsInternal(organizationId);
    });
  }

  async function loadNotificationJobsInternal(organizationId: string) {
    const searchParams = new URLSearchParams();
    appendTrimmedSearchParam(searchParams, "status", notificationFilters.status);
    appendTrimmedSearchParam(
      searchParams,
      "deliveryChannel",
      notificationFilters.deliveryChannel,
    );
    appendTrimmedSearchParam(searchParams, "eventType", notificationFilters.eventType);
    appendTrimmedSearchParam(searchParams, "limit", notificationFilters.limit);
    const query = searchParams.toString();
    const path = query
      ? `/organizations/${organizationId}/notification-jobs?${query}`
      : `/organizations/${organizationId}/notification-jobs`;

    const result = await apiRequest<NotificationDeliveryObservabilityJobListItem[]>(
      session,
      {
        method: "GET",
        path,
      },
    );
    setNotificationJobs(result);
  }

  async function loadNotificationJobs() {
    await runAction("Load notification jobs", async () => {
      const organizationId = requireOrganizationId();
      await loadNotificationJobsInternal(organizationId);
    });
  }

  async function loadNotificationJobDetails(notificationJobId: string) {
    await runAction(`Load notification job ${notificationJobId}`, async () => {
      const organizationId = requireOrganizationId();
      const details = await apiRequest<NotificationDeliveryObservabilityJobDetails>(
        session,
        {
          method: "GET",
          path: `/organizations/${organizationId}/notification-jobs/${notificationJobId}`,
        },
      );
      setSelectedNotificationJob(details);
    });
  }

  return (
    <main className="page">
      <h1>BookPilot Internal Admin</h1>
      <p className="subtle">Minimal internal UI over existing internal APIs.</p>

      <section className="panel">
        <h2>Session</h2>
        <div className="grid">
          <input
            placeholder="API base URL"
            value={session.apiBaseUrl}
            onChange={(event) =>
              setSession((current) => ({ ...current, apiBaseUrl: event.target.value }))}
          />
          <input
            placeholder="Organization id"
            value={session.organizationId}
            onChange={(event) =>
              setSession((current) => ({
                ...current,
                organizationId: event.target.value,
              }))}
          />
          <input
            type="password"
            placeholder="Internal API token"
            value={session.token}
            onChange={(event) =>
              setSession((current) => ({ ...current, token: event.target.value }))}
          />
        </div>
        <div className="actions">
          <button type="button" onClick={saveSession}>Save Session</button>
          <button type="button" onClick={() => void connectAndLoadScope()}>Connect</button>
          <button type="button" onClick={() => void loadOrgData()}>
            Load Organization Data
          </button>
        </div>
        <p className="subtle">Principal: {principal ? principal.role : "not connected"}</p>
        <p className="subtle">Action: {runningAction}</p>
        {successMessage ? <p className="ok">{successMessage}</p> : null}
        {errorMessage ? <p className="err">{errorMessage}</p> : null}
      </section>

      <section className="panel">
        <h2>Organizations</h2>
        <div className="actions">
          <button type="button" onClick={() => void loadOrganizations()}>
            Load Organizations
          </button>
        </div>
        <form onSubmit={createOrganization} className="grid">
          <input
            placeholder="name"
            value={orgDraft.name}
            onChange={(event) =>
              setOrgDraft((current) => ({ ...current, name: event.target.value }))}
          />
          <input
            placeholder="slug"
            value={orgDraft.slug}
            onChange={(event) =>
              setOrgDraft((current) => ({ ...current, slug: event.target.value }))}
          />
          <input
            placeholder="time zone"
            value={orgDraft.timeZone}
            onChange={(event) =>
              setOrgDraft((current) => ({ ...current, timeZone: event.target.value }))}
          />
          <button type="submit">Create Organization</button>
        </form>
        <pre>{JSON.stringify(organizations, null, 2)}</pre>
      </section>

      <section className="panel">
        <h2>Configuration</h2>
        <form onSubmit={createService} className="grid">
          <strong>Create service</strong>
          <input placeholder="name" value={serviceDraft.name} onChange={(event) => setServiceDraft((current) => ({ ...current, name: event.target.value }))} />
          <input placeholder="description" value={serviceDraft.description} onChange={(event) => setServiceDraft((current) => ({ ...current, description: event.target.value }))} />
          <input placeholder="durationMinutes" value={serviceDraft.durationMinutes} onChange={(event) => setServiceDraft((current) => ({ ...current, durationMinutes: event.target.value }))} />
          <label><input type="checkbox" checked={serviceDraft.active} onChange={(event) => setServiceDraft((current) => ({ ...current, active: event.target.checked }))} /> active</label>
          <button type="submit">Create Service</button>
        </form>

        <form onSubmit={createStaff} className="grid">
          <strong>Create staff member</strong>
          <input placeholder="fullName" value={staffDraft.fullName} onChange={(event) => setStaffDraft((current) => ({ ...current, fullName: event.target.value }))} />
          <label><input type="checkbox" checked={staffDraft.active} onChange={(event) => setStaffDraft((current) => ({ ...current, active: event.target.checked }))} /> active</label>
          <button type="submit">Create Staff</button>
        </form>

        <form onSubmit={createRule} className="grid">
          <strong>Create availability rule</strong>
          <input placeholder="staffMemberId optional" value={ruleDraft.staffMemberId} onChange={(event) => setRuleDraft((current) => ({ ...current, staffMemberId: event.target.value }))} />
          <input placeholder="dayOfWeek 0-6" value={ruleDraft.dayOfWeek} onChange={(event) => setRuleDraft((current) => ({ ...current, dayOfWeek: event.target.value }))} />
          <input placeholder="startTime HH:MM" value={ruleDraft.startTime} onChange={(event) => setRuleDraft((current) => ({ ...current, startTime: event.target.value }))} />
          <input placeholder="endTime HH:MM" value={ruleDraft.endTime} onChange={(event) => setRuleDraft((current) => ({ ...current, endTime: event.target.value }))} />
          <label><input type="checkbox" checked={ruleDraft.isActive} onChange={(event) => setRuleDraft((current) => ({ ...current, isActive: event.target.checked }))} /> active</label>
          <button type="submit">Create Rule</button>
        </form>

        <form onSubmit={createTimeOff} className="grid">
          <strong>Create time off</strong>
          <input placeholder="staffMemberId optional" value={timeOffDraft.staffMemberId} onChange={(event) => setTimeOffDraft((current) => ({ ...current, staffMemberId: event.target.value }))} />
          <input type="datetime-local" value={timeOffDraft.startsAt} onChange={(event) => setTimeOffDraft((current) => ({ ...current, startsAt: event.target.value }))} />
          <input type="datetime-local" value={timeOffDraft.endsAt} onChange={(event) => setTimeOffDraft((current) => ({ ...current, endsAt: event.target.value }))} />
          <input placeholder="reason" value={timeOffDraft.reason} onChange={(event) => setTimeOffDraft((current) => ({ ...current, reason: event.target.value }))} />
          <button type="submit">Create Time Off</button>
        </form>

        <h3>Services</h3>
        <pre>{JSON.stringify(services, null, 2)}</pre>
        <h3>Staff Members</h3>
        <pre>{JSON.stringify(staffMembers, null, 2)}</pre>
        <h3>Availability Rules</h3>
        <pre>{JSON.stringify(availabilityRules, null, 2)}</pre>
        <h3>Time Off</h3>
        <pre>{JSON.stringify(timeOffs, null, 2)}</pre>
      </section>

      <section className="panel">
        <h2>Bookings</h2>
        <form onSubmit={searchAvailability} className="grid">
          <strong>Availability search</strong>
          <input placeholder="serviceId" value={availabilitySearchDraft.serviceId} onChange={(event) => setAvailabilitySearchDraft((current) => ({ ...current, serviceId: event.target.value }))} />
          <input type="datetime-local" value={availabilitySearchDraft.startsAt} onChange={(event) => setAvailabilitySearchDraft((current) => ({ ...current, startsAt: event.target.value }))} />
          <input type="datetime-local" value={availabilitySearchDraft.endsAt} onChange={(event) => setAvailabilitySearchDraft((current) => ({ ...current, endsAt: event.target.value }))} />
          <input placeholder="staffMemberId optional" value={availabilitySearchDraft.staffMemberId} onChange={(event) => setAvailabilitySearchDraft((current) => ({ ...current, staffMemberId: event.target.value }))} />
          <input placeholder="slotIntervalMinutes" value={availabilitySearchDraft.slotIntervalMinutes} onChange={(event) => setAvailabilitySearchDraft((current) => ({ ...current, slotIntervalMinutes: event.target.value }))} />
          <button type="submit">Search</button>
        </form>
        <pre>{JSON.stringify(availabilitySlots, null, 2)}</pre>

        <form onSubmit={createBooking} className="grid">
          <strong>Create booking</strong>
          <input placeholder="serviceId" value={bookingDraft.serviceId} onChange={(event) => setBookingDraft((current) => ({ ...current, serviceId: event.target.value }))} />
          <input type="datetime-local" value={bookingDraft.startsAt} onChange={(event) => setBookingDraft((current) => ({ ...current, startsAt: event.target.value }))} />
          <input placeholder="staffMemberId optional" value={bookingDraft.staffMemberId} onChange={(event) => setBookingDraft((current) => ({ ...current, staffMemberId: event.target.value }))} />
          <input placeholder="customerFullName" value={bookingDraft.customerFullName} onChange={(event) => setBookingDraft((current) => ({ ...current, customerFullName: event.target.value }))} />
          <input placeholder="customerPhone optional" value={bookingDraft.customerPhone} onChange={(event) => setBookingDraft((current) => ({ ...current, customerPhone: event.target.value }))} />
          <input placeholder="customerEmail optional" value={bookingDraft.customerEmail} onChange={(event) => setBookingDraft((current) => ({ ...current, customerEmail: event.target.value }))} />
          <button type="submit">Create Booking</button>
        </form>

        <form onSubmit={(event) => { event.preventDefault(); void loadBookings(); }} className="grid">
          <strong>List bookings</strong>
          <input type="datetime-local" value={bookingFilters.startsAt} onChange={(event) => setBookingFilters((current) => ({ ...current, startsAt: event.target.value }))} />
          <input type="datetime-local" value={bookingFilters.endsAt} onChange={(event) => setBookingFilters((current) => ({ ...current, endsAt: event.target.value }))} />
          <input placeholder="status" value={bookingFilters.status} onChange={(event) => setBookingFilters((current) => ({ ...current, status: event.target.value }))} />
          <input placeholder="staffMemberId" value={bookingFilters.staffMemberId} onChange={(event) => setBookingFilters((current) => ({ ...current, staffMemberId: event.target.value }))} />
          <input placeholder="serviceId" value={bookingFilters.serviceId} onChange={(event) => setBookingFilters((current) => ({ ...current, serviceId: event.target.value }))} />
          <input placeholder="customerId" value={bookingFilters.customerId} onChange={(event) => setBookingFilters((current) => ({ ...current, customerId: event.target.value }))} />
          <button type="submit">Load Bookings</button>
        </form>

        <table className="compact-table">
          <thead><tr><th>Booking</th><th>Starts</th><th>Status</th></tr></thead>
          <tbody>
            {bookings.map((booking) => (
              <tr key={booking.id}>
                <td>{booking.id}</td>
                <td>{formatDateTime(booking.startsAt)}</td>
                <td>{booking.status}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <form onSubmit={cancelBooking} className="grid">
          <strong>Cancel booking</strong>
          <input placeholder="bookingId" value={cancelDraft.bookingId} onChange={(event) => setCancelDraft({ bookingId: event.target.value })} />
          <button type="submit">Cancel Booking</button>
        </form>

        <form onSubmit={rescheduleBooking} className="grid">
          <strong>Reschedule booking</strong>
          <input placeholder="bookingId" value={rescheduleDraft.bookingId} onChange={(event) => setRescheduleDraft((current) => ({ ...current, bookingId: event.target.value }))} />
          <input type="datetime-local" value={rescheduleDraft.startsAt} onChange={(event) => setRescheduleDraft((current) => ({ ...current, startsAt: event.target.value }))} />
          <input placeholder="staffMemberId optional" value={rescheduleDraft.staffMemberId} onChange={(event) => setRescheduleDraft((current) => ({ ...current, staffMemberId: event.target.value }))} />
          <button type="submit">Reschedule Booking</button>
        </form>
      </section>

      <section className="panel">
        <h2>Notification Configuration & Observability</h2>
        <form onSubmit={saveChannelConfiguration} className="grid">
          <strong>Save channel config</strong>
          <select value={channelConfigDraft.channel} onChange={(event) => setChannelConfigDraft((current) => ({ ...current, channel: event.target.value as NotificationChannel }))}>
            {CHANNELS.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
          </select>
          <label><input type="checkbox" checked={channelConfigDraft.enabled} onChange={(event) => setChannelConfigDraft((current) => ({ ...current, enabled: event.target.checked }))} /> enabled</label>
          <input placeholder="notificationProviderKey" value={channelConfigDraft.notificationProviderKey} onChange={(event) => setChannelConfigDraft((current) => ({ ...current, notificationProviderKey: event.target.value }))} />
          <textarea rows={4} value={channelConfigDraft.providerConfigJson} onChange={(event) => setChannelConfigDraft((current) => ({ ...current, providerConfigJson: event.target.value }))} />
          <button type="submit">Save Channel Config</button>
        </form>
        <pre>{JSON.stringify(channelConfigs, null, 2)}</pre>

        <form onSubmit={(event) => { event.preventDefault(); void loadNotificationJobs(); }} className="grid">
          <strong>List notification jobs</strong>
          <input placeholder="status" value={notificationFilters.status} onChange={(event) => setNotificationFilters((current) => ({ ...current, status: event.target.value }))} />
          <input placeholder="deliveryChannel" value={notificationFilters.deliveryChannel} onChange={(event) => setNotificationFilters((current) => ({ ...current, deliveryChannel: event.target.value }))} />
          <input placeholder="eventType" value={notificationFilters.eventType} onChange={(event) => setNotificationFilters((current) => ({ ...current, eventType: event.target.value }))} />
          <input placeholder="limit" value={notificationFilters.limit} onChange={(event) => setNotificationFilters((current) => ({ ...current, limit: event.target.value }))} />
          <button type="submit">Load Jobs</button>
        </form>

        <table className="compact-table">
          <thead><tr><th>Job</th><th>Channel</th><th>Status</th><th>Latest</th><th /></tr></thead>
          <tbody>
            {notificationJobs.map((item) => (
              <tr key={item.job.id}>
                <td>{item.job.id}</td>
                <td>{item.job.deliveryChannel}</td>
                <td>{item.job.status}</td>
                <td>{item.latestDeliveryStatus.normalizedStatus ?? "-"}</td>
                <td>
                  <button type="button" onClick={() => void loadNotificationJobDetails(item.job.id)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <pre>{JSON.stringify(selectedNotificationJob, null, 2)}</pre>
      </section>
    </main>
  );
}
