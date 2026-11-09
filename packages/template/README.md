# ContextMCP

Self-hosted MCP server for your documentation. Index your docs, APIs, and SDKs for semantic search via the Model Context Protocol.

## Quick Start

### 1. Configure Environment Variables

Copy `.env.example` to `.env` and add your API keys:

```bash
cp .env.example .env
```

Required environment variables:

- For **100% Local Offline Mode (Qdrant + Ollama)**:
  - No cloud API keys required!
  - `QDRANT_URL` (optional, defaults to `http://localhost:6333`)
  - `OLLAMA_BASE_URL` (optional, defaults to `http://localhost:11434`)
- For **Cloud Mode (Pinecone)**:
  - `PINECONE_API_KEY` - Your Pinecone API key
  - One embedding provider key matching `embeddings.provider` in `config.yaml` (`OPENAI_API_KEY`, `GEMINI_API_KEY`, etc.)

### Vector Database Providers

ContextMCP supports two vector databases:

| Provider | Description | Hosting |
| -------- | ----------- | ------- |
| `qdrant` | **100% Local**, fast Rust-based vector database | Self-hosted (Docker / local binary) |
| `pinecone` | Managed cloud vector database | Pinecone Cloud (AWS/GCP/Azure) |

### Embedding Providers

ContextMCP supports five embedding providers. Pick one in `config.yaml`:

| Provider | `model`                      | `dimensions` | Env var          |
| -------- | ---------------------------- | ------------ | ---------------- |
| `ollama` | `nomic-embed-text`           | `768`        | _(none — 100% local)_ |
| `openai` | `text-embedding-3-large`     | `3072`       | `OPENAI_API_KEY` |
| `gemini` | `gemini-embedding-2-preview` | `3072`       | `GEMINI_API_KEY` |
| `cohere` | `embed-v4.0`                 | `1536`       | `COHERE_API_KEY` |
| `voyage` | `voyage-4`                   | `1024`       | `VOYAGE_API_KEY` |

You only need the API key for the provider you choose. `ollama` needs none — it
runs fully offline against a local [Ollama](https://ollama.com) server (set
`embeddings.ollama.baseUrl` in `config.yaml`, default `http://localhost:11434`).

### 2. Configure Documentation Sources

Edit `config.yaml` to add your documentation sources:

```yaml
vectordb:
  provider: pinecone
  indexName: my-docs # Your Pinecone index name

embeddings:
  provider: openai
  model: text-embedding-3-large
  dimensions: 3072

sources:
  # MDX documentation (Mintlify, Fumadocs, Docusaurus)
  - name: my-docs
    displayName: 'My Documentation'
    type: github
    repository: myorg/my-docs
    parser: mdx
    baseUrl: https://docs.example.com

  # OpenAPI specification
  - name: my-api
    displayName: 'API Reference'
    type: github
    repository: myorg/my-docs
    path: openapi
    parser: openapi
    baseUrl: https://docs.example.com/api-reference

  # SDK README (plain markdown)
  - name: sdk-typescript
    displayName: 'TypeScript SDK'
    type: github
    repository: myorg/my-sdk-typescript
    parser: markdown
    language: typescript
```

### 3. Index Your Documentation

```bash
# Install dependencies
npm install

# Run the indexer
npm run reindex

# Or do a dry run first
npm run reindex:dry
```

### 4. Deploy the MCP Server

#### Option A: Cloudflare Worker

```bash
cd cloudflare-worker
npm install

# Set secrets (use GEMINI_API_KEY instead of OPENAI_API_KEY if provider: gemini)
wrangler secret put PINECONE_API_KEY
wrangler secret put OPENAI_API_KEY

# Deploy
npm run deploy
```

#### Option B: Docker (self-hosted)

The `server/` directory is a self-hostable Node.js server with the same `/mcp`,
`/search`, and `/health` endpoints, querying the same Pinecone index. It ships
a ready `Dockerfile`:

```bash
cd server
cp .env.example .env   # set PINECONE_API_KEY, PINECONE_INDEX_NAME + provider key
docker build -t contextmcp-server .
docker run --rm -p 8787:8787 --env-file .env contextmcp-server
```

Or one command with Docker Compose (run from `server/`, reads `.env`
automatically): `docker compose up --build -d`.

No Docker? `npm install && npm start` runs the same server directly on Node 18+.
See `server/README.md` for endpoints, configuration, and MCP client setup.

## Available Parsers

| Parser     | Use Case                                   | Extensions       |
| ---------- | ------------------------------------------ | ---------------- |
| `mdx`      | MDX/ documentation (Mintlify, Fumadocs)    | `.mdx`           |
| `markdown` | Plain markdown files (READMEs, CHANGELOGs) | `.md`            |
| `openapi`  | OpenAPI/Swagger specifications             | `.yaml`, `.json` |

## Source Types

| Type     | Description                        |
| -------- | ---------------------------------- |
| `github` | Fetch from GitHub repository       |
| `gitlab` | Fetch from GitLab (or self-hosted) |
| `local`  | Local file path                    |
| `url`    | Remote URL                         |

## Project Structure

```
├── src/
│   ├── parser/           # Document parsers
│   │   ├── chunkers/     # MDX, Markdown, OpenAPI chunkers
│   │   └── core/         # Shared utilities
│   ├── embeddings/       # Embedding generation (OpenAI, Gemini, Cohere, Voyage, Ollama)
│   ├── sources/          # GitHub, GitLab, local, URL fetchers
│   ├── config/           # Config schema and loader
│   └── types/            # TypeScript types
├── cloudflare-worker/    # MCP server deployment (Cloudflare Workers)
├── server/               # Self-hosted Node.js MCP server (Docker)
├── scripts/              # Reindex and utility scripts
├── config.yaml           # Your configuration
└── .env                  # API keys (not committed)
```

## Scripts

| Script                               | Description                            |
| ------------------------------------ | -------------------------------------- |
| `npm run reindex`                    | Index all documentation sources        |
| `npm run reindex:dry`                | Dry run (no uploads)                   |
| `npm run reindex:incremental`        | Only embed/upload changed chunks       |
| `npm run reindex -- --source=<name>` | Index specific source                  |
| `npm run clean:vectors`              | Clear all vectors (asks to confirm)    |
| `npm run clean:vectors -- --force`   | Clear all vectors without confirmation |
| `npm run typecheck`                  | TypeScript type checking               |
| `npm test`                           | Run unit tests (Vitest)                |
| `npm run test:watch`                 | Run unit tests in watch mode           |

## Testing

Unit tests are written with [Vitest](https://vitest.dev) and live next to the
code they cover (`*.test.ts`). Run the suite with:

```bash
npm test
```

## Documentation

For full documentation, visit [contextmcp.ai/docs](https://contextmcp.ai/docs)

## License

Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
