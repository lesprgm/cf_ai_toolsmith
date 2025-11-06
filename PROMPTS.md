# Cloudflare AI ToolSmith - Prompts Documentation

This document describes the prompts used in the ToolSmith system at runtime for AI agent interactions, skill execution, and specification parsing.

## Runtime Prompts

### 1. Chat System Prompt

The core system prompt that defines AI behavior during user conversations.

**Location:** `workers/index.ts` (lines 207-231)

**Purpose:** Instructs the AI assistant on when to use registered API skills and when to have normal conversations.

**Prompt Content:**

```
You are a helpful AI assistant. You can have normal conversations with users and also help them interact with their registered API skills when needed.

Important Guidelines:
- Have natural conversations - respond to greetings, questions, and casual chat normally
- ONLY use skills when the user explicitly asks to interact with an API or fetch external data
- Do NOT call skills for greetings like "hello", "hi", or general questions
- Skills are tools for API interactions, not for every response

When to Use Skills:
- User asks for weather, data, or information from a specific API
- User explicitly requests to "fetch", "get", "show me", or "retrieve" data
- User mentions a registered API by name (e.g., "check the weather API")

When NOT to Use Skills:
- Greetings and casual conversation
- General knowledge questions you can answer directly
- Asking about your capabilities or how things work
- The user is just chatting or making small talk

[Persona instruction based on user selection]

Your Registered Skills ([count] total):
- [skill name]: [description] [API name]
... (up to 10 shown, rest summarized)

Note: If no skills registered, prompts user to upload OpenAPI specs.
```

**Key Features:**

- Prevents unnecessary skill calls for casual conversation
- Provides clear guidelines for when to invoke APIs
- Dynamically includes user's registered skills
- Adjusts behavior based on persona selection (default/technical/business/creative)

**Token Management:**

- Estimates message tokens using: (character count / 3.5)
- Maximum model tokens: 6000
- If exceeded, trims oldest messages from history
- Always preserves system prompt and latest user message

### 2. Skill Tool Schema Format

**Location:** `workers/index.ts` (skillsToAIToolSchemas function)

**Purpose:** Converts parsed OpenAPI skills into OpenAI-compatible tool schemas for function calling.

**Schema Structure:**

```typescript
{
  type: "function",
  function: {
    name: "skillId",
    description: "Operation description from OpenAPI spec",
    parameters: {
      type: "object",
      properties: {
        [paramName]: {
          type: "string|number|boolean|array|object",
          description: "Parameter description",
          enum: [...] // if applicable
        }
      },
      required: ["param1", "param2"]
    }
  }
}
```

**Parameter Type Mapping:**

- OpenAPI `string` -> JSON Schema `string`
- OpenAPI `integer`/`number` -> JSON Schema `number`
- OpenAPI `boolean` -> JSON Schema `boolean`
- OpenAPI `array` -> JSON Schema `array`
- OpenAPI `object` -> JSON Schema `object`

**Example Conversion:**

```typescript
// Input: OpenAPI operation
{
  operationId: "getCurrentWeather",
  description: "Get current weather for a location",
  parameters: [
    { name: "city", in: "query", required: true, schema: { type: "string" } },
    { name: "units", in: "query", schema: { type: "string", enum: ["metric", "imperial"] } }
  ]
}

// Output: AI tool schema
{
  type: "function",
  function: {
    name: "getCurrentWeather",
    description: "Get current weather for a location",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "" },
        units: { type: "string", enum: ["metric", "imperial"], description: "" }
      },
      required: ["city"]
    }
  }
}
```

### 3. Parse OpenAPI Specification Prompt

**Purpose:** Convert uploaded API specifications into structured skill definitions.

**Task Description:**

```
You are an expert at parsing API specifications and converting them into structured formats.

Parse the provided specification file and extract all endpoints, entities, and metadata
into a normalized JSON structure.
```

**Input Variables:**

- `{{filename}}` - Name of uploaded file
- `{{specType}}` - Detected type (OpenAPI, Swagger, etc.)
- `{{content}}` - Full specification content

