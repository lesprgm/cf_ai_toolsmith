export interface SkillDefinition {
    name: string;
    description: string;
    operationId: string;
    method: string;
    path: string;
    parameters: Array<{
        name: string;
        in: 'path' | 'query' | 'header' | 'body';
        required: boolean;
        type: string;
        description?: string;
    }>;
    requestBody?: {
        required: boolean;
        contentType: string;
        schema: any;
    };
    baseUrl: string;
}

export interface RegisteredAPI {
    apiName: string;
    baseUrl: string;
    encryptedApiKey: string;
    skills: SkillDefinition[];
    registeredAt: string;
    metadata?: {
        title?: string;
        version?: string;
        description?: string;
    };
}

export interface UserSkills {
    userId: string;
    apis: Record<string, RegisteredAPI>;
}

export class SkillRegistry {
    private state: DurableObjectState;

    constructor(state: DurableObjectState) {
        this.state = state;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-User-ID',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        try {
            // Get user ID from header
            const userId = request.headers.get('X-User-ID') || 'default';

            if (url.pathname === '/register' && request.method === 'POST') {
                return await this.handleRegister(userId, request, corsHeaders);
            }

            if (url.pathname === '/list' && request.method === 'GET') {
                return await this.handleList(userId, corsHeaders);
            }

            if (url.pathname === '/delete' && request.method === 'POST') {
                return await this.handleDelete(userId, request, corsHeaders);
            }

            if (url.pathname === '/get-skills' && request.method === 'POST') {
                return await this.handleGetSkills(userId, request, corsHeaders);
            }

            return new Response('Not found', { status: 404, headers: corsHeaders });
        } catch (error) {
            return new Response(
                JSON.stringify({ error: (error as Error).message }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }
    }

    private async handleRegister(
        userId: string,
        request: Request,
        corsHeaders: Record<string, string>
    ): Promise<Response> {
        const body = await request.json<any>();
        const { apiName, skills, baseUrl, encryptedApiKey, metadata } = body;

        if (!apiName || !skills || !baseUrl) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields: apiName, skills, baseUrl' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Get or create user skills
        const userSkillsKey = `user:${userId}`;
        let userSkills: UserSkills = await this.state.storage.get<UserSkills>(userSkillsKey) || {
            userId,
            apis: {}
        };

        // Register the API
        userSkills.apis[apiName] = {
            apiName,
            baseUrl,
            encryptedApiKey: encryptedApiKey || '',
            skills: skills as SkillDefinition[],
            registeredAt: new Date().toISOString(),
            metadata
        };

        await this.state.storage.put(userSkillsKey, userSkills);

        return new Response(
            JSON.stringify({
                success: true,
                message: `Registered ${skills.length} skills for ${apiName}`,
                skillCount: skills.length,
                skillNames: skills.map((s: SkillDefinition) => s.name)
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    private async handleList(
        userId: string,
        corsHeaders: Record<string, string>
    ): Promise<Response> {
        const userSkillsKey = `user:${userId}`;
        const userSkills: UserSkills | undefined = await this.state.storage.get<UserSkills>(userSkillsKey);

        if (!userSkills) {
            return new Response(
                JSON.stringify({ apis: [] }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const apiList = Object.values(userSkills.apis).map(api => ({
            apiName: api.apiName,
            baseUrl: api.baseUrl,
            skillCount: api.skills.length,
            skillNames: api.skills.map(s => s.name),
            registeredAt: api.registeredAt,
            metadata: api.metadata
        }));

        return new Response(
            JSON.stringify({ apis: apiList }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    private async handleDelete(
        userId: string,
        request: Request,
        corsHeaders: Record<string, string>
    ): Promise<Response> {
        const body = await request.json<any>();
        const { apiName } = body;

        if (!apiName) {
            return new Response(
                JSON.stringify({ error: 'Missing apiName' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const userSkillsKey = `user:${userId}`;
        const userSkills: UserSkills | undefined = await this.state.storage.get<UserSkills>(userSkillsKey);

        if (!userSkills || !userSkills.apis[apiName]) {
            return new Response(
                JSON.stringify({ error: `API ${apiName} not found` }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        delete userSkills.apis[apiName];
        await this.state.storage.put(userSkillsKey, userSkills);

        return new Response(
            JSON.stringify({ success: true, message: `Deleted ${apiName}` }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    private async handleGetSkills(
        userId: string,
        request: Request,
        corsHeaders: Record<string, string>
    ): Promise<Response> {
        const body = await request.json<any>();
        const { apiName } = body;

        const userSkillsKey = `user:${userId}`;
        const userSkills: UserSkills | undefined = await this.state.storage.get<UserSkills>(userSkillsKey);

        if (!userSkills) {
            return new Response(
                JSON.stringify({ skills: [], apis: {} }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        if (apiName) {
            const api = userSkills.apis[apiName];
            if (!api) {
                return new Response(
                    JSON.stringify({ error: `API ${apiName} not found` }),
                    { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            return new Response(
                JSON.stringify({
                    skills: api.skills,
                    apiKey: api.encryptedApiKey,
                    baseUrl: api.baseUrl
                }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({ apis: userSkills.apis }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
}
