import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { agentComms } from '../db/schema.js';
import { desc, and, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(25),
  offset: z.coerce.number().min(0).default(0),
  since: z.string().optional(),
  until: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function commsRoutes(fastify: FastifyInstance) {
  fastify.get('/comms', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          since: { type: 'string' },
          until: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const query = querySchema.parse(request.query);
    const conditions = [];

    if (query.since) conditions.push(gte(agentComms.timestamp, query.since));
    if (query.until) conditions.push(lte(agentComms.timestamp, query.until));
    if (query.from) conditions.push(eq(agentComms.fromAgent, query.from));
    if (query.to) conditions.push(eq(agentComms.toAgent, query.to));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(agentComms).where(whereClause);

    const results = await db.select()
      .from(agentComms)
      .where(whereClause)
      .orderBy(desc(agentComms.timestamp))
      .limit(query.limit)
      .offset(query.offset);

    return {
      data: results,
      pagination: { total: countResult.count, limit: query.limit, offset: query.offset },
      meta: { timestamp: new Date().toISOString() },
      filters: { from: query.from, to: query.to, since: query.since, until: query.until },
    };
  });
}
