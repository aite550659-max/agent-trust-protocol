import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../server.js';
import type { FastifyInstance } from 'fastify';

describe('Health Routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await createServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('GET /api/v1/health', () => {
    it('should return health status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('database');
      expect(body).toHaveProperty('syncStatus');
      expect(Array.isArray(body.syncStatus)).toBe(true);
    });

    it('should include database connection status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/health',
      });

      const body = JSON.parse(response.body);
      expect(body.database).toBe('connected');
    });
  });
});
