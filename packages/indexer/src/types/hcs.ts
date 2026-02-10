import { z } from 'zod';

export const agentInitializationSchema = z.object({
  version: z.string(),
  type: z.literal('AGENT_INITIALIZATION'),
  agentId: z.string(),
  agentName: z.string(),
  platform: z.string(),
  timestamp: z.number(),
  metadata: z.record(z.any()).optional(),
});

export const agentCreatedSchema = z.object({
  version: z.string(),
  type: z.literal('agent_created'),
  agentId: z.string(),
  agentName: z.string(),
  platform: z.string(),
  timestamp: z.number(),
  metadata: z.record(z.any()).optional(),
});

export const openclawActionSchema = z.object({
  version: z.string(),
  type: z.literal('OPENCLAW_ACTION'),
  agentId: z.string(),
  sessionKey: z.string(),
  action: z.object({
    tool: z.string(),
    parameters: z.record(z.any()),
    result: z.string(),
  }),
  reasoning: z.string().optional(),
  timestamp: z.number(),
  previousHash: z.string().optional(),
});

export const agentTransactionSchema = z.object({
  version: z.string(),
  type: z.literal('AGENT_TRANSACTION'),
  agentId: z.string(),
  transactionType: z.string(),
  transactionId: z.string(),
  details: z.string(),
  reasoning: z.string().nullable().optional(),
  timestamp: z.number(),
  previousHash: z.string().optional(),
});

export const rentalInitiatedSchema = z.object({
  version: z.string(),
  type: z.literal('rental_initiated'),
  agentId: z.string(),
  rentalId: z.string(),
  renter: z.string(),
  escrowAccount: z.string(),
  stakeUsd: z.number(),
  bufferUsd: z.number(),
  timestamp: z.number(),
});

export const rentalCompletedSchema = z.object({
  version: z.string(),
  type: z.literal('rental_completed'),
  rentalId: z.string(),
  totalCostUsd: z.number(),
  settlement: z.object({
    owner: z.number(),
    creator: z.number(),
    network: z.number(),
    treasury: z.number(),
  }),
  timestamp: z.number(),
});

export const agentCommsSchema = z.object({
  from: z.string(),
  timestamp: z.string(),
  text: z.string(),
  metadata: z.record(z.any()).optional(),
  to: z.string().optional(),
});

export const hcsMessageSchema = z.union([
  agentInitializationSchema,
  agentCreatedSchema,
  openclawActionSchema,
  agentTransactionSchema,
  rentalInitiatedSchema,
  rentalCompletedSchema,
  agentCommsSchema,
]);

export type AgentInitialization = z.infer<typeof agentInitializationSchema>;
export type AgentCreated = z.infer<typeof agentCreatedSchema>;
export type OpenclawAction = z.infer<typeof openclawActionSchema>;
export type AgentTransaction = z.infer<typeof agentTransactionSchema>;
export type RentalInitiated = z.infer<typeof rentalInitiatedSchema>;
export type RentalCompleted = z.infer<typeof rentalCompletedSchema>;
export type AgentComms = z.infer<typeof agentCommsSchema>;
export type HCSMessage = z.infer<typeof hcsMessageSchema>;

export interface MirrorNodeMessage {
  consensus_timestamp: string;
  topic_id: string;
  message: string;
  payer_account_id: string;
  sequence_number: number;
  chunk_info?: {
    initial_transaction_id: string;
    number: number;
    total: number;
  };
  running_hash: string;
  running_hash_version: number;
}

export interface MirrorNodeResponse {
  messages: MirrorNodeMessage[];
  links: {
    next?: string;
  };
}
