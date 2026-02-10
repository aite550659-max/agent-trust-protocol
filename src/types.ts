/**
 * Core ATP types
 */

export interface ATPConfig {
  network: 'mainnet' | 'testnet' | 'previewnet';
  operatorId: string;
  operatorKey: string;
  indexerUrl?: string;
  hcsTopicId?: string;
}

export interface AgentMetadata {
  agentId: string;
  name: string;
  creator: string;
  owner: string;
  manifestUri: string;
  soulHash: string;
  hcsTopicId: string;
  royaltyPercentage: number;
  createdAt: string;
}

export interface PricingConfig {
  flashBaseFee: number;
  standardBaseFee: number;
  perInstruction: number;
  perMinute: number;
  llmMarkupBps: number;
  toolMarkupBps: number;
}

export interface RentalConstraints {
  toolsBlocked: string[];
  memoryAccessLevel: 'sandboxed' | 'read_only' | 'full';
  topicsBlocked: string[];
  maxPerInstructionCost: number;
  maxDailyCost: number;
}

export interface Rental {
  rentalId: string;
  agentId: string;
  renter: string;
  owner: string;
  rentalType: 'flash' | 'session' | 'term';
  stakeUsd: number;
  stakeHbar: number;
  usageBufferUsd: number;
  usageBufferHbar: number;
  escrowAccount: string;
  escrowKey?: string;
  pricingSnapshot: PricingConfig;
  constraints: RentalConstraints;
  startedAt: string;
  endedAt?: string;
  status: 'active' | 'completed' | 'terminated' | 'disputed';
}

export interface ReputationScore {
  accountId: string;
  score: number;
  totalRentals: number;
  violations: number;
  disputes: number;
  uptime30d: number;
}

export interface Dispute {
  disputeId: string;
  rentalId: string;
  agentId: string;
  challenger: string;
  defendant: string;
  challengerStake: number;
  claim: string;
  evidenceUri: string;
  status: 'filed' | 'assigned' | 'resolved' | 'appealed';
  arbiter?: string;
  ruling?: 'challenger_wins' | 'defendant_wins' | 'partial';
}

export interface HCSMessage {
  atpVersion: string;
  message_type: string;
  agent_id: string;
  timestamp: string;
  payload: Record<string, any>;
}

export interface IndexerResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}
