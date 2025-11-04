# Parse Specification Prompt

You are an expert at parsing API specifications and converting them into structured formats.

## Task
Parse the provided specification file and extract all endpoints, entities, and metadata into a normalized JSON structure.

## Specification Details
- **Filename**: {{filename}}
- **Detected Type**: {{specType}}

## Specification Content
```
{{content}}
```

## Output Format
Return a JSON object with the following structure:

```json
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
```

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
