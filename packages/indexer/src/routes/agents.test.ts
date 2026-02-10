import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../server.js';
import type { FastifyInstance } from 'fastify';

describe('Agents Routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await createServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('GET /api/v1/agents', () => {
    it('should return agents list with pagination', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/agents',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
      expect(body).toHaveProperty('meta');
      expect(body.meta).toHaveProperty('timestamp');
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('should respect limit and offset parameters', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/agents?limit=10&offset=0',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.pagination.limit).toBe(10);
      expect(body.pagination.offset).toBe(0);
      expect(typeof body.pagination.total).toBe('number');
    });

    it('should enforce max limit of 100', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/agents?limit=200',
      });

      // Fastify schema validation rejects >100
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/agents/:id', () => {
    it('should return 404 for non-existent agent', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/agents/non-existent-agent',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Agent not found');
    });
  });

  describe('GET /api/v1/agents/:id/attestations', () => {
    it('should return attestations list with pagination', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/agents/test-agent/attestations',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('agentId');
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('GET /api/v1/agents/:id/rentals', () => {
    it('should return rentals list with pagination', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/agents/test-agent/rentals',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('agentId');
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
      expect(Array.isArray(body.data)).toBe(true);
    });
  });
});
