/**
 * Qdrant Vector Database Client
 *
 * Fully self-hostable, zero-cloud vector storage adapter for ContextMCP.
 * Communicates directly with Qdrant via its standard HTTP REST API (port 6333)
 * using Node's native fetch. No extra external SDK dependencies required.
 */

import { createHash } from 'node:crypto';
import type { EmbeddingRecord } from '../embeddings/core.js';
import { type SearchResult, mapMatchToSearchResult } from '../search-core.js';

/**
 * Deterministically transform any string vector ID (e.g. from toVectorId)
 * into a valid RFC 4122 UUID required by Qdrant point IDs.
 */
export function toQdrantPointId(vectorId: string): string {
  const hash = createHash('sha256').update(vectorId).digest('hex');
  const p1 = hash.substring(0, 8);
  const p2 = hash.substring(8, 12);
  const p3 = '5' + hash.substring(13, 16);
  const p4 = ((parseInt(hash.substring(16, 17), 16) & 0x3) | 0x8).toString(16) + hash.substring(17, 20);
  const p5 = hash.substring(20, 32);
  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['api-key'] = apiKey;
  }
  return headers;
}

/**
 * Initialize a Qdrant collection, creating it if it doesn't exist.
 */
export async function initQdrantCollection(
  url: string,
  collectionName: string,
  dimension: number,
  apiKey?: string
): Promise<void> {
  const baseUrl = url.replace(/\/$/, '');
  const headers = buildHeaders(apiKey);

  const checkRes = await fetch(`${baseUrl}/collections/${encodeURIComponent(collectionName)}`, {
    headers,
  });

  if (checkRes.status === 404) {
    console.log(`📦 Creating Qdrant collection: ${collectionName} (dim=${dimension}, cosine)`);
    const createRes = await fetch(`${baseUrl}/collections/${encodeURIComponent(collectionName)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        vectors: {
          size: dimension,
          distance: 'Cosine',
        },
      }),
    });

    if (!createRes.ok) {
      const text = await createRes.text();
      throw new Error(`Failed to create Qdrant collection "${collectionName}": ${createRes.status} ${text}`);
    }
    console.log('✅ Qdrant collection ready!');
  } else if (checkRes.ok) {
    console.log(`✅ Using existing Qdrant collection: ${collectionName}`);
  } else {
    const text = await checkRes.text();
    throw new Error(`Failed to check Qdrant collection "${collectionName}": ${checkRes.status} ${text}`);
  }
}

/**
 * Get statistics for a Qdrant collection.
 */
export async function getQdrantStats(
  url: string,
  collectionName: string,
  apiKey?: string
): Promise<{ vectorCount: number; dimension: number }> {
  const baseUrl = url.replace(/\/$/, '');
  const headers = buildHeaders(apiKey);

  const res = await fetch(`${baseUrl}/collections/${encodeURIComponent(collectionName)}`, {
    headers,
  });

  if (res.status === 404) {
    return { vectorCount: 0, dimension: 0 };
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch Qdrant collection stats: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    result?: {
      points_count?: number;
      indexed_vectors_count?: number;
      config?: {
        params?: {
          vectors?: { size?: number } | Record<string, { size?: number }>;
        };
      };
    };
  };

  const pointsCount = data.result?.points_count ?? data.result?.indexed_vectors_count ?? 0;
  const vectorParams = data.result?.config?.params?.vectors;
  let dimension = 0;
  if (vectorParams && typeof vectorParams === 'object') {
    if ('size' in vectorParams && typeof vectorParams.size === 'number') {
      dimension = vectorParams.size;
    }
  }

  return { vectorCount: pointsCount, dimension };
}

/**
 * Clear all points in a Qdrant collection by deleting and recreating the collection.
 */
export async function clearQdrantCollection(
  url: string,
  collectionName: string,
  dimension: number,
  apiKey?: string
): Promise<{ success: boolean; vectorCount?: number }> {
  try {
    const stats = await getQdrantStats(url, collectionName, apiKey);
    const vectorCount = stats.vectorCount;

    if (vectorCount === 0) {
      console.log('   Index is already empty');
      return { success: true, vectorCount: 0 };
    }

    console.log(`   Found ${vectorCount.toLocaleString()} vectors to delete...`);

    const baseUrl = url.replace(/\/$/, '');
    const headers = buildHeaders(apiKey);

    const delRes = await fetch(`${baseUrl}/collections/${encodeURIComponent(collectionName)}`, {
      method: 'DELETE',
      headers,
    });

    if (!delRes.ok && delRes.status !== 404) {
      const text = await delRes.text();
      throw new Error(`Failed to delete Qdrant collection: ${delRes.status} ${text}`);
    }

    // Re-create empty collection with same configuration
    await initQdrantCollection(url, collectionName, dimension, apiKey);
    return { success: true, vectorCount };
  } catch (error) {
    console.error('   Error clearing Qdrant collection:', error);
    return { success: false };
  }
}

/**
 * Delete vectors by id from Qdrant.
 */
export async function deleteQdrantVectors(
  url: string,
  collectionName: string,
  ids: string[],
  apiKey?: string
): Promise<void> {
  if (ids.length === 0) return;

  const baseUrl = url.replace(/\/$/, '');
  const headers = buildHeaders(apiKey);
  const pointIds = ids.map(toQdrantPointId);

  const res = await fetch(`${baseUrl}/collections/${encodeURIComponent(collectionName)}/points/delete?wait=true`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ points: pointIds }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to delete points from Qdrant: ${res.status} ${text}`);
  }
}

/**
 * Upsert records into Qdrant.
 */
export async function upsertQdrantPoints(
  url: string,
  collectionName: string,
  records: EmbeddingRecord[],
  apiKey?: string
): Promise<void> {
  if (records.length === 0) return;

  const baseUrl = url.replace(/\/$/, '');
  const headers = buildHeaders(apiKey);

  const points = records.map(r => ({
    id: toQdrantPointId(r.id),
    vector: r.values,
    payload: {
      vectorId: r.id,
      ...r.metadata,
    },
  }));

  const res = await fetch(`${baseUrl}/collections/${encodeURIComponent(collectionName)}/points?wait=true`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ points }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to upsert points into Qdrant: ${res.status} ${text}`);
  }
}

/**
 * Search Qdrant collection for nearest neighbors.
 */
export async function searchQdrant(
  url: string,
  collectionName: string,
  queryEmbedding: number[],
  limit: number,
  apiKey?: string
): Promise<SearchResult[]> {
  const baseUrl = url.replace(/\/$/, '');
  const headers = buildHeaders(apiKey);

  const res = await fetch(`${baseUrl}/collections/${encodeURIComponent(collectionName)}/points/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      vector: queryEmbedding,
      limit,
      with_payload: true,
      with_vector: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Qdrant search failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    result?: Array<{ score?: number; payload?: Record<string, unknown> }>;
  };

  return (data.result ?? []).map(match => mapMatchToSearchResult(match.score, match.payload));
}

