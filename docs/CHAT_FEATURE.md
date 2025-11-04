# AI Chat with Tool Execution

## Overview

The Chat interface allows you to interact with an AI assistant that can **automatically discover and execute your installed API connectors**. This completes the workflow:

```
Upload Spec → Generate Connector → Verify → Install → **Chat & Execute**
```

## How It Works

### 1. **Upload & Install Connectors**
First, use the main Workflow page to:
- Upload an API spec (OpenAPI, GraphQL, etc.)
- Generate TypeScript connectors
- Verify the code
- Install to the ToolRegistry

### 2. **Chat with AI**
Navigate to the **Chat** page where you can:
- See all your installed tools in the sidebar
- Ask the AI to use your tools
- Get automatic tool execution with results

### 3. **Two Modes of Tool Execution**

#### **Automatic Mode** (Default)
When "Auto-execute tools" is enabled:
- The AI analyzes your message
- Decides if a tool should be called
- Extracts parameters from your message
- Executes the tool automatically
- Shows you the results

**Example conversations:**
```
You: "Test the weather API for London"
AI: [Automatically calls weather-api with city: "London"]
    Returns: Current weather data for London...

You: "Get the microsoft/vscode repository info"
AI: [Automatically calls github-api.getRepository]
    Returns: Repository details...
```

#### **Manual Mode**
You can also explicitly invoke tools:
```
You: "run github-api using getRepository with {"owner": "microsoft", "repo": "vscode"}"
AI: [Executes github-api.getRepository with those params]
```

Or via API:
```bash
curl -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Get repo info",
    "toolName": "github-api",
    "exportName": "getRepository",
    "params": {"owner": "microsoft", "repo": "vscode"}
  }'
```

## Architecture

### Backend (workers/index.ts)

#### Enhanced Chat Endpoint (`POST /api/chat`)

```typescript
{
  "message": "Test the weather API",
  "autoExecuteTools": true,  // Enable AI tool selection
  "persona": "tutor"         // Optional: tutor, deployment, troubleshooter
}
```

**Response:**
```typescript
{
  "response": "I tested the weather API...",
  "toolExecutions": [
    {
      "tool": "weather-api",
      "export": "getCurrentWeather",
      "success": true,
      "result": { /* API response */ }
    }
  ]
}
```

#### New Helper Functions

**`decideToolUsage()`**
- Uses AI (Llama 3.3) to analyze user message
- Matches message to available tools
- Extracts parameters automatically
- Returns structured tool invocation request

**`executeToolCall()`**
- Safely executes tool via ToolRegistry
- Handles errors gracefully
- Returns structured results

### Frontend (ui/pages/chat.tsx)

#### Features
- ✅ **Real-time chat** with message history
- ✅ **Sidebar** showing installed tools with descriptions
- ✅ **Auto-execute toggle** for automatic tool calling
- ✅ **Tool execution indicators** with success/error states
- ✅ **JSON result display** in chat bubbles
- ✅ **Mobile responsive** design
- ✅ **Keyboard shortcuts** (Enter to send, Shift+Enter for newline)

## API Examples

### 1. Simple Chat (No Tools)
```bash
curl -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, what can you help me with?"}'
```

### 2. Auto-Execute Tool
```bash
curl -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Get weather for Paris",
    "autoExecuteTools": true
  }'
```

### 3. Manual Tool Execution
```bash
curl -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Show me the result",
    "toolName": "weather-api",
    "exportName": "getWeather",
    "params": {"city": "Paris"}
  }'
```

### 4. With Session
```bash
curl -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: my-session-123" \
  -d '{"message": "Continue our conversation"}'
```

## Tool Selection Intelligence

The AI uses **Llama 3.3 70B** to intelligently decide:

1. **Should a tool be called?**
   - Analyzes user intent
   - Checks if any installed tool matches the request

2. **Which tool?**
   - Matches based on tool names, descriptions, endpoints
   - Understands synonyms (e.g., "test", "call", "run", "invoke")

