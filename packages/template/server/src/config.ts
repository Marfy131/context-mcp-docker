/**
 * Server configuration, read from environment variables.
 *
 * Mirrors the Cloudflare worker's env contract so the same Pinecone index can
 * be served from either runtime.
 */

export interface ServerConfig {
  port: number;
  serverName: string;
  serverDescription: string;
  vectorDbProvider: 'pinecone' | 'qdrant';
  pineconeApiKey?: string;
  pineconeIndexName?: string;
  qdrantUrl: string;
  qdrantCollectionName: string;
  qdrantApiKey?: string;
  embeddingProvider: 'openai' | 'gemini' | 'cohere' | 'voyage' | 'ollama';
  embeddingModel: string;
  embeddingDimensions: number;
  openaiApiKey?: string;
  geminiApiKey?: string;
  cohereApiKey?: string;
  voyageApiKey?: string;
  ollamaBaseUrl: string;
  defaultTopK: number;
  maxTopK: number;
  enableRerank: boolean;
  rerankModel: string;
  rerankFetchCount: number;
  maxRerankChars: number;
}

function int(value: string | undefined, fallback: number): number {
  const n = parseInt(value ?? '', 10);
  return Number.isNaN(n) ? fallback : n;
}

/**
 * Build the server config from process.env, throwing on missing required vars.
 */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rawProvider = env.VECTOR_DB_PROVIDER?.toLowerCase();
  const vectorDbProvider: 'pinecone' | 'qdrant' =
    rawProvider === 'qdrant'
      ? 'qdrant'
      : rawProvider === 'pinecone'
        ? 'pinecone'
        : env.PINECONE_API_KEY
          ? 'pinecone'
          : env.QDRANT_URL || env.QDRANT_COLLECTION_NAME
            ? 'qdrant'
            : 'pinecone';

  const pineconeApiKey = env.PINECONE_API_KEY;
  const pineconeIndexName = env.PINECONE_INDEX_NAME;

  if (vectorDbProvider === 'pinecone') {
    const missing: string[] = [];
    if (!pineconeApiKey) missing.push('PINECONE_API_KEY');
    if (!pineconeIndexName) missing.push('PINECONE_INDEX_NAME');
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  // Validate PORT range up front so an out-of-range value fails with a clear
  // config error instead of a RangeError thrown deep inside server.listen().
  // Port 0 is allowed (OS-assigned ephemeral port).
  const port = int(env.PORT, 8787);
  if (port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT} (must be between 0 and 65535)`);
  }

  const embeddingProvider = (env.EMBEDDING_PROVIDER as ServerConfig['embeddingProvider']) || 'openai';
  const defaultModel = embeddingProvider === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-large';
  const defaultDimensions = embeddingProvider === 'ollama' ? 768 : 3072;

  // By default, rerank is true for Pinecone, but false for local Qdrant unless explicitly requested.
  const enableRerank =
    env.ENABLE_RERANK !== undefined
      ? env.ENABLE_RERANK !== 'false'
      : vectorDbProvider === 'pinecone';

  return {
    port,
    serverName: env.SERVER_NAME || 'contextmcp',
    serverDescription: env.SERVER_DESCRIPTION || 'Search documentation',
    vectorDbProvider,
    pineconeApiKey,
    pineconeIndexName,
    qdrantUrl: env.QDRANT_URL || 'http://localhost:6333',
    qdrantCollectionName: env.QDRANT_COLLECTION_NAME || env.PINECONE_INDEX_NAME || 'docs',
    qdrantApiKey: env.QDRANT_API_KEY,
    embeddingProvider,
    embeddingModel: env.EMBEDDING_MODEL || defaultModel,
    embeddingDimensions: int(env.EMBEDDING_DIMENSIONS, defaultDimensions),
    openaiApiKey: env.OPENAI_API_KEY,
    geminiApiKey: env.GEMINI_API_KEY,
    cohereApiKey: env.COHERE_API_KEY,
    voyageApiKey: env.VOYAGE_API_KEY,
    ollamaBaseUrl: env.OLLAMA_BASE_URL || 'http://localhost:11434',
    defaultTopK: int(env.DEFAULT_TOP_K, 10),
    maxTopK: int(env.MAX_TOP_K, 20),
    enableRerank,
    rerankModel: env.RERANK_MODEL || 'pinecone-rerank-v0',
    rerankFetchCount: int(env.RERANK_FETCH_COUNT, 30),
    maxRerankChars: int(env.MAX_RERANK_CHARS, 1200),
  };
}
