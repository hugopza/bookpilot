export type BookingStatus = "confirmed" | "cancelled";

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
