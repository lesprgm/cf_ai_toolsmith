import { getGlobalLogger } from './utils/log';

export interface VerifyResult {
  success: boolean;
  error?: string;
  smokeTestResults?: {
    exportsFound: string[];
    callable: boolean;
  };
  logs: { level: 'info' | 'warn' | 'error'; message: string }[];
}

export async function verifyCode(code: string): Promise<VerifyResult> {
  const logger = getGlobalLogger();
  logger.info('Starting code verification');

  try {
    const analysis = analyzeExports(code);
    const exportsFound = analysis.exports;

    logger.info(`Found ${exportsFound.length} exports: ${exportsFound.join(', ')}`);

    if (exportsFound.length === 0) {
      logger.warn('No exports found in generated code');
      return {
        success: false,
        error: 'No exports found',
        logs: logger.dump(),
      };
    }

    // Check if exports are callable
    if (!analysis.callable) {
      logger.warn('Exports detected but none appear callable (function/async function).');
    }

    return {
      success: true,
      smokeTestResults: {
        exportsFound,
        callable: analysis.callable,
      },
      logs: logger.dump(),
    };
  } catch (error) {
    logger.error(`Verification failed: ${(error as Error).message}`);
    return {
      success: false,
      error: (error as Error).message,
      logs: logger.dump(),
    };
  }
}

interface ExportAnalysis {
  exports: string[];
  callable: boolean;
}

function analyzeExports(code: string): ExportAnalysis {
  const exports = new Set<string>();
  let callable = false;

  const source = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  const functionExportRegex = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g;
  let match: RegExpExecArray | null;
  while ((match = functionExportRegex.exec(source))) {
    exports.add(match[1]);
    callable = true;
  }

  const defaultFunctionRegex = /export\s+default\s+(?:async\s+)?function(?:\s+([A-Za-z0-9_]+))?/g;
  while ((match = defaultFunctionRegex.exec(source))) {
    exports.add('default');
    if (match[1]) exports.add(match[1]);
    callable = true;
  }

  const constFunctionRegex =
    /export\s+(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>/g;
  while ((match = constFunctionRegex.exec(source))) {
    exports.add(match[1]);
    callable = true;
  }

  const exportListRegex = /export\s*\{([^}]+)\}/g;
  while ((match = exportListRegex.exec(source))) {
    const parts = match[1]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    for (const part of parts) {
      const [, original, alias] = part.match(/^([A-Za-z0-9_]+)(?:\s+as\s+([A-Za-z0-9_]+))?$/i) || [];
      const name = alias || original;
      if (name) {
        exports.add(name);
      }
    }
  }

  return {
    exports: Array.from(exports),
    callable,
  };
}
