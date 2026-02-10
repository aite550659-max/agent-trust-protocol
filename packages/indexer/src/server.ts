import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from './config.js';
import { agentsRoutes } from './routes/agents.js';
import { eventsRoutes } from './routes/events.js';
import { commsRoutes } from './routes/comms.js';
import { topicsRoutes } from './routes/topics.js';
import { healthRoutes } from './routes/health.js';
import { statsRoutes } from './routes/stats.js';
import type { IngestionManager } from './ingestion/manager.js';

export interface CreateServerOptions {
  ingestionManager?: IngestionManager;
}

export async function createServer(options?: CreateServerOptions) {
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
  });

  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'ATP Indexer API',
        description: 'HCS event indexer + REST API for the Agent Trust Protocol',
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${config.port}` }],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
  });

  await fastify.register(cors, { origin: true });

  fastify.get('/', async () => {
    return {
      name: 'ATP Indexer',
      version: '1.0.0',
      docs: '/docs',
      endpoints: {
        agents: '/api/v1/agents',
        events: '/api/v1/events',
        comms: '/api/v1/comms',
        topics: '/api/v1/topics/:id/messages',
        health: '/api/v1/health',
        stats: '/api/v1/stats',
      },
    };
  });

  await fastify.register(async (instance) => {
    await agentsRoutes(instance);
    await eventsRoutes(instance);
    await commsRoutes(instance);
    await topicsRoutes(instance, options?.ingestionManager);
    await healthRoutes(instance, options?.ingestionManager);
    await statsRoutes(instance);
  }, { prefix: '/api/v1' });

  fastify.setErrorHandler((error, _request, reply) => {
    fastify.log.error(error);
    reply.status(500).send({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  });

  return fastify;
}
