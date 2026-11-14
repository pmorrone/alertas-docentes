import { describe, expect, it, vi } from 'vitest';
import type { CollectResult, Offer } from '../../src/collector/index.js';
import { createCriteria } from '../../src/matcher/index.js';
import { createOfferSearch } from '../../src/search/offer-search.js';
import { makeOffer } from '../matcher/helpers.js';

const published = (id: number, extra: Record<string, unknown> = {}): Offer =>
  makeOffer({ iddetalle: id, finoferta: '2026-12-01T10:30:00Z', ...extra });

function setup(offers: Offer[]) {
  let time = 1_000_000;
  const fetchPublishedOffers = vi
    .fn<() => Promise<CollectResult>>()
    .mockImplementation(async () => ({ offers, numFound: offers.length, skipped: 0 }));
  const search = createOfferSearch({
    collector: { fetchPublishedOffers },
    ttlMs: 60_000,
    now: () => time,
  });
  return { search, fetchPublishedOffers, advance: (ms: number) => (time += ms) };
}

describe('createOfferSearch', () => {
  it('returns the matching offers, newest first, and counts all of them', async () => {
    const { search } = setup([
      published(1, { iniciooferta: '2026-11-10T09:00:00Z' }),
      published(2, { iniciooferta: '2026-11-12T09:00:00Z' }),
      published(3, { iniciooferta: '2026-11-11T09:00:00Z' }),
      published(4, { iniciooferta: '2026-11-13T09:00:00Z', descdistrito: 'TANDIL' }),
    ]);

    const result = await search.findMatching(createCriteria({ districts: ['pilar'] }), 2);

    expect(result.total).toBe(3);
    expect(result.offers.map((o) => o.id)).toEqual([2, 3]);
  });

  it('uses the same rules as the alerts (area, shift, substitutes)', async () => {
    const { search } = setup([
      published(1, { turno: 'M' }),
      published(2, { turno: 'T' }),
      published(3, { turno: 'T', supl_revista: 'T' }),
      published(4, { turno: 'T', estado: 'Designada' }),
    ]);

    const result = await search.findMatching(
      createCriteria({ areas: ['mdp'], shifts: ['T'], onlySubstitutes: true }),
      10,
    );

    expect(result.offers.map((o) => o.id)).toEqual([2]);
  });

  it('reuses the list until the TTL expires', async () => {
    const { search, fetchPublishedOffers, advance } = setup([published(1)]);
    const criteria = createCriteria({});

    await search.findMatching(criteria, 5);
    advance(59_000);
    await search.findMatching(criteria, 5);
    expect(fetchPublishedOffers).toHaveBeenCalledTimes(1);

    advance(2_000);
    await search.findMatching(criteria, 5);
    expect(fetchPublishedOffers).toHaveBeenCalledTimes(2);
  });

  it('shares one request between simultaneous searches', async () => {
    const { search, fetchPublishedOffers } = setup([published(1)]);

    await Promise.all([
      search.findMatching(createCriteria({}), 5),
      search.findMatching(createCriteria({ districts: ['pilar'] }), 5),
      search.findMatching(createCriteria({ areas: ['mdp'] }), 5),
    ]);

    expect(fetchPublishedOffers).toHaveBeenCalledTimes(1);
  });

  it('serves the older list when refreshing fails', async () => {
    const { search, fetchPublishedOffers, advance } = setup([published(1)]);
    await search.findMatching(createCriteria({}), 5);
    advance(120_000);
    fetchPublishedOffers.mockRejectedValueOnce(new Error('api down'));

    const result = await search.findMatching(createCriteria({}), 5);

    expect(result.total).toBe(1);
  });

  it('fails when there is nothing cached and the API is down, then recovers', async () => {
    const { search, fetchPublishedOffers } = setup([published(1)]);
    fetchPublishedOffers.mockRejectedValueOnce(new Error('api down'));

    await expect(search.findMatching(createCriteria({}), 5)).rejects.toThrow('api down');
    expect((await search.findMatching(createCriteria({}), 5)).total).toBe(1);
  });
});
