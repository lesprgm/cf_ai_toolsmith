# Cloudflare AI ToolSmith - Prompt Engineering Guide

This document explains the AI prompts used throughout ToolSmith and provides guidance for customizing them.

---

## Overview

ToolSmith uses **Cloudflare Workers AI** (Llama 3.3 70B) for three main tasks:

1. **Parse Specification** - Extract structured data from any spec format
2. **Generate Connector Code** - Create TypeScript Worker code for endpoints
3. **Verify Code Quality** - Review generated code for correctness and security

All prompts are stored as Markdown files in `/prompts/` and loaded dynamically.

---

## Prompt 1: Parse Specification

**File**: `prompts/parse_spec.md`

### Purpose
Convert any specification format (OpenAPI, GraphQL, JSON Schema, XML, Markdown, plain text) into a normalized `CommonSpecModel` JSON structure.

### Key Sections

#### Input Variables
- `{{filename}}` - Original filename
- `{{specType}}` - Detected format (openapi, graphql, jsonschema, xml, markdown, text)
- `{{content}}` - Full specification content (truncated to 8000 chars)

#### Output Structure
The prompt explicitly defines the expected JSON schema:

```json
{
  "name": "API Name",
  "version": "1.0.0", 
  "description": "Description",
  "endpoints": [...],
  "entities": [...],
  "metadata": {...}
}
```

#### Instructions
- Extract all endpoints with methods, paths, parameters
- Identify reusable data models/schemas
- Capture authentication requirements
- For incomplete specs, make reasonable inferences
- Return **only** valid JSON

### How It's Used

In `workers/parser.ts`:

```typescript
const parsePrompt = await loadPrompt('parse_spec', {
  content: specContent,
  filename: 'api.yaml',
  specType: 'openapi'
});

const aiResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
  messages: [
    { role: 'system', content: 'You are an expert at parsing API specifications...' },
    { role: 'user', content: parsePrompt }
  ]
});
```

### Customization Tips

**To support new spec formats:**
```markdown
## Special Handling for [Format Name]
- Look for [specific patterns]
- Extract [specific fields]
- Convert [format-specific concepts] to endpoints
```

**To improve entity extraction:**
```markdown
## Entity Extraction Priority
1. Look for schema definitions first
2. Infer from request/response bodies
3. Extract from examples
4. Create minimal entities if unclear
```

**To handle ambiguous specs:**
```markdown
## Fallback Strategy
If the specification is unclear:
- Create a single endpoint with path "/"
- Infer parameters from context
- Use generic entity types
- Set authentication to "none"
```

---

## Prompt 2: Generate Connector Code

**File**: `prompts/generate_code.md`

### Purpose
Generate production-ready TypeScript code for a Cloudflare Worker that acts as a connector for a specific API endpoint.

### Key Sections

#### Input Variables
- `{{specName}}` - API name
- `{{endpointMethod}}` - HTTP method (GET, POST, etc.)
- `{{endpointPath}}` - URL path
- `{{endpointDescription}}` - What the endpoint does
- `{{parameters}}` - JSON array of parameters
- `{{requestBody}}` - Request body schema
- `{{responses}}` - Response definitions

#### Code Requirements

The prompt specifies 8 detailed requirements:

1. **TypeScript Worker Function** - Accept Request, return Response
2. **Input Validation** - Validate all parameters and types
3. **Request Construction** - Build target API URL with auth
4. **HTTP Client** - Use fetch() with proper headers
5. **Response Transformation** - Parse and normalize responses
6. **Error Handling** - Try-catch blocks, structured errors
7. **Type Safety** - Define interfaces for all data structures
8. **Best Practices** - JSDoc comments, environment variables, caching

#### Code Template

Provides a skeleton structure:

```typescript
interface RequestParams { }
interface ResponseData { }

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    try {
      // Implementation
    } catch (error) {
      // Error handling
    }
  }
};
```

