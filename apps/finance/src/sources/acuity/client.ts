// Thin, read-only Acuity Scheduling v1 client. Only GET endpoints.
// Auth is HTTP Basic with the numeric user id and API key.
import { acuityConfig } from "../../config.js";
import { HttpClient } from "../../lib/http.js";
import { logger } from "../../lib/logger.js";
import type {
  AcuityAppointment,
  AcuityCalendar,
  AcuityCertificate,
  AcuityMe,
  AcuityOrder,
  AcuityPayment,
} from "./types.js";

export class AcuityClient {
  readonly http: HttpClient;

  constructor() {
    const cfg = acuityConfig();
    this.http = new HttpClient({
      name: "acuity",
      baseUrl: "https://acuityscheduling.com/api/v1",
      headers: { Authorization: "Basic " + Buffer.from(`${cfg.userId}:${cfg.apiKey}`).toString("base64") },
      requestsPerSec: cfg.requestsPerSec,
      logger,
    });
  }

  me = () => this.http.getJson<AcuityMe>("/me");
  calendars = () => this.http.getJson<AcuityCalendar[]>("/calendars");
  appointmentTypes = () => this.http.getJson<Record<string, unknown>[]>("/appointment-types");
  products = () => this.http.getJson<Record<string, unknown>[]>("/products");
  certificates = () => this.http.getJson<AcuityCertificate[]>("/certificates");

  /**
   * Appointments whose date falls in [minDate, maxDate] (dates, account timezone).
   * `showall` includes canceled appointments; `excludeForms` keeps intake-form
   * answers (PII, and large) out of the payload.
   */
  appointments = (q: { minDate: string; maxDate: string; max: number }) =>
    this.http.getJson<AcuityAppointment[]>("/appointments", { ...q, showall: true, excludeForms: true });

  appointmentPayments = (appointmentId: number) =>
    this.http.getJson<AcuityPayment[]>(`/appointments/${appointmentId}/payments`);

  /** /orders has no date filter — only `max`. */
  orders = (q: { max: number }) => this.http.getJson<AcuityOrder[]>("/orders", q);
}
