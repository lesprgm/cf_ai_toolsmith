import { describe, it, expect } from 'vitest';
import { safeJsonParse } from '../../workers/utils/json';

describe('JSON Utils - safeJsonParse', () => {
  it('should parse valid JSON successfully', () => {
    const jsonString = '{"name": "test", "value": 42}';
    const result = safeJsonParse<{ name: string; value: number }>(jsonString);

    expect(result).not.toBeNull();
    expect(result).toEqual({ name: 'test', value: 42 });
  });

  it('should handle invalid JSON gracefully', () => {
    const invalidJson = '{ invalid json }';
    const result = safeJsonParse(invalidJson);

    expect(result).toBeNull();
  });

  it('should parse arrays', () => {
    const jsonString = '[1, 2, 3, 4, 5]';
    const result = safeJsonParse<number[]>(jsonString);

    expect(result).not.toBeNull();
    expect(result).toEqual([1, 2, 3, 4, 5]);
    expect(Array.isArray(result)).toBe(true);
  });

  it('should parse nested objects', () => {
    const jsonString = '{"user": {"name": "Alice", "age": 30}, "active": true}';
    const result = safeJsonParse<{
      user: { name: string; age: number };
      active: boolean;
    }>(jsonString);

    expect(result).not.toBeNull();
    if (result) {
      expect(result.user.name).toBe('Alice');
      expect(result.user.age).toBe(30);
      expect(result.active).toBe(true);
    }
  });

  it('should handle null value in JSON', () => {
    const jsonString = 'null';
    const result = safeJsonParse(jsonString);

    expect(result).toBeNull();
  });

  it('should handle boolean values', () => {
    const trueResult = safeJsonParse<boolean>('true');
    const falseResult = safeJsonParse<boolean>('false');

    expect(trueResult).toBe(true);
    expect(falseResult).toBe(false);
  });

  it('should handle numbers', () => {
    const result = safeJsonParse<number>('123.45');

    expect(result).toBe(123.45);
  });

  it('should handle empty strings as invalid JSON', () => {
    const result = safeJsonParse('');

    expect(result).toBeNull();
  });

  it('should handle malformed JSON strings', () => {
    const testCases = [
      '{incomplete',
      '{"key": undefined}',
      "{'single': 'quotes'}",
      '{trailing: comma,}',
    ];

    testCases.forEach(testCase => {
      const result = safeJsonParse(testCase);
      expect(result).toBeNull();
    });
  });

  it('should preserve type information with generic', () => {
    interface User {
      id: number;
      name: string;
      email: string;
    }

    const jsonString = '{"id": 1, "name": "John", "email": "john@example.com"}';
    const result = safeJsonParse<User>(jsonString);

    expect(result).not.toBeNull();
    if (result) {
      expect(result.id).toBe(1);
      expect(result.name).toBe('John');
      expect(result.email).toBe('john@example.com');
    }
  });
});