### How It's Used

In `workers/generator.ts`:

```typescript
const codePrompt = await loadPrompt('generate_code', {
  specName: 'Pet Store API',
  endpointMethod: 'GET',
  endpointPath: '/pets',
  endpointDescription: 'List all pets',
  parameters: JSON.stringify([...]),
  requestBody: JSON.stringify({...}),
  responses: JSON.stringify({...})
});

const aiResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
  messages: [
    { role: 'system', content: 'You are an expert Cloudflare Worker developer...' },
    { role: 'user', content: codePrompt }
  ]
});
```

### Customization Tips

**To add authentication patterns:**
```markdown
### 9. Authentication Handling
- For API key auth: Use `env.API_KEY` from environment
- For OAuth: Include token refresh logic
- For JWT: Verify signatures before forwarding
- For Basic Auth: Base64 encode credentials
```

**To enforce code style:**
```markdown
## Code Style Requirements
- Use async/await (no .then())
- Prefer const over let
- Use destructuring for parameters
- Add TODO comments for incomplete sections
- Keep functions under 50 lines
```

**To add observability:**
```markdown
### 10. Logging & Monitoring
- Log all requests with timestamps
- Track response times
- Report errors to analytics
- Use structured logging (JSON format)
```

---

## ✅ Prompt 3: Test Connector

**File**: `prompts/test_connector.md`

### Purpose
AI-powered code review to assess correctness, security, and best practices of generated Worker connectors.

### Key Sections

#### Input Variables
- `{{code}}` - The generated TypeScript code to review

#### Evaluation Criteria

The prompt defines 6 review dimensions:

1. **Correctness** - Logic, parameters, requests, errors
2. **Security** - Vulnerabilities, auth, validation, secrets
3. **Performance** - Edge optimization, blocking ops, caching
4. **Type Safety** - Consistent types, interfaces, no `any`
5. **Error Handling** - Try-catch, messages, status codes, logging
6. **Best Practices** - Workers patterns, readability, docs

#### Issues to Check

Specific anti-patterns:
- Hardcoded credentials
- Missing validation
- Unhandled promises
- Incorrect HTTP methods
- Missing CORS
- Memory leaks
- Inefficient operations

#### Output Format

Structured assessment:

```
STATUS: [APPROVED / NEEDS_REVISION]

Summary: Brief assessment

Issues Found:
- Issue (Severity: HIGH/MEDIUM/LOW)

Recommendations:
1. Specific suggestion
```

### How It's Used

In `workers/verifier.ts`:

```typescript
const reviewPrompt = `
Review this Cloudflare Worker code...

Code:
\`\`\`typescript
${code}
\`\`\`

Provide assessment...
`;

const aiResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
  messages: [
    { role: 'system', content: 'You are a code reviewer specializing in Cloudflare Workers...' },
    { role: 'user', content: reviewPrompt }
  ]
});

const approved = aiResponse.response.includes('APPROVED');
```

### Customization Tips

**To add security rules:**
```markdown
## Critical Security Checks
- NEVER use eval() or Function()
- ALWAYS validate user inputs against allowlists
- CHECK for SQL injection patterns
- VERIFY all external URLs are HTTPS
- ENSURE rate limiting on all endpoints
```

**To enforce performance:**
```markdown
## Performance Requirements
- Request processing MUST complete in < 50ms
- NO blocking operations in hot paths
- USE streaming for large responses
- CACHE frequently accessed data
- BATCH multiple API calls when possible
```

**To customize severity levels:**
```markdown
## Severity Definitions
- **CRITICAL**: Security vulnerability, data loss risk
- **HIGH**: Functional bug, performance issue
- **MEDIUM**: Code smell, maintainability concern
- **LOW**: Style inconsistency, missing comment
```

---

## Advanced Prompt Engineering

### Multi-Turn Conversations

For complex specs, use iterative refinement:

```typescript
const messages = [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: initialPrompt },
  { role: 'assistant', content: firstResponse },
  { role: 'user', content: 'Please add error handling for rate limits' }
];
```

### Few-Shot Learning

Provide examples in prompts:

```markdown
## Example 1: Simple GET Endpoint

