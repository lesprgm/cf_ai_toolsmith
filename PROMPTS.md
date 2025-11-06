# PROMPTS.md

This document summarizes how AI tools were used during the development of this project for ToolSmith. AI assistance (Codex and Claude Sonnet 4.5 via GitHub Copilot) was used for scaffolding, debugging, and documentation. All architectural and implementation decisions were reviewed and finalized by me(the developer).

## Prompts Used

Below are representative examples of prompts used during development. They illustrate how AI assistance was applied without showing any secrets or full transcripts.

### 1) Durable Objects configuration

> How do I configure two Durable Objects (SkillRegistry and SessionState) in `wrangler.toml` for a Cloudflare Workers project? Explain the `[[durable_objects.bindings]]` fields and show a minimal template.

### 2) Parsing OpenAPI specs into skills

> Write a function that parses an OpenAPI 3.0 spec and extracts operationId, method, path, parameters (path/query/body), and request body schema, returning an array of skill objects suitable for function-calling.

### 3) Streaming AI responses with SSE

> How do I stream responses from Workers AI to the frontend using Server‑Sent Events when the AI returns a `ReadableStream`? Show the correct `text/event-stream` response format and a `TransformStream` wrapper.

### 4) Resolving `$ref` parameters

> In an OpenAPI 3.0 schema, how do I dereference `#/components/schemas/...` (including nested `$ref`s) to recover the concrete JSON Schema types for parameters and request bodies?

### 5) Converting skills to Workers AI tool schema

> Convert parsed skill definitions into the Workers AI tool schema (function name/description and JSON Schema parameters). Handle required fields, enums, arrays, and nested objects.

### 6) Executing skills via `fetch()`

> Write an `executeSkill` helper that inserts path params, appends query params, serializes the body, sets headers, and performs `fetch()` with robust error handling and timeouts.

### 7) Vitest config for Workers + DO

> Configure Vitest to test Cloudflare Workers with Durable Objects. Include `@cloudflare/vitest-pool-workers`, environment bindings, and an example of mocking external `fetch` calls.

### 8) Deployment notes

> Provide deployment steps with `wrangler`, including secrets, environment variables, DO migrations, and common troubleshooting tips for Workers AI and custom domains.

## Tools

- **ChatGPT (Codex)** — Documentation drafts, debugging around tool schemas and JSON Schema nuances.
- **Claude 4.5 Sonnet (Copilot)** — Code scaffolding, architecture validation, and implementation tips and inline completions for boilerplate and test scaffolding.

## Human Oversight

AI output served as scaffolding and references only. I implemented and validated core logic, architecture (multi‑tenancy, schema dereferencing, execution flow), error handling, tests, and deployment configuration.