3. **Which export function?**
   - Selects appropriate method from tool's exports
   - Falls back to first export if not specified

4. **What parameters?**
   - Extracts structured data from natural language
   - Converts "Get weather for Paris" → `{"city": "Paris"}`

## Example Workflows

### Workflow 1: Weather API
```
1. Upload OpenWeatherMap OpenAPI spec
2. Generate connector → weather-api
3. Install to registry
4. Navigate to Chat
5. Say: "What's the weather in Tokyo?"
6. AI automatically calls weather-api with city: "Tokyo"
7. Results displayed in chat
```

### Workflow 2: GitHub API
```
1. Upload GitHub OpenAPI spec
2. Generate connectors for repo operations
3. Install as "github-api"
4. In Chat: "Show me the vscode repository"
5. AI extracts owner="microsoft", repo="vscode"
6. Calls github-api.getRepository
7. Displays repo details
```

### Workflow 3: Multiple Tools
```
1. Install both weather-api and github-api
2. In Chat: "Get weather for Seattle and also show me the node repository"
3. AI can execute multiple tools in sequence
4. Both results shown in chat
```

## Session Management

Chat conversations are persisted in **SessionState Durable Objects**:

- Each session has a unique ID (from `X-Session-ID` header)
- Message history is maintained
- Default session: `chat-session`
- Custom sessions: Pass header with your ID

## Personas

Customize AI behavior with personas:

```typescript
{
  "message": "How do I deploy this?",
  "persona": "deployment"  // Options: tutor, deployment, troubleshooter
}
```

- **tutor**: Patient explanations with key takeaways
- **deployment**: Focus on publishing and environment management
- **troubleshooter**: Diagnose issues and suggest fixes

## Error Handling

Tool execution errors are gracefully handled:

```json
{
  "tool": "github-api",
  "export": "getRepository",
  "success": false,
  "error": "Rate limit exceeded"
}
```

The AI will:
- Acknowledge the error
- Suggest alternatives
- Provide troubleshooting steps

## Best Practices

### For Tool Creators
1. **Add metadata** when installing tools:
   ```typescript
   {
     toolName: "my-api",
     code: "...",
     exports: ["fetch", "create"],
     metadata: {
       description: "Fetch and create resources from My API",
       endpoint: "https://api.example.com"
     }
   }
   ```

2. **Use clear export names**: `getUser` instead of `fetch1`

3. **Document parameters**: Add JSDoc comments to exported functions

### For Users
1. **Be specific**: "Get weather for London" is better than "weather"

2. **Use natural language**: The AI understands intent
   - ✅ "Test the GitHub connector with microsoft/vscode"
   - ✅ "Show me weather in Tokyo"
   - ✅ "Call the user API"

3. **Check the sidebar**: See what tools are available before asking

4. **Toggle auto-execute**: Turn off if you want AI to just explain without running tools

## Future Enhancements

Planned features:
- [ ] Multi-tool orchestration (chain multiple tool calls)
- [ ] Tool call confirmation prompts
- [ ] Parameter validation before execution
- [ ] Saved conversation templates
- [ ] Export chat history
- [ ] Tool usage analytics
- [ ] Rate limiting per tool
- [ ] Tool permissions/scopes

## Troubleshooting

### Tools not executing?
- Check "Auto-execute tools" is enabled
- Verify tools are installed (check sidebar)
- Try manual invocation with explicit tool name

### AI not understanding?
- Be more specific with tool/function names
- Use explicit parameters: `with {"city": "Paris"}`
- Check tool metadata has good descriptions

### Empty sidebar?
- No tools installed yet
- Go to Workflow page and install connectors
- Click refresh (↻) button in sidebar

## API Reference

See [API Documentation](../README.md) for complete endpoint details.

---

**You now have a complete AI agent system that can autonomously use your API connectors!** 🎉
