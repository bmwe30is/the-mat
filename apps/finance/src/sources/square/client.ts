// Thin, read-only Square v2 client using native fetch (no SDK — we only need a
// handful of endpoints). The two POSTs used here (batch-retrieve) are reads.
import { squareConfig } from "../../config.js";
import { HttpClient } from "../../lib/http.js";
import { logger } from "../../lib/logger.js";
import { HttpError } from "../../lib/http.js";
import type { SquareCustomer, SquareInvoice, SquareLocation, SquareOrder, SquarePayment, SquareRefund } from "./types.js";

interface Page<T> {
  cursor?: string;
  errors?: unknown[];
  [key: string]: T[] | string | unknown[] | undefined;
}

export class SquareClient {
  readonly http: HttpClient;
  /** Unset = all locations (probe only). */
  readonly locationId: string | undefined;

  constructor() {
    const cfg = squareConfig();
    this.locationId = cfg.locationId;
    this.http = new HttpClient({
      name: "square",
      baseUrl: cfg.env === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com",
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        // Pin the API version so response shapes can't change under us.
        "Square-Version": cfg.version,
      },
      requestsPerSec: 5,
      logger,
    });
  }

  async locations(): Promise<SquareLocation[]> {
    const res = await this.http.getJson<{ locations?: SquareLocation[] }>("/v2/locations");
    return res.locations ?? [];
  }

  /** Follow `cursor` until exhausted. `key` is the array field in each page. */
  private async listAll<T>(path: string, key: string, query: Record<string, string | number | undefined>): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.http.getJson<Page<T>>(path, { ...query, ...(cursor ? { cursor } : {}) });
      out.push(...((page[key] as T[] | undefined) ?? []));
      cursor = page.cursor;
    } while (cursor);
    return out;
  }

  /**
   * Payments created in [begin, end). Always pass begin_time: ListPayments
   * silently defaults to "one year ago" without it (PRD §8).
   */
  listPayments = (begin: Date, end: Date) =>
    this.listAll<SquarePayment>("/v2/payments", "payments", {
      begin_time: begin.toISOString(),
      end_time: end.toISOString(),
      location_id: this.locationId,
      sort_order: "ASC",
      limit: 100,
    });

  listRefunds = (begin: Date, end: Date) =>
    this.listAll<SquareRefund>("/v2/refunds", "refunds", {
      begin_time: begin.toISOString(),
      end_time: end.toISOString(),
      location_id: this.locationId,
      sort_order: "ASC",
      limit: 100,
    });

  /** Orders by id, 100 per request (the endpoint's limit). */
  async batchRetrieveOrders(orderIds: string[]): Promise<SquareOrder[]> {
    const out: SquareOrder[] = [];
    for (let i = 0; i < orderIds.length; i += 100) {
      const res = await this.http.postJson<{ orders?: SquareOrder[] }>("/v2/orders/batch-retrieve", {
        location_id: this.locationId,
        order_ids: orderIds.slice(i, i + 100),
      });
      out.push(...(res.orders ?? []));
    }
    return out;
  }

  async retrieveCustomer(id: string): Promise<SquareCustomer | undefined> {
    try {
      const res = await this.http.getJson<{ customer?: SquareCustomer }>(`/v2/customers/${id}`);
      return res.customer;
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return undefined; // deleted customer
      throw err;
    }
  }

  /**
   * Customers by id, 100 per request (BulkRetrieveCustomers). Each result says
   * which id was *requested*: Square merges duplicate customer profiles, and
   * asking for a merged-away id returns the surviving profile under its own,
   * different id. Ids Square no longer has are absent. If the endpoint isn't
   * available on the pinned Square-Version, fall back to one request per id.
   */
  async bulkRetrieveCustomers(ids: string[]): Promise<Array<{ requestedId: string; customer: SquareCustomer }>> {
    const out: Array<{ requestedId: string; customer: SquareCustomer }> = [];
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      try {
        const res = await this.http.postJson<{ responses?: Record<string, { customer?: SquareCustomer }> }>(
          "/v2/customers/bulk-retrieve",
          { customer_ids: batch },
        );
        for (const [requestedId, r] of Object.entries(res.responses ?? {})) {
          if (r.customer) out.push({ requestedId, customer: r.customer });
        }
      } catch (err) {
        if (!(err instanceof HttpError && err.status === 404)) throw err;
        for (const id of batch) {
          const c = await this.retrieveCustomer(id);
          if (c) out.push({ requestedId: id, customer: c });
        }
      }
    }
    return out;
  }

  /**
   * Every invoice at the location. SearchInvoices has no date filter, so this
   * is a full pull — fine at this volume (a handful per year).
   */
  async searchInvoices(): Promise<SquareInvoice[]> {
    if (!this.locationId) throw new Error("SQUARE_LOCATION_ID is required to search invoices");
    const out: SquareInvoice[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.http.postJson<{ invoices?: SquareInvoice[]; cursor?: string }>("/v2/invoices/search", {
        query: { filter: { location_ids: [this.locationId] }, sort: { field: "INVOICE_SORT_DATE", order: "ASC" } },
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      out.push(...(res.invoices ?? []));
      cursor = res.cursor;
    } while (cursor);
    return out;
  }
}
