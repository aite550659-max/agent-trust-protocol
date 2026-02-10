import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { agentEvents } from '../db/schema.js';
import { desc, and, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(25),
  offset: z.coerce.number().min(0).default(0),
  since: z.coerce.number().optional(),
  until: z.coerce.number().optional(),
  type: z.string().optional(),
  agentId: z.string().optional(),
});

export async function eventsRoutes(fastify: FastifyInstance) {
  fastify.get('/events', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          since: { type: 'integer' },
          until: { type: 'integer' },
          type: { type: 'string' },
          agentId: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const query = querySchema.parse(request.query);
    const conditions = [];

    if (query.since) conditions.push(gte(agentEvents.timestamp, query.since));
    if (query.until) conditions.push(lte(agentEvents.timestamp, query.until));
    if (query.type) conditions.push(eq(agentEvents.eventType, query.type));
    if (query.agentId) conditions.push(eq(agentEvents.agentId, query.agentId));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(agentEvents).where(whereClause);

    const results = await db.select()
      .from(agentEvents)
      .where(whereClause)
      .orderBy(desc(agentEvents.timestamp))
      .limit(query.limit)
      .offset(query.offset);

    return {
      data: results,
      pagination: { total: countResult.count, limit: query.limit, offset: query.offset },
      meta: { timestamp: new Date().toISOString() },
      filters: {
        type: query.type,
        agentId: query.agentId,
        since: query.since,
        until: query.until,
      },
    };
  });
}
