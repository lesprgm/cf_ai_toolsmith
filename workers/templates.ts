export interface TemplateConnector {
  id: string;
  name: string;
  description: string;
  category: string;
  endpoint: {
    method: string;
    path: string;
    summary: string;
    query?: Record<string, { description?: string; required?: boolean }>;
    headers?: Record<string, { description?: string; required?: boolean }>;
    auth?: 'none' | 'apikey' | 'bearer';
    sampleRequest?: Record<string, any>;
    sampleResponse?: Record<string, any>;
  };
  code: string;
  exports: string[];
  metadata: Record<string, any>;
}

export const TEMPLATE_CONNECTORS: TemplateConnector[] = [
  {
    id: 'template-petstore-list-pets',
    name: 'Petstore: List Pets',
    description: 'Fetch the list of pets from the Petstore sample API.',
    category: 'Petstore',
    endpoint: {
      method: 'GET',
      path: '/pets',
      summary: 'List pets',
      query: {
        limit: {
          description: 'How many pets to return at one time (max 100)',
          required: false,
        },
      },
      auth: 'none',
      sampleRequest: {
        baseUrl: 'https://petstore3.swagger.io/api/v3',
        limit: 10,
      },
      sampleResponse: {
        id: 1,
        name: 'doggie',
        status: 'available',
      },
    },
    code: `export async function listPets(params = {}, options = {}) {
  const { baseUrl = 'https://petstore3.swagger.io/api/v3', limit } = params;
  const url = new URL('/pets', baseUrl);
  if (limit !== undefined) {
    url.searchParams.set('limit', String(limit));
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json', ...(options.headers || {}) },
  });
  if (!response.ok) {
    throw new Error('Petstore API request failed: ' + response.status + ' ' + response.statusText);
  }
  return response.json();
}
`.trim(),
    exports: ['listPets'],
    metadata: {
      baseUrl: 'https://petstore3.swagger.io/api/v3',
      tags: ['sample', 'petstore'],
    },
  },
  {
    id: 'template-github-list-repos',
    name: 'GitHub: List Public Repositories',
    description: 'List repositories for a GitHub user using the GitHub REST API.',
    category: 'GitHub',
    endpoint: {
      method: 'GET',
      path: '/users/{username}/repos',
      summary: 'List repositories for user',
      query: {
        type: { description: 'Visibility of the repositories', required: false },
      },
      headers: {
        Authorization: {
          description: 'Bearer token (optional for public data, required for higher limits)',
          required: false,
        },
      },
      auth: 'bearer',
      sampleRequest: {
        baseUrl: 'https://api.github.com',
        username: 'cloudflare',
      },
      sampleResponse: {
        id: 1296269,
        name: 'Hello-World',
        full_name: 'octocat/Hello-World',
      },
    },
    code: `export async function listUserRepos(params = {}, options = {}) {
  const { baseUrl = 'https://api.github.com', username, type } = params;
  if (!username) {
    throw new Error('username is required');
  }
  const url = new URL('/users/' + username + '/repos', baseUrl);
  if (type) {
    url.searchParams.set('type', type);
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    ...(options.headers || {}),
  };
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers,
  });
  if (!response.ok) {
    throw new Error('GitHub API request failed: ' + response.status + ' ' + response.statusText);
  }
  return response.json();
}
`.trim(),
    exports: ['listUserRepos'],
    metadata: {
      baseUrl: 'https://api.github.com',
      tags: ['github', 'rest'],
    },
  },
  {
    id: 'template-stripe-list-customers',
    name: 'Stripe: List Customers',
    description: 'List Stripe customers using the Stripe REST API (secret key required).',
    category: 'Stripe',
    endpoint: {
      method: 'GET',
      path: '/v1/customers',
      summary: 'List customers',
      query: {
        limit: { description: 'Number of results to return (max 100)', required: false },
      },
      headers: {
        Authorization: {
          description: 'Bearer {STRIPE_SECRET_KEY}',
          required: true,
        },
      },
      auth: 'bearer',
      sampleRequest: {
        baseUrl: 'https://api.stripe.com',
        limit: 5,
      },
      sampleResponse: {
        object: 'list',
        data: [],
      },
    },
    code: `export async function listStripeCustomers(params = {}, options = {}) {
  const { baseUrl = 'https://api.stripe.com', limit } = params;
  const url = new URL('/v1/customers', baseUrl);
  if (limit) {
    url.searchParams.set('limit', String(limit));
  }
  const headers = {
    Authorization: options.apiKey ? 'Bearer ' + options.apiKey : options.headers?.Authorization,
    'Content-Type': 'application/x-www-form-urlencoded',
    ...(options.headers || {}),
  };
  if (!headers.Authorization) {
    throw new Error('Stripe secret key is required in options.apiKey or headers.Authorization');
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers,
  });
  if (!response.ok) {
    throw new Error('Stripe API request failed: ' + response.status + ' ' + response.statusText);
  }
  return response.json();
}
`.trim(),
    exports: ['listStripeCustomers'],
    metadata: {
      baseUrl: 'https://api.stripe.com',
      tags: ['stripe', 'payments'],
    },
  },
];
