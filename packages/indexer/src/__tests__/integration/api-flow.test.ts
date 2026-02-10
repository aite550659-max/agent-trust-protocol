import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// A chainable mock that also acts as a thenable resolving to defaultResult
function makeChain(defaultResult: unknown[] = []): any {
  // Create an array-like that's also chainable
  const arr = [...defaultResult] as any;

  // Every chain method returns the same chainable array
  const methods = ['from', 'where', 'orderBy', 'limit', 'offset', 'groupBy'];
  for (const m of methods) {
    arr[m] = vi.fn(() => makeChain(defaultResult));
  }

  // Make it thenable so `await chain.from(x)` resolves to the array
  arr.then = (resolve: (v: unknown[]) => void) => resolve(defaultResult);

  return arr;
}

vi.mock('../../db/client.js', () => {
  const mockDb = {
    select: vi.fn((...args: unknown[]) => {
      if (args.length > 0 && args[0] && typeof args[0] === 'object') {
        return makeChain([{ count: 0 }]);
      }
      return makeChain([]);
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(),
        onConflictDoUpdate: vi.fn(),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
  };

  return {
    db: mockDb,
    sql: { end: vi.fn() },
  };
});

vi.mock('../../db/schema.js', () => ({
  syncCursors: { topicId: 'topic_id' },
  hcsMessages: { topicId: 'topic_id', consensusTimestamp: 'ct', messageType: 'mt' },
  agents: { agentId: 'agent_id', lastSeenAt: 'last_seen_at', platform: 'platform' },
  agentEvents: { agentId: 'agent_id', eventType: 'event_type', timestamp: 'ts', consensusTimestamp: 'ct', previousHash: 'ph' },
  rentals: { rentalId: 'rental_id', agentId: 'agent_id', status: 'status', initiatedAt: 'ia' },
  agentComms: { id: 'id', topicId: 'topic_id', fromAgent: 'fa', toAgent: 'ta', timestamp: 'ts' },
}));

vi.mock('../../config.js', () => ({
  config: {
    databaseUrl: 'postgresql://test:test@localhost/test',
    network: 'testnet',
    mirrorNodeUrl: 'https://testnet.mirrornode.hedera.com',
    pollIntervalMs: 5000,
    port: 3850,
    logLevel: 'silent',
    seedTopics: ['0.0.12345'],
    hederaNetwork: 'testnet',
    backfillPageDelayMs: 0,
  },
}));

describe('Integration: API Flow', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    const { createServer } = await import('../../server.js');
    server = await createServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('GET / returns API info with docs link', async () => {
    const res = await server.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('ATP Indexer');
    expect(body.docs).toBe('/docs');
  });

  it('GET /docs returns Swagger UI', async () => {
    const res = await server.inject({ method: 'GET', url: '/docs/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('GET /api/v1/agents returns paginated response', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/agents?limit=5&offset=0' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
    expect(body.pagination).toHaveProperty('total');
    expect(body.pagination.limit).toBe(5);
    expect(body.pagination.offset).toBe(0);
    expect(body).toHaveProperty('meta');
    expect(body.meta).toHaveProperty('timestamp');
  });

  it('GET /api/v1/events returns paginated response with filters', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/events?type=OPENCLAW_ACTION&limit=10' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
    expect(body).toHaveProperty('filters');
    expect(body.filters.type).toBe('OPENCLAW_ACTION');
  });

  it('GET /api/v1/comms returns paginated response', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/comms' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
  });

  it('GET /api/v1/stats returns summary with meta', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/stats' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('meta');
  });

  it('POST /api/v1/topics validates topic ID format', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/topics',
      payload: { topicId: 'invalid' },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Invalid topic ID');
  });

  it('POST /api/v1/topics accepts valid topic ID', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/topics',
      payload: { topicId: '0.0.12345' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.topicId).toBe('0.0.12345');
    expect(body.status).toBe('tracking');
  });

  it('default pagination uses limit=25', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/agents' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.pagination.limit).toBe(25);
    expect(body.pagination.offset).toBe(0);
  });
});
