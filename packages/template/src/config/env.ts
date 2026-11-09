/**
 * Shared environment validation utilities
 */

/**
 * Validate that required environment variables are set
 * Exits process with clear error message if any are missing
 */
export function validateEnv(required: string[]): void {
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\nCreate a .env file with these variables or set them in your environment.');
    process.exit(1);
  }
}

/**
 * Map an embedding provider to its required API key environment variable.
 * Providers that need no API key (e.g. local Ollama) are absent from this map.
 */
export const PROVIDER_API_KEY_ENV: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  cohere: 'COHERE_API_KEY',
  voyage: 'VOYAGE_API_KEY',
};

export type EmbeddingProviderName = 'openai' | 'gemini' | 'cohere' | 'voyage' | 'ollama';
export type VectorDbProviderName = 'pinecone' | 'qdrant';

/**
 * Validate embedding and vector DB environment variables
 */
export function validateEmbeddingEnv(
  provider: EmbeddingProviderName = 'openai',
  vectorDbProvider: VectorDbProviderName = 'pinecone'
): void {
  const required: string[] = [];
  const apiKeyVar = PROVIDER_API_KEY_ENV[provider];
  if (apiKeyVar) {
    required.push(apiKeyVar);
  }
  // Qdrant can run fully local/unauthenticated; Pinecone requires an API key.
  if (vectorDbProvider === 'pinecone') {
    required.push('PINECONE_API_KEY');
  }
  if (required.length > 0) {
    validateEnv(required);
  }
}

