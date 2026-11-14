import type { CollectResult, Offer } from '../collector/index.js';
import { matches, type Criteria } from '../matcher/index.js';

export interface SearchResult {
  /** How many published offers match. */
  total: number;
  /** The newest ones, at most the requested limit. */
  offers: Offer[];
}

/** Looks at what is published right now, for "¿qué hay hoy?" and "ver lo que hay ahora". */
export interface OfferSearch {
  findMatching(criteria: Criteria, limit: number): Promise<SearchResult>;
}

export interface OfferSearchDeps {
  collector: { fetchPublishedOffers(): Promise<CollectResult> };
  /** How long the province-wide list is reused. Many teachers share one request. */
  ttlMs?: number;
  now?: () => number;
}

/**
 * Searches the whole published list in memory with the same matcher the alerts use.
 * Filtering locally (instead of asking Solr) keeps both paths consistent and avoids
 * mismatches like "canuelas" vs "cañuelas". The list is cached and concurrent requests
 * share one fetch, so the API is not hit once per message.
 */
export function createOfferSearch({
  collector,
  ttlMs = 5 * 60_000,
  now = Date.now,
}: OfferSearchDeps): OfferSearch {
  let cache: { offers: Offer[]; fetchedAt: number } | undefined;
  let inflight: Promise<Offer[]> | undefined;

  async function load(): Promise<Offer[]> {
    if (cache && now() - cache.fetchedAt < ttlMs) return cache.offers;
    inflight ??= (async () => {
      try {
        const { offers } = await collector.fetchPublishedOffers();
        const newestFirst = [...offers].sort(
          (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
        );
        cache = { offers: newestFirst, fetchedAt: now() };
        return newestFirst;
      } catch (error) {
        // An older list is better than no answer.
        if (cache) return cache.offers;
        throw error;
      } finally {
        inflight = undefined;
      }
    })();
    return inflight;
  }

  return {
    async findMatching(criteria, limit) {
      const found = (await load()).filter((offer) => matches(offer, criteria));
      return { total: found.length, offers: found.slice(0, limit) };
    },
  };
}
