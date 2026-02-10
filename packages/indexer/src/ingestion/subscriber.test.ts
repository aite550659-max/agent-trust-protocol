import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TopicSubscriber } from './subscriber.js';

// Mock db
vi.mock('../db/client.js', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(),
        onConflictDoUpdate: vi.fn(() => ({})),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
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
  hcsMessages: {},
  agents: { agentId: 'agent_id' },
  agentEvents: {},
  rentals: { rentalId: 'rental_id' },
  agentComms: {},
}));

vi.mock('../config.js', () => ({
  config: {
    hederaNetwork: 'testnet',
    backfillPageDelayMs: 0,
    mirrorNodeUrl: 'https://testnet.mirrornode.hedera.com',
  },
}));

describe('TopicSubscriber', () => {
  let mockClient: any;
  let mockLogger: Console;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      close: vi.fn(),
    };
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
      debug: vi.fn(),
    } as unknown as Console;
  });

  it('should initialize with correct options', () => {
    const subscriber = new TopicSubscriber({
      topicId: '0.0.12345',
      logger: mockLogger,
      client: mockClient,
    });

    expect(subscriber.isRunning).toBe(false);
  });

  it('should initialize with start timestamp', () => {
    const subscriber = new TopicSubscriber({
      topicId: '0.0.12345',
      startTimestamp: '1234567890.000000001',
      logger: mockLogger,
      client: mockClient,
    });

    expect(subscriber.isRunning).toBe(false);
  });

  it('should set isRunning to false after stop', () => {
    const subscriber = new TopicSubscriber({
      topicId: '0.0.12345',
      logger: mockLogger,
      client: mockClient,
    });

    subscriber.stop();
    expect(subscriber.isRunning).toBe(false);
  });

  it('should accept error and disconnect callbacks', () => {
    const onError = vi.fn();
    const onDisconnect = vi.fn();

    const subscriber = new TopicSubscriber({
      topicId: '0.0.12345',
      onError,
      onDisconnect,
      logger: mockLogger,
      client: mockClient,
    });

    expect(subscriber.isRunning).toBe(false);
  });
});
