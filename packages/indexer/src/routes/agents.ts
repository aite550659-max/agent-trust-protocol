import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { agents, agentEvents } from '../db/schema.js';
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(25),
  offset: z.coerce.number().min(0).default(0),
  since: z.coerce.number().optional(),
  until: z.coerce.number().optional(),
});

const paginationQuerystring = {
  type: 'object',
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    offset: { type: 'integer', minimum: 0, default: 0 },
    since: { type: 'integer' },
    until: { type: 'integer' },
  },
};

function paginated(data: unknown[], total: number, limit: number, offset: number) {
  return {
    data,
    pagination: { total, limit, offset },
    meta: { timestamp: new Date().toISOString() },
  };
}

export async function agentsRoutes(fastify: FastifyInstance) {
  fastify.get('/agents', {
    schema: {
      querystring: paginationQuerystring,
      
    },
  }, async (request) => {
    const query = querySchema.parse(request.query);

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(agents);

    const results = await db.select()
      .from(agents)
      .orderBy(desc(agents.lastSeenAt))
      .limit(query.limit)
      .offset(query.offset);

    return paginated(results, countResult.count, query.limit, query.offset);
  });

  fastify.get<{ Params: { id: string } }>('/agents/:id', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      querystring: paginationQuerystring,
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const agent = await db.select()
      .from(agents)
      .where(eq(agents.agentId, id))
      .limit(1);

    if (!agent.length) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    const query = querySchema.parse(request.query);
    const conditions = [eq(agentEvents.agentId, id)];

    if (query.since) conditions.push(gte(agentEvents.timestamp, query.since));
    if (query.until) conditions.push(lte(agentEvents.timestamp, query.until));

    const whereClause = and(...conditions);

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(agentEvents).where(whereClause);

    const events = await db.select()
      .from(agentEvents)
      .where(whereClause)
      .orderBy(desc(agentEvents.timestamp))
      .limit(query.limit)
      .offset(query.offset);

    return {
      agent: agent[0],
      ...paginated(events, countResult.count, query.limit, query.offset),
    };
  });

  fastify.get<{ Params: { id: string } }>('/agents/:id/attestations', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      querystring: paginationQuerystring,
    },
  }, async (request) => {
    const { id } = request.params;
    const query = querySchema.parse(request.query);

    const conditions = [
      eq(agentEvents.agentId, id),
      eq(agentEvents.eventType, 'OPENCLAW_ACTION'),
    ];

    if (query.since) conditions.push(gte(agentEvents.timestamp, query.since));
    if (query.until) conditions.push(lte(agentEvents.timestamp, query.until));

    const whereClause = and(...conditions);

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(agentEvents).where(whereClause);

    const attestations = await db.select()
      .from(agentEvents)
      .where(whereClause)
      .orderBy(desc(agentEvents.timestamp))
      .limit(query.limit)
      .offset(query.offset);

    return {
      agentId: id,
      ...paginated(attestations, countResult.count, query.limit, query.offset),
    };
  });

  fastify.get<{ Params: { id: string } }>('/agents/:id/rentals', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      querystring: paginationQuerystring,
    },
  }, async (request) => {
    const { id } = request.params;
    const query = querySchema.parse(request.query);

    const { rentals } = await import('../db/schema.js');

    const conditions = [eq(rentals.agentId, id)];

    if (query.since) conditions.push(gte(rentals.initiatedAt, query.since));
    if (query.until) conditions.push(lte(rentals.initiatedAt, query.until));

    const whereClause = and(...conditions);

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(rentals).where(whereClause);

    const results = await db.select()
      .from(rentals)
      .where(whereClause)
      .orderBy(desc(rentals.initiatedAt))
      .limit(query.limit)
      .offset(query.offset);

    return {
      agentId: id,
      ...paginated(results, countResult.count, query.limit, query.offset),
    };
  });
}
