import { parse } from 'yaml';

export function parseYaml(text: string): any | null {
  try {
    return parse(text);
  } catch {
    return null;
  }
}
