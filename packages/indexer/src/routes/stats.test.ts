import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../server.js';
import type { FastifyInstance } from 'fastify';

describe('Stats Routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await createServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('GET /api/v1/stats', () => {
    it('should return statistics with meta', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/stats',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('summary');
      expect(body).toHaveProperty('eventsByType');
      expect(body).toHaveProperty('rentalsByStatus');
      expect(body).toHaveProperty('meta');
    });

    it('should return summary with counts', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/stats',
      });

      const body = JSON.parse(response.body);
      expect(body.summary).toHaveProperty('totalAgents');
      expect(body.summary).toHaveProperty('totalEvents');
      expect(body.summary).toHaveProperty('totalRentals');
      expect(body.summary).toHaveProperty('totalComms');
      expect(body.summary).toHaveProperty('totalMessages');
      expect(typeof body.summary.totalAgents).toBe('number');
    });
  });
});
