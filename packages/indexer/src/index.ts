import { config } from './config.js';
import { createServer } from './server.js';
import { IngestionManager } from './ingestion/manager.js';
import { sql as pgClient } from './db/client.js';

async function main() {
  const ingestionManager = new IngestionManager();
  const server = await createServer({ ingestionManager });

  try {
    await server.listen({ port: config.port, host: '0.0.0.0' });
    server.log.info(`Server listening on port ${config.port}`);

    await ingestionManager.start(config.seedTopics);
    server.log.info({ topics: config.seedTopics }, 'Started ingestion');

    const shutdown = async (signal: string) => {
      server.log.info({ signal }, 'Received shutdown signal');

      try {
        server.log.info('Stopping ingestion manager...');
        await ingestionManager.stop();

        server.log.info('Closing HTTP server...');
        await server.close();

        server.log.info('Closing database connection...');
        await pgClient.end();

        server.log.info('Shutdown complete');
        process.exit(0);
      } catch (err) {
        server.log.error({ error: err }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