Input:
```json
{ "path": "/users", "method": "GET" }
```

Output:
```typescript
export default {
  async fetch(request: Request): Promise<Response> {
    const response = await fetch('https://api.example.com/users');
    return response;
  }
};
```

## Example 2: POST with Validation
...
```

### Chain-of-Thought Prompting

Encourage step-by-step reasoning:

```markdown
## Code Generation Process

Think through these steps:

1. **Analyze the endpoint** - What does it do?
2. **Identify inputs** - What parameters are required?
3. **Plan validation** - How to validate each input?
4. **Design request** - How to construct the API call?
5. **Handle responses** - What can go wrong?
6. **Write the code** - Implement all of the above

Now generate the code:
```

### Temperature & Sampling

For code generation, use lower temperature for deterministic output:

```typescript
await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
  messages: [...],
  temperature: 0.2,  // More deterministic
  max_tokens: 2048
});
```

For creative naming or descriptions, use higher temperature:

```typescript
await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
  messages: [...],
  temperature: 0.8,  // More creative
  max_tokens: 256
});
```

---

## Prompt Version Control

Track prompt changes to improve results:

```markdown
# parse_spec.md

<!-- Version: 1.2.0 -->
<!-- Changes:
- Added GraphQL query/mutation handling
- Improved entity extraction from nested schemas
- Added fallback for text-only specs
-->
```

Store prompt versions in KV:

```typescript
await env.CACHE.put(
  `prompt:parse_spec:v1.2.0`,
  parseSpecPrompt,
  { expirationTtl: 86400 }
);
```

---

## Prompt Performance Metrics

Track success rates:

```typescript
interface PromptMetrics {
  promptName: string;
  version: string;
  successRate: number;
  avgTokensUsed: number;
  avgLatencyMs: number;
  commonFailures: string[];
}
```

Log to D1:

```sql
CREATE TABLE prompt_metrics (
  id INTEGER PRIMARY KEY,
  prompt_name TEXT,
  version TEXT,
  success INTEGER,
  tokens_used INTEGER,
  latency_ms INTEGER,
  error_message TEXT,
  timestamp TEXT
);
```

---

## Testing Prompts

Create test cases for each prompt:

```typescript
// Test parse_spec.md
const testCases = [
  {
    input: 'openapi: 3.0.0\npaths:\n  /test:\n    get:...',
    expected: { endpoints: [{ path: '/test', method: 'GET' }] }
  },
  {
    input: 'type Query { users: [User] }',
    expected: { endpoints: [{ path: '/users', method: 'POST' }] }
  }
];

for (const test of testCases) {
  const result = await parseSpec(env, test.input, 'test.yaml', sessionStub);
  assert(result.endpoints.length > 0);
}
```

---

## Resources

- [Cloudflare Workers AI Docs](https://developers.cloudflare.com/workers-ai/)
- [Llama 3.3 Model Card](https://ai.meta.com/llama/)
- [Prompt Engineering Guide](https://www.promptingguide.ai/)
- [OpenAI Prompt Best Practices](https://platform.openai.com/docs/guides/prompt-engineering)

---

## Tips for Writing Better Prompts

1. **Be Specific**: Define exact output formats, not "generate code"
2. **Provide Context**: Include relevant background and constraints
3. **Use Examples**: Show input-output pairs for complex tasks
4. **Set Constraints**: Specify limits (length, complexity, style)
5. **Handle Edge Cases**: Explicitly address error scenarios
6. **Iterate**: Test prompts and refine based on results
7. **Version Control**: Track changes and performance over time
8. **A/B Test**: Compare prompt variations to find best performers

---

**Happy Prompt Engineering!**
