# ContextMCP — Self-hosted Node.js Server

A long-running Node.js server that serves your documentation search over the
**Model Context Protocol** (MCP) and a simple REST endpoint. Use this instead
of the Cloudflare Worker when you want to self-host (Docker, local laptop, a VM, Fly.io, etc.)
and/or run 100% offline with a local vector database (Qdrant) and local embeddings (Ollama).

It queries the same vector index (Qdrant collection or Pinecone index) your `reindex` job populates.

## 100% Local Offline Quick Start (Docker Compose)
Run the server, local Qdrant and local Ollama (CPU) together. The embedding
model `nomic-embed-text:latest` is pulled automatically on first start, so
nothing besides Docker needs to be installed on the host:

```bash
cp .env.example .env
docker compose up --build -d   # first run downloads the model; watch: docker compose logs -f ollama-pull
```

This spins up:
- **`contextmcp-server`**: `http://localhost:8787` (`/mcp` and `/search`); starts only after Ollama is healthy and the model pull finished
- **`qdrant`**: local vector store on `http://localhost:6333` (dashboard at `http://localhost:6333/dashboard`)
- **`ollama`**: local embedding server on `http://localhost:11434`, CPU by default; set `OLLAMA_BASE_URL=http://host.docker.internal:11434` in `.env` to use a host-installed Ollama with GPU instead
## Endpoints

| Method     | Path      | Description                                                |
| ---------- | --------- | ---------------------------------------------------------- |
| POST       | `/mcp`    | MCP Streamable HTTP transport (stateless)                  |
| GET / POST | `/search` | REST search — CORS-enabled, same as the Worker's `/search` |
| GET        | `/health` | Liveness probe                                             |

`/search` accepts either `?query=...&limit=...` (GET) or a JSON body
`{ "query": "...", "limit": 10 }` (POST), and returns
`{ "query", "count", "results" }`. Unlike `/mcp` and `/health`, it sends CORS
headers (`Access-Control-Allow-Origin: *` + preflight `OPTIONS` support) so a
browser-based client can call it directly, matching the Cloudflare worker.

## Quick start

```bash
cp .env.example .env   # fill in PINECONE_API_KEY, PINECONE_INDEX_NAME, etc.
npm install
npm start              # or: npm run dev (watch mode)
```

Then point an MCP client at `http://localhost:8787/mcp`, or query directly:

```bash
curl -X POST http://localhost:8787/search \
  -H 'Content-Type: application/json' \
  -d '{"query": "how do I authenticate?", "limit": 5}'

# or, from a browser / GET request:
curl 'http://localhost:8787/search?query=how+do+I+authenticate&limit=5'
```

## Docker

```bash
docker build -t contextmcp-server .
docker run --rm -p 8787:8787 --env-file .env contextmcp-server
```

Or with Docker Compose, which reads `.env` automatically via variable mapping
(this deployment path replaces the Cloudflare Worker entirely):

```bash
docker compose up --build -d
docker compose logs -f
```

`docker-compose.yml` maps every variable from `.env` (see `.env.example`), so
no other configuration is needed. The image runs a healthcheck against `/health`.

## Configuration

All configuration is via environment variables — see `.env.example`. The
`EMBEDDING_PROVIDER` / `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` must match how
the index was created by `reindex`.

## Connecting MCP clients

**Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "contextmcp": {
      "url": "http://localhost:8787/mcp"
    }
  }
}
```

## Shared search logic

The result-shaping and formatting helpers (`SearchResult`, `clampLimit`,
`mapMatchToSearchResult`, `roundScore`, `formatResults`) are defined once in the
canonical module `packages/template/src/search-core.ts` and consumed by both the
Cloudflare worker and this server so the two can't silently drift.

Because this server's Docker build context is the `server/` directory alone, it
can't import across the package boundary — instead it ships a **vendored copy**
at `src/shared/search-core.ts`. To change shared logic:

1. Edit the canonical `packages/template/src/search-core.ts`.
2. Run `npm run sync:shared` to regenerate the vendored copy.

A drift test (`src/shared/search-core.drift.test.ts`) fails if the copy is stale,
so CI catches an un-synced change.
