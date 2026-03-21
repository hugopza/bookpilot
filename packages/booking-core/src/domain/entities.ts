export type BookingStatus = "confirmed" | "cancelled";

export type BookingEventType =
  | "booking_created"
  | "booking_cancelled"
  | "booking_rescheduled";

export type NotificationJobStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed";

export type NotificationJobAttemptStatus =
  | "processing"
  | "succeeded"
  | "failed";

export type NotificationDeliveryStatus =
  | "accepted"
  | "delivered"
  | "deferred"
  | "bounced"
  | "complained"
  | "opened"
  | "clicked"
  | "failed"
  | "unknown";

export type NotificationChannel =
  | "whatsapp"
  | "sms"
  | "email"
  | "push"
  | "voice";

export type BookingChannelOrigin =
  | "api"
  | "web"
  | "whatsapp"
  | "voice"
  | "dashboard";

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

export interface Customer {
  id: string;
  organizationId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
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
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
}

export interface Booking {
  id: string;
  organizationId: string;
  serviceId: string;
  customerId: string;
  staffMemberId: string;
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
  channelOrigin: BookingChannelOrigin;
  createdAt: Date;
}

export interface BookingEvent {
  id: string;
  organizationId: string;
  bookingId: string;
  eventType: BookingEventType;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}

export interface NotificationJob {
  id: string;
  organizationId: string;
  bookingId: string;
  customerId: string;
  deliveryChannel: NotificationChannel;
  eventType: BookingEventType;
  status: NotificationJobStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  processingToken: string | null;
  processingStartedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationNotificationChannelConfiguration {
  id: string;
  organizationId: string;
  channel: NotificationChannel;
  enabled: boolean;
  notificationProviderKey: string | null;
  providerConfig: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationJobAttempt {
  id: string;
  notificationJobId: string;
  attemptNumber: number;
  processingToken: string;
  status: NotificationJobAttemptStatus;
  providerKey: string | null;
  providerMessageId: string | null;
  deliveryStatus: NotificationDeliveryStatus | null;
  deliveryStatusUpdatedAt: Date | null;
  deliveryStatusMetadata: Record<string, unknown>;
  outcomeCode: string | null;
  outcomeMessage: string | null;
  outcomePayload: Record<string, unknown>;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface NotificationDeliveryFeedbackEvent {
  id: string;
  providerKey: string;
  providerEventId: string;
  providerMessageId: string;
  providerStatus: string;
  normalizedStatus: NotificationDeliveryStatus;
  occurredAt: Date;
  receivedAt: Date;
  organizationId: string | null;
  notificationJobId: string | null;
  notificationJobAttemptId: string | null;
  payload: Record<string, unknown>;
}

export interface NotificationDeliveryFeedbackReconciliationResult {
  feedbackEvent: NotificationDeliveryFeedbackEvent;
  duplicate: boolean;
  matched: boolean;
  updatedAttempt: boolean;
}

export interface ClaimedNotificationJob {
  job: NotificationJob;
  attempt: NotificationJobAttempt;
}

export interface AvailabilitySlot {
  organizationId: string;
  serviceId: string;
  staffMemberId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface DateRange {
  startsAt: Date;
  endsAt: Date;
}

export interface CustomerContactInput {
  fullName: string;
  phone?: string | null;
  email?: string | null;
}
