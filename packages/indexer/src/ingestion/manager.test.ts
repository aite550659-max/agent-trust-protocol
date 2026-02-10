import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IngestionManager } from './manager.js';

// Mock BackfillService
vi.mock('./backfill.js', () => ({
  BackfillService: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({ messagesProcessed: 0, lastTimestamp: undefined }),
    stop: vi.fn(),
    isRunning: false,
  })),
}));

// Mock TopicSubscriber
vi.mock('./subscriber.js', () => ({
  TopicSubscriber: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    isRunning: false,
  })),
}));

// Mock db
vi.mock('../db/client.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => []),
        })),
      })),
    })),
  },
}));

vi.mock('../db/schema.js', () => ({
  syncCursors: { topicId: 'topic_id' },
}));

vi.mock('../config.js', () => ({
  config: {
    hederaNetwork: 'testnet',
    backfillPageDelayMs: 0,
    mirrorNodeUrl: 'https://testnet.mirrornode.hedera.com',
  },
}));

describe('IngestionManager', () => {
  let mockLogger: Console;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
      debug: vi.fn(),
    } as unknown as Console;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start and track topics', async () => {
    const manager = new IngestionManager(mockLogger);

    await manager.start(['0.0.12345', '0.0.67890']);

    expect(manager.isRunning).toBe(true);
    const status = manager.getStatus();
    expect(Object.keys(status)).toHaveLength(2);
    expect(status['0.0.12345']).toBeDefined();
    expect(status['0.0.67890']).toBeDefined();

    await manager.stop();
  });

  it('should stop all topics', async () => {
    const manager = new IngestionManager(mockLogger);
    await manager.start(['0.0.12345']);

    await manager.stop();

    expect(manager.isRunning).toBe(false);
    expect(Object.keys(manager.getStatus())).toHaveLength(0);
  });

  it('should report status per topic', async () => {
    const manager = new IngestionManager(mockLogger);
    await manager.start(['0.0.12345']);

    const status = manager.getStatus();
    expect(status['0.0.12345']).toHaveProperty('status');
    expect(status['0.0.12345']).toHaveProperty('reconnectAttempts');
    expect(status['0.0.12345'].reconnectAttempts).toBe(0);

    await manager.stop();
  });

  it('should handle empty topic list', async () => {
    const manager = new IngestionManager(mockLogger);
    await manager.start([]);

    expect(manager.isRunning).toBe(true);
    expect(Object.keys(manager.getStatus())).toHaveLength(0);

    await manager.stop();
  });
});
