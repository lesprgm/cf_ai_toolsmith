# Cloudflare AI ToolSmith

Transform API specifications into production-ready Cloudflare Workers connectors in minutes.

## Overview

Cloudflare AI ToolSmith is a full-stack application built on the Cloudflare developer platform. Upload a spec (OpenAPI, GraphQL, JSON Schema, XML, or even plain text) and the system parses it, asks Workers AI to generate connector code, verifies the output, and stores approved connectors in a Durable Object registry. The web UI exposes the entire pipeline with real-time logging and a chat interface that can invoke installed tools.

Key technologies:

- Cloudflare Workers (TypeScript runtime)
- Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
- Durable Objects (`ToolRegistry`, `SessionState`)
- React 18 + Vite + Tailwind CSS
- Vitest test suite (unit, integration, and e2e)

Key features:

- Template gallery with one-click installation for Petstore, GitHub, and Stripe connectors.
- Step tracker (Parse → Generate → Verify → Install → Deploy) that updates automatically.
- Connector detail drawer with metadata, code preview, and an integrated HTTP testing sandbox.
- Advanced prompt settings to override parsing and generation instructions per session.
- Role-based chat personas (general, tutor, deployment assistant, troubleshooter).
- Usages analytics card tracking recent parse/generate/install/test events.

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
├── wrangler.toml                 # Worker + Durable Object config
├── vite.config.ts                # Shared Vite config (re-exports UI config)
├── README.md                     # This document
└── APP_OVERVIEW.md               # Extended technical overview
```

## Local Development

Prerequisites: Node.js 18+, npm, Wrangler CLI, Cloudflare account with Workers AI enabled.

Install dependencies at the repository root and inside `ui/`:

```bash
npm install
(cd ui && npm install)
```

Start the worker and UI in separate terminals:

```bash
npm run dev         # Wrangler dev server on http://localhost:8787
npm run dev:ui      # Vite dev server on http://localhost:3000 (proxies /api/*)
```

Upload a spec at `http://localhost:3000` to exercise the full pipeline. The right-hand console card streams log output from `/api/stream`, and the chat card sends messages to `/api/chat`.

## UI Walkthrough

- **Template Gallery** – Install sample connectors (Petstore, GitHub, Stripe) with one click to explore the workflow without uploading a spec.
- **Workflow Progress Tracker** – The tracker highlights Parse → Generate → Verify → Install → Deploy as each phase completes.
- **Parsed Specification Panel** – Inspect endpoints discovered by the parser and trigger generation per endpoint.
- **Generated Connectors Panel** – Review code, copy it, open the detail drawer, verify, and install connectors.
- **Connector Detail Drawer** – Displays endpoint metadata, connector code, sample requests/responses, and an HTTP sandbox to test real APIs.
- **Console Log & Usage Analytics** – Real-time SSE log stream plus an activity summary (parse/generate/install/test counts).
- **Chat with Personas** – Switch between general, tutor, deployment, or troubleshooting personas when talking to the ToolSmith assistant.
- **Advanced Prompt Settings** – Override parsing and generation prompts/system messages and persist them per browser.

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

## Configuration

- **Workers AI**: Bound in `wrangler.toml` as `AI`. Model ID is hard-coded in `parser.ts`, `generator.ts`, and `index.ts`.
- **Durable Objects**: `ToolRegistry` for installed connectors, `SessionState` for chat history. Both are declared in `wrangler.toml`.
- **Environment variable**: `VITE_WORKER_BASE_URL` (optional) tells the React app to target a remote worker.
- **Template connectors**: `GET /api/templates` lists bundled connectors; `POST /api/templates/install` installs one into the registry.
- **Testing sandbox**: `POST /api/test-connector` executes ad-hoc HTTP requests from the worker runtime.
- **Analytics**: `GET /api/analytics` returns recent pipeline events for the Usage Analytics card.

## Testing

Vitest covers unit, integration, and end-to-end scenarios:

```bash
npm test               # Full suite
npm run test:unit      # Unit tests
npm run test:integration
npm run test:e2e
```

The new tests include parser regressions (path parameters, security overrides), ToolRegistry behaviour, chat integration, and the workflow e2e path.

## Limitations

- Local Durable Object invocation of generated connectors is disabled; the DO returns a 501 message. Deploy the worker to execute connectors.
- Workers AI calls incur usage even during local development.
- SSE log streaming is best-effort; the console displays cached messages until the next poll.

## Roadmap Ideas

- Execute connectors locally using a sandboxed runtime.
- Provide history/export of connectors from the UI.
- Add multi-language generation or client SDK output.
- Expand AI prompts for richer documentation and tests.

## License

Distributed under the MIT License. See `LICENSE` for details.
