import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackfillService } from './backfill.js';

// Mock db
const mockInsert = vi.fn(() => ({
  values: vi.fn(() => ({
    onConflictDoNothing: vi.fn(),
    onConflictDoUpdate: vi.fn(() => ({})),
  })),
}));

const mockSelect = vi.fn(() => ({
  from: vi.fn(() => ({
    where: vi.fn(() => ({
      limit: vi.fn(() => []),
    })),
  })),
}));

const mockUpdate = vi.fn(() => ({
  set: vi.fn(() => ({
    where: vi.fn(),
  })),
}));

vi.mock('../db/client.js', () => ({
  db: {
    insert: (...args: any[]) => mockInsert(...args),
    select: (...args: any[]) => mockSelect(...args),
    update: (...args: any[]) => mockUpdate(...args),
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

describe('BackfillService', () => {
  let mockMirrorClient: any;
  let mockLogger: Console;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
      debug: vi.fn(),
    } as unknown as Console;
  });

  it('should process messages from mirror client', async () => {
    const testMessage = {
      consensus_timestamp: '1234567890.000000001',
      topic_id: '0.0.12345',
      message: Buffer.from(JSON.stringify({ type: 'AGENT_INITIALIZATION', version: '1.0', agentId: 'test', agentName: 'Test', platform: 'test', timestamp: 123 })).toString('base64'),
      payer_account_id: '0.0.99',
      sequence_number: 1,
      running_hash: 'abc',
      running_hash_version: 3,
    };

    mockMirrorClient = {
      fetchMessages: vi.fn().mockResolvedValue({
        messages: [testMessage],
        links: {},
      }),
      fetchNextPage: vi.fn(),
    };

    const backfill = new BackfillService({
      topicId: '0.0.12345',
      mirrorClient: mockMirrorClient,
      logger: mockLogger,
      pageDelayMs: 0,
    });

    const result = await backfill.run();

    expect(result.messagesProcessed).toBe(1);
    expect(result.lastTimestamp).toBe('1234567890.000000001');
    expect(mockMirrorClient.fetchMessages).toHaveBeenCalledWith('0.0.12345', undefined);
  });

  it('should follow pagination links', async () => {
    const msg1 = {
      consensus_timestamp: '1234567890.000000001',
      topic_id: '0.0.12345',
      message: Buffer.from('{}').toString('base64'),
      payer_account_id: '0.0.99',
      sequence_number: 1,
      running_hash: 'abc',
      running_hash_version: 3,
    };
    const msg2 = { ...msg1, consensus_timestamp: '1234567890.000000002', sequence_number: 2 };

    mockMirrorClient = {
      fetchMessages: vi.fn().mockResolvedValue({
        messages: [msg1],
        links: { next: 'https://mirror.example.com/next' },
      }),
      fetchNextPage: vi.fn().mockResolvedValue({
        messages: [msg2],
        links: {},
      }),
    };

    const backfill = new BackfillService({
      topicId: '0.0.12345',
      mirrorClient: mockMirrorClient,
      logger: mockLogger,
      pageDelayMs: 0,
    });

    const result = await backfill.run();
    expect(result.messagesProcessed).toBe(2);
    expect(mockMirrorClient.fetchNextPage).toHaveBeenCalledWith('https://mirror.example.com/next');
  });

  it('should handle empty response', async () => {
    mockMirrorClient = {
      fetchMessages: vi.fn().mockResolvedValue({ messages: [], links: {} }),
    };

    const backfill = new BackfillService({
      topicId: '0.0.12345',
      mirrorClient: mockMirrorClient,
      logger: mockLogger,
    });

    const result = await backfill.run();
    expect(result.messagesProcessed).toBe(0);
    expect(result.lastTimestamp).toBeUndefined();
  });

  it('should stop when stop() is called', async () => {
    mockMirrorClient = {
      fetchMessages: vi.fn().mockResolvedValue({
        messages: [],
        links: {},
      }),
    };

    const backfill = new BackfillService({
      topicId: '0.0.12345',
      mirrorClient: mockMirrorClient,
      logger: mockLogger,
    });

    // Can't truly test mid-run stop without async tricks, but verify it doesn't throw
    backfill.stop();
    const result = await backfill.run();
    expect(result.messagesProcessed).toBe(0);
  });

  it('should throw if already running', async () => {
    mockMirrorClient = {
      fetchMessages: vi.fn().mockImplementation(() => new Promise(() => {})), // never resolves
    };

    const backfill = new BackfillService({
      topicId: '0.0.12345',
      mirrorClient: mockMirrorClient,
      logger: mockLogger,
    });

    // Start one run (will hang)
    const p = backfill.run();

    // Second run should throw
    await expect(backfill.run()).rejects.toThrow('Backfill already running');

    // Cleanup
    backfill.stop();
  });
});
