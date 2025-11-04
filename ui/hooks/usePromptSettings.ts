import { useEffect, useState } from 'react';

export interface PromptSettings {
  parsePrompt: string;
  parseSystemPrompt: string;
  generatePrompt: string;
  generateSystemPrompt: string;
}

const STORAGE_KEY = 'toolsmith-prompts';

export const defaultPromptSettings: PromptSettings = {
  parsePrompt: '',
  parseSystemPrompt: '',
  generatePrompt: '',
  generateSystemPrompt: '',
};

export function usePromptSettings() {
  const [promptSettings, setPromptSettings] = useState<PromptSettings>(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as Partial<PromptSettings>;
          return { ...defaultPromptSettings, ...parsed };
        } catch (error) {
          console.warn('Failed to parse stored prompt settings', error);
        }
      }
    }
    return defaultPromptSettings;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(promptSettings));
    }
  }, [promptSettings]);

  const updatePromptSettings = (updates: Partial<PromptSettings>) => {
    setPromptSettings((previous) => ({ ...previous, ...updates }));
  };

  const restorePromptSettings = () => {
    setPromptSettings(defaultPromptSettings);
  };

  return { promptSettings, updatePromptSettings, restorePromptSettings };
}
