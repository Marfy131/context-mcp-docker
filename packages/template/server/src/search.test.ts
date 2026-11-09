import { describe, it, expect } from 'vitest';
import { clampLimit, formatResults, type SearchResult } from './search.js';

describe('clampLimit', () => {
  it('uses the default when no limit is given', () => {
    expect(clampLimit(undefined, 10, 20)).toBe(10);
  });

  it('caps at maxTopK', () => {
    expect(clampLimit(50, 10, 20)).toBe(20);
  });

  it('enforces a minimum of 1', () => {
    expect(clampLimit(0, 10, 20)).toBe(1);
    expect(clampLimit(-5, 10, 20)).toBe(1);
  });

  it('passes through a valid in-range limit', () => {
    expect(clampLimit(7, 10, 20)).toBe(7);
  });
});

describe('formatResults', () => {
  const results: SearchResult[] = [
    {
      score: 0.9,
      title: 'Auth',
      heading: 'API Keys',
      content: 'Use a bearer token.',
      url: 'https://docs.example.com/auth',
      method: 'GET',
      path: '/v1/keys',
      language: 'http',
    },
  ];

  it('includes a header with the query and result count', () => {
    const out = formatResults(results, 'how to auth', 'MyDocs');
    expect(out).toContain('# MyDocs Documentation');
    expect(out).toContain('> Query: how to auth');
    expect(out).toContain('> Results: 1');
  });

  it('renders title, source, API line, and content', () => {
    const out = formatResults(results, 'q', 'MyDocs');
    expect(out).toContain('## Auth');
    expect(out).toContain('Source: https://docs.example.com/auth');
    expect(out).toContain('API: GET /v1/keys');
    expect(out).toContain('Use a bearer token.');
  });

  it('handles an empty result set', () => {
    const out = formatResults([], 'nothing', 'MyDocs');
    expect(out).toContain('> Results: 0');
  });
});

describe('searchDocs with Qdrant provider', () => {
  it('calls Qdrant search endpoint and formats results', async () => {
    const { searchDocs } = await import('./search.js');
    const originalFetch = globalThis.fetch;
    const fetchMock = (globalThis.fetch = ((url: string, init?: RequestInit) => {
      // Ollama embedding call
      if (String(url).includes('/api/embed')) {
        return Promise.resolve(
          new Response(JSON.stringify({ embeddings: [[0.1, 0.2, 0.3]] }), { status: 200 })
        );
      }
      // Qdrant search call
      if (String(url).includes('/points/search')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              result: [
                {
                  id: 'uuid-1',
                  score: 0.95,
                  payload: {
                    documentTitle: 'Local Docs',
                    heading: 'Setup',
                    content: 'How to install in docker.',
                    sourceUrl: 'http://localhost/setup',
                  },
                },
              ],
            }),
            { status: 200 }
          )
        );
      }
      return Promise.reject(new Error(`Unexpected url: ${url}`));
    }) as unknown as typeof fetch);

    try {
      const results = await searchDocs(
        undefined,
        {
          port: 8787,
          serverName: 'test',
          serverDescription: 'test',
          vectorDbProvider: 'qdrant',
          qdrantUrl: 'http://localhost:6333',
          qdrantCollectionName: 'docs',
          embeddingProvider: 'ollama',
          embeddingModel: 'nomic-embed-text',
          embeddingDimensions: 768,
          ollamaBaseUrl: 'http://localhost:11434',
          defaultTopK: 10,
          maxTopK: 20,
          enableRerank: false,
          rerankModel: 'pinecone-rerank-v0',
          rerankFetchCount: 30,
          maxRerankChars: 1200,
        },
        'how to install',
        5
      );

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Local Docs');
      expect(results[0].content).toBe('How to install in docker.');
      expect(results[0].score).toBe(0.95);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
