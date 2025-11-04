import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useSession } from './SessionContext';
import type {
  ConnectorEntry,
  GenerateResult,
  InstallResult,
  ParseResult,
  StepKey,
  StepState,
  VerifyResult,
} from '../types/workflow';

const API_BASE =
  (import.meta.env.VITE_WORKER_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';

interface ParseOptions {
  customParsePrompt?: string;
  customParseSystemPrompt?: string;
}

interface GenerateOptions {
  customPrompt?: string;
  customSystemPrompt?: string;
}

interface WorkflowContextValue {
  parseResult: ParseResult | null;
  connectors: Map<string, ConnectorEntry>;
  isUploading: boolean;
  stepStatus: Record<StepKey, StepState>;
  parseSpec: (file: File, options?: ParseOptions) => Promise<ParseResult>;
  generateConnector: (endpointId: string, options?: GenerateOptions) => Promise<ConnectorEntry>;
  verifyConnector: (endpointId: string) => Promise<VerifyResult>;
  installConnector: (endpointId: string) => Promise<InstallResult>;
  updateSteps: (updates: Partial<Record<StepKey, StepState>>) => void;
  resetWorkflow: () => void;
}

const initialStepState: Record<StepKey, StepState> = {
  parse: 'pending',
  generate: 'pending',
  verify: 'pending',
  install: 'pending',
  deploy: 'pending',
};

const WorkflowContext = createContext<WorkflowContextValue | undefined>(undefined);

export function WorkflowProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const { sessionId } = useSession();
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [connectors, setConnectors] = useState<Map<string, ConnectorEntry>>(new Map());
  const [isUploading, setIsUploading] = useState(false);
  const [stepStatus, setStepStatus] = useState<Record<StepKey, StepState>>(initialStepState);

  const updateStepStatus = useCallback((updates: Partial<Record<StepKey, StepState>>) => {
    setStepStatus((previous) => ({ ...previous, ...updates }));
  }, []);

  const resetWorkflow = useCallback(() => {
    setParseResult(null);
    setConnectors(new Map());
    setStepStatus(initialStepState);
  }, []);

  const parseSpec = useCallback(
    async (file: File, options?: ParseOptions) => {
      setIsUploading(true);
      updateStepStatus({
        parse: 'in-progress',
        generate: 'pending',
        verify: 'pending',
        install: 'pending',
        deploy: 'pending',
      });

      try {
        const formData = new FormData();
        formData.append('file', file);
        if (options?.customParsePrompt) {
          formData.append('customParsePrompt', options.customParsePrompt);
        }
        if (options?.customParseSystemPrompt) {
          formData.append('customParseSystemPrompt', options.customParseSystemPrompt);
        }

        const response = await fetch(`${API_BASE}/api/parse`, {
          method: 'POST',
          headers: { 'X-Session-ID': sessionId },
          body: formData,
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const data = (await response.json()) as ParseResult;
        setParseResult(data);
        setConnectors(new Map());
        updateStepStatus({ parse: 'completed' });
        return data;
      } catch (error) {
        updateStepStatus({ parse: 'pending' });
        throw error;
      } finally {
        setIsUploading(false);
      }
    },
    [sessionId, updateStepStatus],
  );

  const generateConnector = useCallback(
    async (endpointId: string, options?: GenerateOptions) => {
      if (!parseResult) {
        throw new Error('Parse a specification before generating connectors.');
      }

      updateStepStatus({ generate: 'in-progress' });

      try {
        const response = await fetch(`${API_BASE}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-ID': sessionId,
          },
          body: JSON.stringify({
            csm: parseResult.csm,
            endpointId,
            customPrompt: options?.customPrompt,
            customSystemPrompt: options?.customSystemPrompt,
          }),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const data = (await response.json()) as GenerateResult;
        const existing = connectors.get(endpointId);
        const updatedEntry: ConnectorEntry = {
          ...existing,
          ...data,
          verified: existing?.verified,
          installed: existing?.installed,
        };
        setConnectors((previous) => {
          const next = new Map(previous);
          next.set(endpointId, updatedEntry);
          return next;
        });
        updateStepStatus({ generate: 'completed', verify: 'pending', install: 'pending' });
        return updatedEntry;
      } catch (error) {
        updateStepStatus({ generate: 'pending' });
        throw error;
      }
    },
    [connectors, parseResult, sessionId, updateStepStatus],
  );

  const verifyConnector = useCallback(
    async (endpointId: string) => {
      const connector = connectors.get(endpointId);
      if (!connector) {
        throw new Error('Connector not found for verification.');
      }

      updateStepStatus({ verify: 'in-progress' });

      try {
        const response = await fetch(`${API_BASE}/api/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-ID': sessionId,
          },
          body: JSON.stringify({ code: connector.code }),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const data = (await response.json()) as VerifyResult;

        if (data.success) {
          setConnectors((previous) => {
            const next = new Map(previous);
            const current = next.get(endpointId);
            if (current) {
              next.set(endpointId, { ...current, verified: true });
            }
            return next;
          });
          updateStepStatus({ verify: 'completed', install: 'pending' });
        } else {
          updateStepStatus({ verify: 'pending' });
        }

        return data;
      } catch (error) {
        updateStepStatus({ verify: 'pending' });
        throw error;
      }
    },
    [connectors, sessionId, updateStepStatus],
  );

  const installConnector = useCallback(
    async (endpointId: string) => {
      const connector = connectors.get(endpointId);
      if (!connector || !connector.verified) {
        throw new Error('Verify connector before installing.');
      }

      updateStepStatus({ install: 'in-progress' });

      try {
        const response = await fetch(`${API_BASE}/api/install`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-ID': sessionId,
          },
          body: JSON.stringify({
            toolName: endpointId,
            code: connector.code,
            exports: connector.exports,
            metadata: connector.metadata,
          }),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const data = (await response.json()) as InstallResult;

        if (data.success) {
          setConnectors((previous) => {
            const next = new Map(previous);
            const current = next.get(endpointId);
            if (current) {
              next.set(endpointId, {
                ...current,
                installed: true,
                installedToolId: data.toolId,
              });
            }
            return next;
          });
          updateStepStatus({ install: 'completed', deploy: 'pending' });
        } else {
          updateStepStatus({ install: 'pending' });
        }

        return data;
      } catch (error) {
        updateStepStatus({ install: 'pending' });
        throw error;
      }
    },
    [connectors, sessionId, updateStepStatus],
  );

  const value = useMemo<WorkflowContextValue>(
    () => ({
      parseResult,
      connectors,
      isUploading,
      stepStatus,
      parseSpec,
      generateConnector,
      verifyConnector,
      installConnector,
      updateSteps: updateStepStatus,
      resetWorkflow,
    }),
    [
      connectors,
      generateConnector,
      installConnector,
      isUploading,
      parseResult,
      parseSpec,
      resetWorkflow,
      stepStatus,
      updateStepStatus,
      verifyConnector,
    ],
  );

  return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>;
}

export function useWorkflow(): WorkflowContextValue {
  const context = useContext(WorkflowContext);
  if (!context) {
    throw new Error('useWorkflow must be used within a WorkflowProvider');
  }
  return context;
}