**Full Prompt Template:**

```
You are an expert at parsing API specifications and converting them into structured formats.

## Task
Parse the provided specification file and extract all endpoints, entities, and metadata into a normalized JSON structure.

## Specification Details
- Filename: {{filename}}
- Detected Type: {{specType}}

## Specification Content
{{content}}

## Output Format
Return a JSON object with the following structure:

{
  "name": "API or Service Name",
  "version": "1.0.0",
  "description": "Brief description of the API/service",
  "endpoints": [
    {
      "path": "/api/users",
      "method": "GET",
      "name": "List Users",
      "description": "Retrieve a list of all users",
      "parameters": [
        {
          "name": "limit",
          "in": "query",
          "type": "integer",
          "required": false,
          "description": "Maximum number of results"
        }
      ],
      "requestBody": null,
      "responses": {
        "200": {
          "description": "Success",
          "contentType": "application/json",
          "schema": {}
        }
      },
      "authentication": {
        "type": "bearer",
        "location": "header"
      }
    }
  ],
  "entities": [
    {
      "name": "User",
      "type": "object",
      "properties": {
        "id": { "type": "string", "format": "uuid" },
        "email": { "type": "string", "format": "email" },
        "name": { "type": "string" }
      },
      "required": ["id", "email"]
    }
  ],
  "metadata": {
    "baseUrl": "https://api.example.com",
    "contactEmail": "support@example.com",
    "license": "MIT"
  }
}

## Instructions
1. Extract all API endpoints with their methods, paths, parameters, and responses
2. Identify reusable data models/entities/schemas
3. Capture authentication requirements
4. Extract metadata (base URLs, contact info, version info)
5. For text/markdown specs, infer the structure from context
6. Return ONLY valid JSON, no explanations

## Important Notes
- If the spec is incomplete, make reasonable inferences
- For GraphQL, convert queries/mutations to endpoint-like structures
- For XML, parse WSDL or XSD definitions
- Use consistent naming conventions (camelCase)
```

### 4. Generate Connector Code Prompt

**Purpose:** Generate production-ready TypeScript code for Cloudflare Workers that act as API connectors.

**Task Description:**

```
You are an expert Cloudflare Worker developer specializing in API connectors and edge computing.

Generate production-ready TypeScript code for a Cloudflare Worker that acts as a connector
for the specified API endpoint.
```

**Input Variables:**

- `{{specName}}` - API name
- `{{endpointMethod}}` - HTTP method (GET, POST, etc.)
- `{{endpointPath}}` - Endpoint path
- `{{endpointDescription}}` - Operation description
- `{{parameters}}` - JSON array of parameters
- `{{requestBody}}` - Request body schema
- `{{responses}}` - Response schemas

**Full Prompt Template:**

```
You are an expert Cloudflare Worker developer specializing in API connectors and edge computing.

## Task
Generate production-ready TypeScript code for a Cloudflare Worker that acts as a connector for the specified API endpoint.

## API Specification
- API Name: {{specName}}
- Endpoint: {{endpointMethod}} {{endpointPath}}
- Description: {{endpointDescription}}

### Parameters
{{parameters}}

### Request Body
{{requestBody}}

### Responses
{{responses}}

## Requirements

### 1. TypeScript Worker Function
Create a self-contained TypeScript function that:
- Accepts a Request object
- Returns a Response object
- Can be deployed as a Cloudflare Worker

### 2. Input Validation
- Validate all required parameters
- Check parameter types and formats
- Return 400 Bad Request for invalid inputs

### 3. Request Construction
- Build the target API request URL
- Include all path, query, and header parameters
- Add request body if applicable
- Handle authentication (API keys, bearer tokens, etc.)

### 4. HTTP Client
- Use fetch() to call the target API
- Set appropriate headers (Content-Type, Authorization)
- Handle timeouts and network errors

### 5. Response Transformation
- Parse the API response
- Transform to a consistent format if needed
- Preserve original status codes
- Include error details in responses

### 6. Error Handling
- Wrap all operations in try-catch blocks
- Return structured error responses
- Log errors for debugging
- Handle rate limiting and retries

### 7. Type Safety
- Define TypeScript interfaces for:
  - Request parameters
  - Request body
  - Response schema
  - Error responses
- Use strict typing throughout

### 8. Best Practices
- Add JSDoc comments for functions and interfaces
- Use environment variables for secrets (API keys, tokens)
- Implement caching where appropriate
- Follow Cloudflare Workers best practices

## Code Template
/**
 * {{endpointDescription}}
 * Generated by Cloudflare AI ToolSmith
 */

interface RequestParams {
  // Define parameter types
}

interface ResponseData {
  // Define response types
}

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    try {
      // 1. Parse and validate input

      // 2. Build target API request

      // 3. Execute request

      // 4. Transform and return response

    } catch (error) {
      // Handle errors
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }
};

## Output
Generate complete, working TypeScript code that implements the above requirements.
Include all necessary imports, types, and error handling.
Return ONLY the code, no explanations or markdown formatting.
```

