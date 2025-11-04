import type { Env } from './bindings';
import { getGlobalLogger } from './utils/log';

export interface InstallResult {
  success: boolean;
  toolId: string;
  error?: string;
  logs: { level: 'info' | 'warn' | 'error'; message: string }[];
}


export async function installTool(
  toolName: string,
  code: string,
  exports: string[],
  env: Env,
  metadata?: Record<string, any>
): Promise<InstallResult> {
  const logger = getGlobalLogger();
  logger.info(`Installing tool: ${toolName}`);

  try {
    const toolId = env.TOOL_REGISTRY.idFromName('global');
    const stub = env.TOOL_REGISTRY.get(toolId);

    const response = await stub.fetch('http://internal/install', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: toolName,
        code,
        exports,
        installedAt: new Date().toISOString(),
        metadata,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ToolRegistry responded with ${response.status}: ${errorText}`);
    }

    const result = await response.json<any>();

    logger.info(`Tool installed successfully: ${result.toolId || toolName}`);

    return {
      success: true,
      toolId: result.toolId || toolName,
      logs: logger.dump(),
    };
  } catch (error) {
    logger.error(`Installation failed: ${(error as Error).message}`);
    return {
      success: false,
      toolId: '',
      error: (error as Error).message,
      logs: logger.dump(),
    };
  }
}

export async function listTools(env: Env): Promise<{ tools: any[]; error?: string }> {
  try {
    const toolId = env.TOOL_REGISTRY.idFromName('global');
    const stub = env.TOOL_REGISTRY.get(toolId);

    const response = await stub.fetch('http://internal/list', {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`ToolRegistry responded with ${response.status}`);
    }

    const result = await response.json<any>();
    return { tools: result.tools || [] };
  } catch (error) {
    return { tools: [], error: (error as Error).message };
  }
}
