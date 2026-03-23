export type InternalApiRole = "platform_admin" | "organization_operator";
export type NotificationChannel = "whatsapp" | "sms" | "email" | "push" | "voice";
export type BookingStatus = "confirmed" | "cancelled";
export type NotificationJobStatus = "pending" | "processing" | "succeeded" | "failed";
export type BookingEventType =
  | "booking_created"
  | "booking_cancelled"
  | "booking_rescheduled";

export interface SessionState {
  apiBaseUrl: string;
  token: string;
  organizationId: string;
}

export interface InternalAuthPrincipal {
  tokenId: string;
  role: InternalApiRole;
  organizationId: string | null;
  description: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  timeZone: string;
}

export interface Service {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  active: boolean;
}

export interface StaffMember {
  id: string;
  organizationId: string;
  fullName: string;
  active: boolean;
}

export interface AvailabilityRule {
  id: string;
  organizationId: string;
  staffMemberId: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

export interface TimeOff {
  id: string;
  organizationId: string;
  staffMemberId: string | null;
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

export interface Booking {
  id: string;
  organizationId: string;
  serviceId: string;
  customerId: string;
  staffMemberId: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  channelOrigin: string;
  createdAt: string;
}

export interface AvailabilitySlot {
  organizationId: string;
  serviceId: string;
  staffMemberId: string;
  startsAt: string;
  endsAt: string;
}

export interface CreateBookingResult {
  booking: Booking;
  customer: {
    id: string;
    organizationId: string;
    fullName: string;
    phone: string | null;
    email: string | null;
  };
}

export interface NotificationChannelConfiguration {
  id: string;
  organizationId: string;
  channel: NotificationChannel;
  enabled: boolean;
  notificationProviderKey: string | null;
  providerConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDeliveryObservabilityJobSummary {
  id: string;
  bookingId: string;
  customerId: string;
  deliveryChannel: NotificationChannel;
  eventType: BookingEventType;
  status: NotificationJobStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string;
  processingStartedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDeliveryLatestStatusSummary {
  notificationJobAttemptId: string | null;
  providerMessageId: string | null;
  normalizedStatus: string | null;
  providerStatus: string | null;
  occurredAt: string | null;
}

export interface NotificationDeliveryObservabilityJobListItem {
  job: NotificationDeliveryObservabilityJobSummary;
  latestDeliveryStatus: NotificationDeliveryLatestStatusSummary;
}

export interface NotificationDeliveryObservabilityAttemptSummary {
  id: string;
  attemptNumber: number;
  status: "processing" | "succeeded" | "failed";
  providerKey: string | null;
  providerMessageId: string | null;
  deliveryStatus: string | null;
  deliveryStatusUpdatedAt: string | null;
  deliveryStatusMetadata: Record<string, unknown>;
  outcomeCode: string | null;
  outcomeMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface NotificationDeliveryObservabilityFeedbackTimelineEntry {
  id: string;
  providerKey: string;
  providerEventId: string;
  providerMessageId: string;
  providerStatus: string;
  normalizedStatus: string;
  occurredAt: string;
  receivedAt: string;
  notificationJobAttemptId: string | null;
}

export interface NotificationDeliveryObservabilityJobDetails {
  organizationId: string;
  notificationJobId: string;
  job: NotificationDeliveryObservabilityJobSummary;
  latestDeliveryStatus: NotificationDeliveryLatestStatusSummary;
  attempts: NotificationDeliveryObservabilityAttemptSummary[];
  feedbackTimeline: NotificationDeliveryObservabilityFeedbackTimelineEntry[];
}

export const CHANNELS: NotificationChannel[] = [
  "whatsapp",
  "sms",
  "email",
  "push",
  "voice",
];

