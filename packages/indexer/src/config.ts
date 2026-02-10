import { z } from 'zod';

const configSchema = z.object({
  databaseUrl: z.string().url(),
  network: z.enum(['mainnet', 'testnet']).default('mainnet'),
  mirrorNodeUrl: z.string().url(),
  pollIntervalMs: z.coerce.number().min(1000).default(5000),
  port: z.coerce.number().min(1).max(65535).default(3850),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  seedTopics: z.string().transform((val) => val.split(',').map((t) => t.trim())),
  hederaNetwork: z.enum(['mainnet', 'testnet']).default('mainnet'),
  backfillPageDelayMs: z.coerce.number().min(0).default(100),
});

const env = {
  databaseUrl: process.env.DATABASE_URL || 'postgresql://vai:vai-atp-dev@localhost:5432/atp_indexer',
  network: process.env.NETWORK || 'mainnet',
  mirrorNodeUrl: process.env.MIRROR_NODE_URL || 'https://mainnet.mirrornode.hedera.com',
  pollIntervalMs: process.env.POLL_INTERVAL_MS || '5000',
  port: process.env.PORT || '3850',
  logLevel: process.env.LOG_LEVEL || 'info',
  seedTopics: process.env.SEED_TOPICS || '0.0.10261370,0.0.10268541',
  hederaNetwork: process.env.HEDERA_NETWORK || 'mainnet',
  backfillPageDelayMs: process.env.BACKFILL_PAGE_DELAY_MS || '100',
};

export const config = configSchema.parse(env);

export type Config = z.infer<typeof configSchema>;
