# Cloudflare AI ToolSmith

Transform API specifications into production-ready Cloudflare Workers connectors in minutes.

## Overview

Cloudflare AI ToolSmith is a full-stack application built on the Cloudflare developer platform. Upload a spec (OpenAPI, GraphQL, JSON Schema, XML, or even plain text) and the system parses it, asks Workers AI to generate connector code, verifies the output, and stores approved connectors in a Durable Object registry. The web UI exposes the entire pipeline with real-time logging and a chat interface that can invoke installed tools.

## Architecture

```
User upload → /api/parse → Common Spec Model (CSM)
            │
            └─> /api/generate → AI-produced connector
                          │
                          └─> /api/verify → static export analysis
                                       │
                                       └─> /api/install → ToolRegistry Durable Object
                                                     │
                                                     └─> /api/chat invokes installed tools
```

- `workers/index.ts` routes all API requests, streams logs via SSE, and coordinates AI calls.
- `workers/parser.ts` converts OpenAPI/GraphQL/text into a unified Common Spec Model.
- `workers/generator.ts` prompts Workers AI to emit ES module connectors.
- `workers/verifier.ts` inspects the generated source to ensure export names/functions exist.
- `workers/durable_objects/ToolRegistry.ts` stores approved connectors and exposes listing/invoke routes (invocation disabled during local development).
- `workers/durable_objects/SessionState.ts` keeps the chat transcript for each session.
- `ui/pages/index.tsx` provides the full workflow UI with upload, generation, verification, installation, live logs, and chat.

## Repository Layout

```
cf_ai_toolsmith/
├── workers/                      # Worker source, utilities, DOs
├── ui/                           # React application
├── tests/                        # Vitest suites (unit, integration, e2e)
├── prompts/                      # LLM prompt templates
├── workflows/                    # Workflow pipeline configuration
├── docs/                         # Feature write-ups & quick references
├── examples/                     # Sample specifications (e.g., petstore.yaml)
├── wrangler.toml                 # Worker + Durable Object config
├── vite.config.ts                # Shared Vite config (re-exports UI config)
└── README.md                     # This document

## Getting Started

### Prerequisites

- Node.js 18 or newer
- npm (or pnpm/yarn if you prefer)
- Cloudflare account with Workers, Durable Objects, R2, D1, and Workers AI enabled
- Wrangler CLI authenticated to your Cloudflare account (`wrangler login`)

### Install Dependencies

```bash
git clone https://github.com/<your-org>/cf_ai_toolsmith.git
cd cf_ai_toolsmith
npm install
(cd ui && npm install)
```

### Configure Cloudflare Resources

1. **KV Namespace**
   ```bash
   wrangler kv:namespace create CACHE
   ```
   Add the generated ID to `wrangler.toml`:
   ```toml
   [[kv_namespaces]]
   binding = "CACHE"
   id = "<your-kv-id>"
   ```

2. **D1 Database**
   ```bash
   wrangler d1 create toolsmith_db
   ```
   Update `wrangler.toml` with the `database_id`, then create the tables:
   ```bash
   wrangler d1 execute toolsmith_db --command "
   CREATE TABLE IF NOT EXISTS connectors (
     id TEXT PRIMARY KEY,
     spec_id TEXT NOT NULL,
     endpoint_id TEXT NOT NULL,
     name TEXT NOT NULL,
     code TEXT NOT NULL,
     verified INTEGER DEFAULT 0,
     test_results TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT
   );

   CREATE TABLE IF NOT EXISTS tools (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     description TEXT,
     connector_id TEXT NOT NULL,
     version TEXT DEFAULT '1.0.0',
     installed INTEGER DEFAULT 0,
     endpoint TEXT,
     metadata TEXT,
     created_at TEXT NOT NULL
   );
   "
   ```

3. **R2 Bucket**
   ```bash
   wrangler r2 bucket create toolsmith-specs
   ```
   Reference the bucket in `wrangler.toml`:
   ```toml
   [[r2_buckets]]
   binding = "SPECS_BUCKET"
   bucket_name = "toolsmith-specs"
   ```

4. **Durable Objects & Workers AI**
   - `ToolRegistry`, `SessionState`, and `AnalyticsTracker` classes are already declared in `wrangler.toml`.
   - No extra configuration is required for Workers AI beyond enabling the feature in your account.

### Local Development

Start the worker and UI in separate terminals:

```bash
npm run dev         # Wrangler dev server on http://localhost:8787
npm run dev:ui      # Vite dev server on http://localhost:3000 (proxies /api/*)
```

Visit `http://localhost:3000` to upload a specification. The right-hand console streams server-sent log events from `/api/stream`, and the chat panel talks to `/api/chat`.

## UI Walkthrough

## Deployment

1. Deploy the worker:
   ```bash
   wrangler deploy
   ```
   Wrangler provisions Durable Objects using the `new_sqlite_classes` migration and publishes to `https://cf-ai-specforge.<your-account>.workers.dev`.
2. Set the UI base URL so the frontend can reach the deployed worker:
   - Create a `.env` during local builds or configure Cloudflare Pages with `VITE_WORKER_BASE_URL=https://cf-ai-specforge.<your-account>.workers.dev`.
3. Build and deploy the UI (e.g., to Pages):
   ```bash
   (cd ui && npm run build)
```
Serve `ui/dist` or connect the repository to Cloudflare Pages.

## Testing

Vitest covers unit, integration, and end-to-end scenarios:

```bash
npm test               # Full suite
npm run test:unit      # Unit tests
npm run test:integration
npm run test:e2e
```

The new tests include parser regressions (path parameters, security overrides), ToolRegistry behaviour, chat integration, and the workflow e2e path.

## License

Distributed under the MIT License. See `LICENSE` for details.
