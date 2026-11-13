import { describe, expect, it, vi } from 'vitest';
import {
  SolrClient,
  SolrRequestError,
  buildSelectUrl,
  type SolrClientOptions,
} from '../../src/collector/index.js';
import {
  PERSONAL_FIELDS,
  PERSONAL_SENTINELS,
  dump,
  latin1Response,
  makeDoc,
  sampleDoc,
  solrBody,
} from './helpers.js';

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function makeClient(fetchMock: FetchMock, options: SolrClientOptions = {}) {
  const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue();
  const client = new SolrClient({ fetch: fetchMock, sleep, retryBaseDelayMs: 100, ...options });
  return { client, sleep };
}

function urlOf(fetchMock: FetchMock, call = 0): URL {
  return new URL(String(fetchMock.mock.calls[call]?.[0]));
}

describe('buildSelectUrl', () => {
  const base = 'https://example.test/select';

  it('requests only published offers as plain JSON (no JSONP)', () => {
    const url = buildSelectUrl(base, {}, 500, 250);

    expect(url.searchParams.getAll('fq')).toEqual(['estado:publicada']);
    expect(url.searchParams.get('q')).toBe('*:*');
    expect(url.searchParams.get('rows')).toBe('250');
    expect(url.searchParams.get('start')).toBe('500');
    expect(url.searchParams.get('sort')).toBe('iniciooferta desc');
    expect(url.searchParams.get('wt')).toBe('json');
    expect(url.searchParams.has('json.wrf')).toBe(false);
  });

  it('lowercases filter values and quotes the ones with spaces', () => {
    const url = buildSelectUrl(base, { districts: ['General Pueyrredon'] }, 0, 10);

    expect(url.searchParams.getAll('fq')).toContain('descdistrito:"general pueyrredon"');
  });

  it('ORs several values and quotes only the ones that need it', () => {
    const url = buildSelectUrl(
      base,
      { districts: ['Tandil', 'Mar Chiquita'], levels: ['Primaria', 'Secundaria'] },
      0,
      10,
    );

    expect(url.searchParams.getAll('fq')).toEqual([
      'estado:publicada',
      'descdistrito:(tandil OR "mar chiquita")',
      'descnivelmodalidad:(primaria OR secundaria)',
    ]);
  });

  it('escapes quotes inside values and ignores blank ones', () => {
    const url = buildSelectUrl(base, { districts: ['a "b"', '  '] }, 0, 10);

    expect(url.searchParams.getAll('fq')).toContain('descdistrito:"a \\"b\\""');
  });
});

