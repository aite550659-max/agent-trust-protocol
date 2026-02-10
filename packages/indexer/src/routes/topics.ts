import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { hcsMessages, syncCursors } from '../db/schema.js';
import { desc, and, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { IngestionManager } from '../ingestion/manager.js';

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(25),
  offset: z.coerce.number().min(0).default(0),
  since: z.string().optional(),
  until: z.string().optional(),
  type: z.string().optional(),
});

export async function topicsRoutes(fastify: FastifyInstance, ingestionManager?: IngestionManager) {
  fastify.get<{ Params: { id: string } }>('/topics/:id/messages', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          since: { type: 'string' },
          until: { type: 'string' },
          type: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { id } = request.params;
    const query = querySchema.parse(request.query);
    const conditions = [eq(hcsMessages.topicId, id)];

    if (query.since) conditions.push(gte(hcsMessages.consensusTimestamp, query.since));
    if (query.until) conditions.push(lte(hcsMessages.consensusTimestamp, query.until));
    if (query.type) conditions.push(eq(hcsMessages.messageType, query.type));

    const whereClause = and(...conditions);

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(hcsMessages).where(whereClause);

    const results = await db.select()
      .from(hcsMessages)
      .where(whereClause)
      .orderBy(desc(hcsMessages.consensusTimestamp))
      .limit(query.limit)
      .offset(query.offset);

    return {
      topicId: id,
      data: results,
      pagination: { total: countResult.count, limit: query.limit, offset: query.offset },
      meta: { timestamp: new Date().toISOString() },
      filters: { type: query.type, since: query.since, until: query.until },
    };
  });

  // POST /topics — add a new topic to track
  fastify.post('/topics', {
    schema: {
      body: {
        type: 'object',
        required: ['topicId'],
        properties: {
          topicId: { type: 'string', description: 'Hedera topic ID (e.g. 0.0.12345)' },
        },
      },
    },
  }, async (request, reply) => {
    const { topicId } = request.body as { topicId: string };

    if (!/^\d+\.\d+\.\d+$/.test(topicId)) {
      return reply.code(400).send({ error: 'Invalid topic ID format. Expected: 0.0.XXXXX' });
    }

    // Insert cursor (no-op if already exists)
    await db.insert(syncCursors).values({
      topicId,
      lastTimestamp: '0.0',
      lastSequenceNumber: 0,
      updatedAt: new Date(),
    }).onConflictDoNothing();

    // Start ingestion if manager available
    if (ingestionManager) {
      await ingestionManager.addTopic(topicId);
      fastify.log.info({ topicId }, 'Added topic and started ingestion');
    }

    return reply.code(201).send({
      topicId,
      status: 'tracking',
      meta: { timestamp: new Date().toISOString() },
    });
  });
}
