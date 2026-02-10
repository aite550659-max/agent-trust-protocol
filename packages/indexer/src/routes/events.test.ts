import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../server.js';
import type { FastifyInstance } from 'fastify';

describe('Events Routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await createServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('GET /api/v1/events', () => {
    it('should return events list with pagination', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/events',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
      expect(body).toHaveProperty('filters');
      expect(body).toHaveProperty('meta');
      expect(Array.isArray(body.data)).toBe(true);
      expect(typeof body.pagination.total).toBe('number');
    });

    it('should filter by event type', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/events?type=OPENCLAW_ACTION',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.filters.type).toBe('OPENCLAW_ACTION');
    });

    it('should filter by agent ID', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/events?agentId=test-agent',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.filters.agentId).toBe('test-agent');
    });

    it('should filter by time range', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/events?since=1234567890&until=9999999999',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.filters.since).toBe(1234567890);
      expect(body.filters.until).toBe(9999999999);
    });
  });
});