describe('SolrClient.fetchPublishedOffers', () => {
  it('decodes the response as windows-1252 so accents and ° survive', async () => {
    const doc = makeDoc({
      cursodivision: '2°B',
      descdistrito: 'CAÑUELAS',
      descnivelmodalidad: 'TECNOLÓGICO',
    });
    const fetchMock: FetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(latin1Response(solrBody([doc])));
    const { client } = makeClient(fetchMock);

    const { offers } = await client.fetchPublishedOffers();

    expect(offers[0]?.courseDivision).toBe('2°B');
    expect(offers[0]?.districtName).toBe('CAÑUELAS');
    expect(offers[0]?.levelName).toBe('TECNOLÓGICO');
    expect(offers[0]?.normalized.level).toBe('tecnologico');
  });

  it('sends an identifiable User-Agent and a timeout signal', async () => {
    const fetchMock: FetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(latin1Response(solrBody([])));
    const { client } = makeClient(fetchMock, { userAgent: 'test-agent/1.0' });

    await client.fetchPublishedOffers();

    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('user-agent')).toBe('test-agent/1.0');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses an identifiable default User-Agent', async () => {
    const fetchMock: FetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(latin1Response(solrBody([])));
    const { client } = makeClient(fetchMock);

    await client.fetchPublishedOffers();

    const ua = new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('user-agent');
    expect(ua).toMatch(/^alertas-docentes\//);
  });

  it('paginates with rows/start until numFound and deduplicates by id', async () => {
    const docs = [1, 2, 3, 4, 5].map((n) => makeDoc({ iddetalle: n, id: String(n) }));
    const fetchMock: FetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(latin1Response(solrBody(docs.slice(0, 2), 5, 0)))
      // Offer 2 shows up again: the window shifted because a new offer was published.
      .mockResolvedValueOnce(latin1Response(solrBody([docs[1]!, docs[2]!], 5, 2)))
      .mockResolvedValueOnce(latin1Response(solrBody(docs.slice(3), 5, 4)));
    const { client } = makeClient(fetchMock, { pageSize: 2 });

    const result = await client.fetchPublishedOffers();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect([0, 1, 2].map((i) => urlOf(fetchMock, i).searchParams.get('start'))).toEqual([
      '0',
      '2',
      '4',
    ]);
    expect(urlOf(fetchMock).searchParams.get('rows')).toBe('2');
    expect(result.numFound).toBe(5);
    expect(result.offers.map((o) => o.id).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('stops on an empty page even if numFound is larger', async () => {
    const fetchMock: FetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(latin1Response(solrBody([makeDoc()], 100, 0)))
      .mockResolvedValueOnce(latin1Response(solrBody([], 100, 1)));
    const { client } = makeClient(fetchMock, { pageSize: 1 });

    const { offers } = await client.fetchPublishedOffers();

    expect(offers).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('applies filters to every page request', async () => {
    const fetchMock: FetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(latin1Response(solrBody([])));
    const { client } = makeClient(fetchMock);

    await client.fetchPublishedOffers({ districts: ['General Pueyrredon'] });

    expect(urlOf(fetchMock).searchParams.getAll('fq')).toEqual([
      'estado:publicada',
      'descdistrito:"general pueyrredon"',
    ]);
  });

  it('skips docs that fail validation and counts them', async () => {
    const bad = { ...sampleDoc, iddetalle: undefined };
    const fetchMock: FetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(latin1Response(solrBody([sampleDoc, bad, 'garbage'], 3)));
    const { client } = makeClient(fetchMock);

    const result = await client.fetchPublishedOffers();

    expect(result.offers).toHaveLength(1);
    expect(result.skipped).toBe(2);
  });

  it('never returns personal data, even when the API sends it', async () => {
    const doc = makeDoc({ ...PERSONAL_SENTINELS });
    const fetchMock: FetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(latin1Response(solrBody([sampleDoc, doc], 2)));
    const { client } = makeClient(fetchMock, { pageSize: 10 });

    const result = await client.fetchPublishedOffers();
    const output = dump(result);

    expect(result.offers.length).toBeGreaterThan(0);
    for (const field of PERSONAL_FIELDS) {
      expect(output.toLowerCase()).not.toContain(field);
      expect(output).not.toContain(PERSONAL_SENTINELS[field]);
    }
    for (const value of ['20000000001', '20000000002', 'APELLIDO NOMBRE', 'Licencia']) {
      expect(output).not.toContain(value);
    }
  });

  describe('retries', () => {
    it('retries 5xx with exponential backoff and then succeeds', async () => {
      const fetchMock: FetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response('', { status: 503 }))
        .mockResolvedValueOnce(new Response('', { status: 502 }))
        .mockResolvedValueOnce(latin1Response(solrBody([sampleDoc])));
      const { client, sleep } = makeClient(fetchMock);

      const { offers } = await client.fetchPublishedOffers();

      expect(offers).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([100, 200]);
    });

    it('retries network errors and timeouts', async () => {
      const fetchMock: FetchMock = vi
        .fn<typeof fetch>()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
        .mockResolvedValueOnce(latin1Response(solrBody([sampleDoc])));
      const { client } = makeClient(fetchMock);

      const { offers } = await client.fetchPublishedOffers();

      expect(offers).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('gives up after maxRetries and throws a retryable error', async () => {
      const fetchMock: FetchMock = vi
        .fn<typeof fetch>()
        .mockImplementation(() => Promise.resolve(new Response('', { status: 500 })));
      const { client, sleep } = makeClient(fetchMock, { maxRetries: 2 });

      const error = await client.fetchPublishedOffers().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(SolrRequestError);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenCalledTimes(2);
    });

    it('does not retry 4xx responses', async () => {
      const fetchMock: FetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('', { status: 400 }));
      const { client, sleep } = makeClient(fetchMock);

      await expect(client.fetchPublishedOffers()).rejects.toBeInstanceOf(SolrRequestError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it('does not retry a response that is not the expected Solr envelope', async () => {
      const fetchMock: FetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(latin1Response({ unexpected: true }));
      const { client } = makeClient(fetchMock);

      await expect(client.fetchPublishedOffers()).rejects.toThrow(/envelope/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry invalid JSON', async () => {
      const fetchMock: FetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('<html>oops</html>', { status: 200 }));
      const { client } = makeClient(fetchMock);

      await expect(client.fetchPublishedOffers()).rejects.toThrow(/JSON/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
