import { z } from 'zod';
import type { Offer } from './offer.js';
import { parseOffer } from './schema.js';

export const DEFAULT_BASE_URL =
  'https://servicios3.abc.gob.ar/valoracion.docente/api/apd.oferta.encabezado/select';
export const DEFAULT_USER_AGENT = 'alertas-docentes/0.1 (APD offer alerts bot)';

export interface OfferFilters {
  /** District names (`descdistrito`), any case; several are OR-ed. */
  districts?: readonly string[];
  /** Level/modality names (`descnivelmodalidad`), any case; several are OR-ed. */
  levels?: readonly string[];
}

export interface SolrClientOptions {
  baseUrl?: string;
  userAgent?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  pageSize?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Retries after the first attempt (so total attempts = maxRetries + 1). */
  maxRetries?: number;
  /** First backoff delay; doubles on every retry. */
  retryBaseDelayMs?: number;
  /** Hard cap on pages, a guard against runaway pagination. */
  maxPages?: number;
}

export interface CollectResult {
  offers: Offer[];
  /** `numFound` reported by Solr on the first page. */
  numFound: number;
  /** Docs that failed validation and were skipped. */
  skipped: number;
}

export class SolrRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SolrRequestError';
  }
}

const envelopeSchema = z.object({
  response: z.object({
    numFound: z.number().int().nonnegative(),
    docs: z.array(z.unknown()),
  }),
});

/** Lowercases, escapes and quotes a value when it has spaces ("general pueyrredon"). */
function fqValue(value: string): string {
  const v = value.trim().toLowerCase().replace(/[\\"]/g, '\\$&');
  return /\s/.test(v) ? `"${v}"` : v;
}

function fqField(field: string, values: readonly string[] | undefined): string | undefined {
  const clean = (values ?? []).filter((v) => v.trim() !== '');
  if (clean.length === 0) return undefined;
  if (clean.length === 1) return `${field}:${fqValue(clean[0] as string)}`;
  return `${field}:(${clean.map(fqValue).join(' OR ')})`;
}

export function buildSelectUrl(
  baseUrl: string,
  filters: OfferFilters,
  start: number,
  rows: number,
): URL {
  const url = new URL(baseUrl);
  const p = url.searchParams;
  p.set('q', '*:*');
  p.append('fq', 'estado:publicada');
  for (const fq of [
    fqField('descdistrito', filters.districts),
    fqField('descnivelmodalidad', filters.levels),
  ]) {
    if (fq) p.append('fq', fq);
  }
  p.set('rows', String(rows));
  p.set('start', String(start));
  p.set('sort', 'iniciooferta desc');
  p.set('wt', 'json');
  return url;
}

const sleepReal = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class SolrClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pageSize: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly maxPages: number;

  constructor(options: SolrClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchFn = options.fetch ?? fetch;
    this.sleep = options.sleep ?? sleepReal;
    this.pageSize = options.pageSize ?? 500;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000;
    this.maxPages = options.maxPages ?? 50;
  }

  /** Fetches every `Publicada` offer matching the filters, paginating with rows/start. */
  async fetchPublishedOffers(filters: OfferFilters = {}): Promise<CollectResult> {
    const byId = new Map<number, Offer>();
    let numFound = 0;
    let skipped = 0;

    for (let page = 0, start = 0; page < this.maxPages; page++, start += this.pageSize) {
      const body = await this.fetchPage(
        buildSelectUrl(this.baseUrl, filters, start, this.pageSize),
      );
      if (page === 0) numFound = body.numFound;

      for (const doc of body.docs) {
        const result = parseOffer(doc);
        if (result.ok) byId.set(result.offer.id, result.offer);
        else skipped++;
      }

      // Offers published mid-pagination shift the sorted window, so duplicates are
      // possible across pages; the Map above deduplicates by id.
      if (body.docs.length === 0 || start + this.pageSize >= numFound) break;
    }

    return { offers: [...byId.values()], numFound, skipped };
  }

  private async fetchPage(url: URL): Promise<z.output<typeof envelopeSchema>['response']> {
    let lastError: SolrRequestError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(this.retryBaseDelayMs * 2 ** (attempt - 1));
      try {
        return await this.requestOnce(url);
      } catch (error) {
        if (!(error instanceof SolrRequestError) || !error.retryable) throw error;
        lastError = error;
      }
    }
    throw lastError ?? new SolrRequestError('request failed', false);
  }

  private async requestOnce(url: URL): Promise<z.output<typeof envelopeSchema>['response']> {
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new SolrRequestError('network error or timeout', true, { cause });
    }

    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429;
      throw new SolrRequestError(`unexpected HTTP status ${res.status}`, retryable);
    }

    // The API sends Latin-1 / Windows-1252 without declaring it; decoding as UTF-8 yields "�".
    const raw = new TextDecoder('windows-1252').decode(await res.arrayBuffer());

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (cause) {
      throw new SolrRequestError('response is not valid JSON', false, { cause });
    }
    const envelope = envelopeSchema.safeParse(json);
    if (!envelope.success) {
      throw new SolrRequestError('response does not match the expected Solr envelope', false);
    }
    return envelope.data.response;
  }
}
