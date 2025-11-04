import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Logger, getGlobalLogger, resetGlobalLogger } from '../../workers/utils/log';

describe('Logger', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger();
  });

  it('should create log entries with correct structure', () => {
    logger.info('Test message');
    const logs = logger.dump();

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: 'info',
      message: 'Test message'
    });
    expect(logs[0].timestamp).toBeDefined();
    expect(typeof logs[0].timestamp).toBe('number');
  });

  it('should support multiple log levels', () => {
    logger.info('Info message');
    logger.warn('Warning message');
    logger.error('Error message');

    const logs = logger.dump();

    expect(logs).toHaveLength(3);
    expect(logs[0].level).toBe('info');
    expect(logs[1].level).toBe('warn');
    expect(logs[2].level).toBe('error');
  });

  it('should accumulate logs in order', () => {
    logger.info('First message');
    logger.warn('Second message');
    logger.error('Third message');

    const logs = logger.dump();

    expect(logs).toHaveLength(3);
    expect(logs[0].message).toBe('First message');
    expect(logs[1].message).toBe('Second message');
    expect(logs[2].message).toBe('Third message');
  });

  it('should return empty array when no logs exist', () => {
    const logs = logger.dump();
    expect(logs).toEqual([]);
  });

  it('should maintain log order with timestamps', () => {
    logger.info('First');
    logger.info('Second');
    logger.info('Third');

    const logs = logger.dump();

    expect(logs[0].message).toBe('First');
    expect(logs[1].message).toBe('Second');
    expect(logs[2].message).toBe('Third');
    // Timestamps should be in ascending order
    expect(logs[0].timestamp).toBeLessThanOrEqual(logs[1].timestamp);
    expect(logs[1].timestamp).toBeLessThanOrEqual(logs[2].timestamp);
  });

  it('should clear all logs', () => {
    logger.info('Test 1');
    logger.warn('Test 2');
    logger.error('Test 3');

    expect(logger.dump()).toHaveLength(3);

    logger.clear();
    const logs = logger.dump();
    expect(logs).toEqual([]);
  });

  it('should return copy of logs, not mutable reference', () => {
    logger.info('Original message');
    const logs1 = logger.dump();
    logs1.push({ level: 'error', message: 'Injected', timestamp: Date.now() });

    const logs2 = logger.dump();
    expect(logs2).toHaveLength(1);
    expect(logs2[0].message).toBe('Original message');
  });
});

describe('Global Logger', () => {
  afterEach(() => {
    resetGlobalLogger();
  });

  it('should provide singleton instance', () => {
    const logger1 = getGlobalLogger();
    const logger2 = getGlobalLogger();

    expect(logger1).toBe(logger2);
  });

  it('should persist logs across multiple accesses', () => {
    const logger1 = getGlobalLogger();
    logger1.info('Test message');

    const logger2 = getGlobalLogger();
    const logs = logger2.dump();

    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe('Test message');
  });

  it('should reset to new instance', () => {
    const logger1 = getGlobalLogger();
    logger1.info('Message before reset');

    resetGlobalLogger();

    const logger2 = getGlobalLogger();
    const logs = logger2.dump();

    expect(logs).toEqual([]);
    expect(logger1).not.toBe(logger2);
  });
});
