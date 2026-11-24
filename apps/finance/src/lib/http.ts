// A small fetch wrapper shared by the Acuity and Square clients (PRD §12 Reliability).
//
//   - Rate limit: at most `requestsPerSec` requests, spaced evenly.
//   - Retries: 429 and 5xx (and network errors) are retried up to 5 attempts
//     with exponential backoff + jitter, honoring a `Retry-After` header.
//   - Any other 4xx fails immediately: retrying a bad request won't fix it.
//   - Logs method, path, status and timing — never auth headers or bodies.
import type { Logger } from "pino";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly bodySnippet: string,
  ) {
    super(`${method} ${path} → HTTP ${status}: ${bodySnippet}`);
  }
}

export interface HttpClientOptions {
  name: string;
  baseUrl: string;
  headers: Record<string, string>;
  requestsPerSec: number;
  logger: Logger;
  maxAttempts?: number;
  /** Injected for tests; defaults to setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

export type Query = Record<string, string | number | boolean | undefined>;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Delay before retry `attempt` (1-based). Exported for tests. */
export function backoffMs(attempt: number, retryAfter: string | null, random = Math.random): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const at = Date.parse(retryAfter); // Retry-After may also be an HTTP date
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  const base = Math.min(30_000, 500 * 2 ** (attempt - 1));
  return base + Math.floor(random() * base * 0.25); // jitter: spread out simultaneous retries
}

export class HttpClient {
  /** Number of HTTP requests sent (including retries) — recorded on sync_run. */
  calls = 0;
  private nextSlot = 0;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: HttpClientOptions) {
    this.sleep = opts.sleep ?? defaultSleep;
  }

  getJson<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, query);
  }

  postJson<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, undefined, body);
  }

  private async throttle() {
    const interval = 1000 / this.opts.requestsPerSec;
    const now = Date.now();
    const wait = this.nextSlot - now;
    this.nextSlot = Math.max(now, this.nextSlot) + interval;
    if (wait > 0) await this.sleep(wait);
  }

  private async request<T>(method: string, path: string, query?: Query, body?: unknown): Promise<T> {
    const url = new URL(this.opts.baseUrl.replace(/\/$/, "") + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const maxAttempts = this.opts.maxAttempts ?? 5;
    const log = this.opts.logger;

    for (let attempt = 1; ; attempt++) {
      await this.throttle();
      this.calls++;
      const started = Date.now();
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: {
            Accept: "application/json",
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...this.opts.headers,
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        // Network failure (DNS, reset, timeout): retryable.
        if (attempt >= maxAttempts) throw err;
        const delay = backoffMs(attempt, null);
        log.warn({ api: this.opts.name, method, path, attempt, delay, err: (err as Error).message }, "network error, retrying");
        await this.sleep(delay);
        continue;
      }

      const ms = Date.now() - started;
      if (res.ok) {
        log.debug({ api: this.opts.name, method, path, status: res.status, ms }, "http");
        return (await res.json()) as T;
      }

      const text = (await res.text()).slice(0, 500);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= maxAttempts) throw new HttpError(res.status, method, path, text);

      const delay = backoffMs(attempt, res.headers.get("retry-after"));
      log.warn({ api: this.opts.name, method, path, status: res.status, attempt, delay }, "retrying");
      await this.sleep(delay);
    }
  }
}
