import { pgTable, text, timestamp, jsonb, bigint, index, numeric } from 'drizzle-orm/pg-core';

export const syncCursors = pgTable('sync_cursors', {
  topicId: text('topic_id').primaryKey(),
  lastTimestamp: text('last_timestamp').notNull(),
  lastSequenceNumber: bigint('last_sequence_number', { mode: 'number' }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  updatedAtIdx: index('sync_cursors_updated_at_idx').on(table.updatedAt),
}));

export const hcsMessages = pgTable('hcs_messages', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  topicId: text('topic_id').notNull(),
  consensusTimestamp: text('consensus_timestamp').notNull(),
  sequenceNumber: bigint('sequence_number', { mode: 'number' }).notNull(),
  payerAccountId: text('payer_account_id'),
  messageBase64: text('message_base64').notNull(),
  decodedJson: jsonb('decoded_json'),
  messageType: text('message_type'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  topicTimestampIdx: index('hcs_messages_topic_timestamp_idx').on(table.topicId, table.consensusTimestamp),
  typeIdx: index('hcs_messages_type_idx').on(table.messageType),
  timestampIdx: index('hcs_messages_timestamp_idx').on(table.consensusTimestamp),
}));

export const agents = pgTable('agents', {
  agentId: text('agent_id').primaryKey(),
  agentName: text('agent_name').notNull(),
  platform: text('platform').notNull(),
  version: text('version'),
  operatingAccount: text('operating_account'),
  firstSeenAt: timestamp('first_seen_at').notNull(),
  lastSeenAt: timestamp('last_seen_at').notNull(),
  metadata: jsonb('metadata'),
}, (table) => ({
  platformIdx: index('agents_platform_idx').on(table.platform),
  lastSeenIdx: index('agents_last_seen_idx').on(table.lastSeenAt),
}));

export const agentEvents = pgTable('agent_events', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  agentId: text('agent_id').notNull(),
  eventType: text('event_type').notNull(),
  sessionKey: text('session_key'),
  transactionId: text('transaction_id'),
  transactionType: text('transaction_type'),
  action: jsonb('action'),
  reasoning: text('reasoning'),
  details: text('details'),
  previousHash: text('previous_hash'),
  timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
  consensusTimestamp: text('consensus_timestamp').notNull(),
  rawData: jsonb('raw_data').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  agentIdIdx: index('agent_events_agent_id_idx').on(table.agentId),
  eventTypeIdx: index('agent_events_event_type_idx').on(table.eventType),
  timestampIdx: index('agent_events_timestamp_idx').on(table.timestamp),
  consensusTimestampIdx: index('agent_events_consensus_timestamp_idx').on(table.consensusTimestamp),
  hashIdx: index('agent_events_hash_idx').on(table.previousHash),
}));

export const rentals = pgTable('rentals', {
  rentalId: text('rental_id').primaryKey(),
  agentId: text('agent_id').notNull(),
  renter: text('renter'),
  escrowAccount: text('escrow_account'),
  stakeUsd: numeric('stake_usd', { precision: 10, scale: 2 }),
  bufferUsd: numeric('buffer_usd', { precision: 10, scale: 2 }),
  totalCostUsd: numeric('total_cost_usd', { precision: 10, scale: 2 }),
  settlement: jsonb('settlement'),
  status: text('status').notNull().default('initiated'),
  initiatedAt: bigint('initiated_at', { mode: 'number' }),
  completedAt: bigint('completed_at', { mode: 'number' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  agentIdIdx: index('rentals_agent_id_idx').on(table.agentId),
  renterIdx: index('rentals_renter_idx').on(table.renter),
  statusIdx: index('rentals_status_idx').on(table.status),
  initiatedAtIdx: index('rentals_initiated_at_idx').on(table.initiatedAt),
}));

export const agentComms = pgTable('agent_comms', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  topicId: text('topic_id').notNull(),
  fromAgent: text('from_agent').notNull(),
  toAgent: text('to_agent'),
  text: text('text').notNull(),
  timestamp: text('timestamp').notNull(),
  consensusTimestamp: text('consensus_timestamp').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  fromAgentIdx: index('agent_comms_from_agent_idx').on(table.fromAgent),
  toAgentIdx: index('agent_comms_to_agent_idx').on(table.toAgent),
  timestampIdx: index('agent_comms_timestamp_idx').on(table.timestamp),
  topicIdx: index('agent_comms_topic_idx').on(table.topicId),
}));
