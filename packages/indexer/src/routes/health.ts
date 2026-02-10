import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { syncCursors } from '../db/schema.js';
import type { IngestionManager } from '../ingestion/manager.js';

export async function healthRoutes(fastify: FastifyInstance, ingestionManager?: IngestionManager) {
  fastify.get('/health', {
    schema: {
      description: 'Health check endpoint',
      tags: ['system'],
    },
  }, async (_request, reply) => {
    try {
      await db.select().from(syncCursors).limit(1);

      const cursors = await db.select().from(syncCursors);
      const ingestionStatus = ingestionManager?.getStatus() || {};

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: 'connected',
        syncStatus: cursors.map((cursor) => ({
          topicId: cursor.topicId,
          lastTimestamp: cursor.lastTimestamp,
          lastSequenceNumber: cursor.lastSequenceNumber,
          updatedAt: cursor.updatedAt,
          ingestionStatus: ingestionStatus[cursor.topicId]?.status || 'unknown',
        })),
      };
    } catch (error) {
      return reply.code(503).send({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