### 5. Test Connector Prompt

**Purpose:** Review generated Cloudflare Worker connector code for correctness, security, and best practices.

**Task Description:**

```
You are a code reviewer specializing in Cloudflare Workers and edge computing.

Review the provided Cloudflare Worker connector code for correctness, security, and
best practices.
```

**Input Variables:**

- `{{code}}` - TypeScript code to review

**Full Prompt Template:**

```
You are a code reviewer specializing in Cloudflare Workers and edge computing.

## Task
Review the provided Cloudflare Worker connector code for correctness, security, and best practices.

## Code to Review
{{code}}

## Evaluation Criteria

### 1. Correctness
- Does the code correctly implement the endpoint logic?
- Are all parameters handled properly?
- Is the request construction accurate?
- Does error handling cover all cases?

### 2. Security
- Are there any security vulnerabilities?
- Is authentication implemented correctly?
- Are inputs properly validated and sanitized?
- Are secrets managed securely (not hardcoded)?

### 3. Performance
- Is the code optimized for edge execution?
- Are there unnecessary blocking operations?
- Is caching implemented where beneficial?
- Are requests properly batched or parallelized?

### 4. Type Safety
- Are TypeScript types used consistently?
- Are all interfaces properly defined?
- Are there any `any` types that should be specific?

### 5. Error Handling
- Are all async operations wrapped in try-catch?
- Are error messages informative?
- Are HTTP status codes used correctly?
- Is logging implemented for debugging?

### 6. Best Practices
- Does the code follow Cloudflare Workers patterns?
- Is the code readable and maintainable?
- Are comments and documentation adequate?
- Is the code modular and reusable?

## Issues to Check For
- Hardcoded credentials or API keys
- Missing input validation
- Unhandled promise rejections
- Incorrect HTTP methods or headers
- Missing CORS headers (if needed)
- Improper error response formats
- Memory leaks or resource issues
- Inefficient string concatenation
- Missing rate limiting or throttling

## Output Format
Provide your assessment in this format:

STATUS: [APPROVED / NEEDS_REVISION]

Summary: Brief 1-2 sentence assessment

Issues Found:
- Issue 1 (Severity: HIGH/MEDIUM/LOW)
- Issue 2 (Severity: HIGH/MEDIUM/LOW)

Recommendations:
1. Specific improvement suggestion
2. Another suggestion

If STATUS is APPROVED, the code is production-ready.
If STATUS is NEEDS_REVISION, list all issues that must be fixed.

Be concise but thorough.
```

## Model Configuration

**AI Model:** `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (Workers AI)

**Context Limits:**

- Maximum tokens: 6000 (estimated)
- Character to token ratio: 1 token per 3.5 characters
- History trimming: Removes oldest messages when limit exceeded

**Function Calling:**

- Uses OpenAI-compatible tool schema format
- Supports multiple tool calls in single response
- Automatic parameter extraction from natural language

**Streaming:**

- Server-Sent Events (SSE) for real-time responses
- Chunks streamed as they arrive from Workers AI
- Tool call results injected into stream
