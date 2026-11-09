import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  toQdrantPointId,
  initQdrantCollection,
  getQdrantStats,
  clearQdrantCollection,
  deleteQdrantVectors,
  upsertQdrantPoints,
  searchQdrant,
} from './qdrant.js';
import type { EmbeddingRecord } from '../embeddings/core.js';

describe('toQdrantPointId', () => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it('generates a valid UUID v5-compatible shape from a string id', () => {
    const id = toQdrantPointId('docs_overview_0');
    expect(id).toMatch(uuidRegex);
  });

  it('is deterministic: identical inputs yield identical UUIDs', () => {
    const id1 = toQdrantPointId('api_reference_payments_1');
    const id2 = toQdrantPointId('api_reference_payments_1');
    expect(id1).toBe(id2);
  });

  it('distinct inputs yield distinct UUIDs', () => {
    const id1 = toQdrantPointId('chunk_a');
    const id2 = toQdrantPointId('chunk_b');
    expect(id1).not.toBe(id2);
  });
});

describe('Qdrant HTTP REST operations', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('initQdrantCollection creates collection if 404', async () => {
    const fetchMock = vi.fn();
    // First call (GET) returns 404
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    // Second call (PUT) returns 200
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ result: true }), { status: 200 }));
    globalThis.fetch = fetchMock;

    await initQdrantCollection('http://localhost:6333', 'my-docs', 768, 'secret-key');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:6333/collections/my-docs');
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      'Content-Type': 'application/json',
      'api-key': 'secret-key',
    });

    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:6333/collections/my-docs');
    expect(fetchMock.mock.calls[1][1]?.method).toBe('PUT');
    const body = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(body).toEqual({
      vectors: {
        size: 768,
        distance: 'Cosine',
      },
    });
  });

  it('initQdrantCollection does nothing if collection exists', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock;

    await initQdrantCollection('http://localhost:6333', 'existing-docs', 768);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('getQdrantStats extracts vector count and dimensions', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: {
            points_count: 142,
            config: {
              params: {
                vectors: { size: 768, distance: 'Cosine' },
              },
            },
          },
        }),
        { status: 200 }
      )
    );
    globalThis.fetch = fetchMock;

    const stats = await getQdrantStats('http://localhost:6333', 'my-docs');
    expect(stats).toEqual({ vectorCount: 142, dimension: 768 });
  });

  it('upsertQdrantPoints sends mapped UUIDs, vectors, and metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ result: { status: 'completed' } }), { status: 200 })
    );
    globalThis.fetch = fetchMock;

    const record: EmbeddingRecord = {
      id: 'doc_1',
      values: [0.1, 0.2, 0.3],
      metadata: {
        documentPath: 'docs/intro.md',
        documentTitle: 'Introduction',
        category: 'guides',
        heading: 'Getting Started',
        content: 'Welcome to the guide.',
        sourceUrl: 'https://example.com/docs/intro',
      },
    };

    await upsertQdrantPoints('http://localhost:6333', 'my-docs', [record]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:6333/collections/my-docs/points?wait=true');
    expect(init?.method).toBe('PUT');
    const body = JSON.parse(init?.body as string);
    expect(body.points).toHaveLength(1);
    expect(body.points[0].id).toBe(toQdrantPointId('doc_1'));
    expect(body.points[0].vector).toEqual([0.1, 0.2, 0.3]);
    expect(body.points[0].payload.documentTitle).toBe('Introduction');
    expect(body.points[0].payload.vectorId).toBe('doc_1');
  });

  it('searchQdrant queries /points/search and shapes SearchResult array', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: [
            {
              id: 'a1b2c3d4',
              score: 0.9412,
              payload: {
                documentTitle: 'Payment API',
                heading: 'Create Payment',
                content: 'Call POST /v1/payments',
                sourceUrl: 'https://example.com/api',
              },
            },
          ],
        }),
        { status: 200 }
      )
    );
    globalThis.fetch = fetchMock;

    const results = await searchQdrant('http://localhost:6333', 'my-docs', [0.1, 0.2], 5);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      score: 0.94,
      title: 'Payment API',
      heading: 'Create Payment',
      content: 'Call POST /v1/payments',
      url: 'https://example.com/api',
      language: undefined,
      method: undefined,
      path: undefined,
    });
  });

  it('deleteQdrantVectors maps ids to UUIDs and deletes', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ result: { status: 'completed' } }), { status: 200 })
    );
    globalThis.fetch = fetchMock;

    await deleteQdrantVectors('http://localhost:6333', 'my-docs', ['chunk_1', 'chunk_2']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.points).toEqual([
      toQdrantPointId('chunk_1'),
      toQdrantPointId('chunk_2'),
    ]);
  });
});

