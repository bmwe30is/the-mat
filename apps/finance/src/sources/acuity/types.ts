// Loose shapes of the Acuity v1 API objects we read. Only fields we rely on are
// named; everything else is still kept in the raw payload. Strict zod shapes for
// transforms arrive in Phase 5, once the probe has confirmed what's really there.

export interface AcuityMe {
  id: number;
  timezone?: string;
  [k: string]: unknown;
}

export interface AcuityCalendar {
  id: number;
  name: string;
  timezone?: string;
  [k: string]: unknown;
}

export interface AcuityAppointment {
  id: number;
  datetime: string; // local time with offset, e.g. "2020-03-02T09:00:00-0800"
  datetimeCreated?: string;
  timezone?: string;
  calendarTimezone?: string;
  price?: string; // decimal string, e.g. "25.00"
  priceSold?: string;
  paid?: string; // "yes" | "no"
  amountPaid?: string;
  type?: string;
  appointmentTypeID?: number;
  calendarID?: number;
  certificate?: string | null;
  canceled?: boolean;
  email?: string;
  [k: string]: unknown;
}

export interface AcuityPayment {
  transactionID?: string;
  created?: string;
  processor?: string;
  amount?: string;
  [k: string]: unknown;
}

export interface AcuityOrder {
  id: number;
  time?: string;
  total?: string;
  status?: string;
  title?: string;
  [k: string]: unknown;
}

export interface AcuityCertificate {
  id: number;
  certificate: string;
  type?: string;
  [k: string]: unknown;
}
