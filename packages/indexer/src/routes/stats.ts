import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { agents, agentEvents, rentals, agentComms, hcsMessages } from '../db/schema.js';
import { sql } from 'drizzle-orm';

export async function statsRoutes(fastify: FastifyInstance) {
  fastify.get('/stats', {
    schema: {
      description: 'Aggregate statistics',
      tags: ['stats'],
    },
  }, async () => {
    const [agentCount] = await db.select({ count: sql<number>`count(*)::int` }).from(agents);
    const [eventCount] = await db.select({ count: sql<number>`count(*)::int` }).from(agentEvents);
    const [rentalCount] = await db.select({ count: sql<number>`count(*)::int` }).from(rentals);
    const [commsCount] = await db.select({ count: sql<number>`count(*)::int` }).from(agentComms);
    const [messageCount] = await db.select({ count: sql<number>`count(*)::int` }).from(hcsMessages);

    const eventsByType = await db.select({
      eventType: agentEvents.eventType,
      count: sql<number>`count(*)::int`,
    }).from(agentEvents).groupBy(agentEvents.eventType);

    const rentalsByStatus = await db.select({
      status: rentals.status,
      count: sql<number>`count(*)::int`,
    }).from(rentals).groupBy(rentals.status);

    return {
      summary: {
        totalAgents: agentCount.count,
        totalEvents: eventCount.count,
        totalRentals: rentalCount.count,
        totalComms: commsCount.count,
        totalMessages: messageCount.count,
      },
      eventsByType: eventsByType.reduce((acc, row) => {
        acc[row.eventType] = row.count;
        return acc;
      }, {} as Record<string, number>),
      rentalsByStatus: rentalsByStatus.reduce((acc, row) => {
        acc[row.status] = row.count;
        return acc;
      }, {} as Record<string, number>),
      meta: { timestamp: new Date().toISOString() },
    };
  });
}
