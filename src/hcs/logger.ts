/**
 * HCS Logger - Submit ATP messages to Hedera Consensus Service
 */

import { 
  Client, 
  TopicMessageSubmitTransaction, 
  TopicId,
  Status
} from '@hashgraph/sdk';
import { ATPConfig, HCSMessage } from '../types';
import { ATP_VERSION, HCS_SCHEMA_VERSION } from '../config';

export class HCSLogger {
  constructor(
    private client: Client,
    private config: ATPConfig
  ) {}

  /**
   * Log a message to HCS
   */
  async log(message: HCSMessage, topicId?: string): Promise<{
    topicId: string;
    sequenceNumber: bigint;
    consensusTimestamp: string;
  }> {
    // Validate message
    const validationError = this.validateMessage(message);
    if (validationError) {
      throw new Error(`Message validation failed: ${validationError}`);
    }

    // Determine topic ID (use provided or config default)
    const targetTopicId = topicId || this.config.hcsTopicId;
    if (!targetTopicId) {
      throw new Error('No HCS topic ID provided');
    }

    // Serialize message to JSON
    const messageJson = JSON.stringify(message);
    const messageBytes = Buffer.from(messageJson, 'utf-8');

    // Submit to HCS
    const transaction = new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(targetTopicId))
      .setMessage(messageBytes);

    const response = await transaction.execute(this.client);
    const receipt = await response.getReceipt(this.client);

    if (receipt.status !== Status.Success) {
      throw new Error(`HCS submission failed: ${receipt.status.toString()}`);
    }

    return {
      topicId: targetTopicId,
      sequenceNumber: BigInt(receipt.topicSequenceNumber!.toString()),
      consensusTimestamp: response.transactionId.validStart!.toDate().toISOString(),
    };
  }

  /**
   * Batch log multiple messages
   */
  async logBatch(messages: HCSMessage[], topicId?: string): Promise<Array<{
    topicId: string;
    sequenceNumber: bigint;
    consensusTimestamp: string;
  }>> {
    const results = [];
    
    for (const message of messages) {
      const result = await this.log(message, topicId);
      results.push(result);
    }
    
    return results;
  }

  /**
   * Create ATP message envelope
   */
  createMessage(
    messageType: string,
    agentId: string,
    payload: Record<string, any>
  ): HCSMessage {
    return {
      atpVersion: ATP_VERSION,
      message_type: messageType,
      agent_id: agentId,
      timestamp: new Date().toISOString(),
      payload,
    };
  }

  /**
   * Validate message against ATP schema
   */
  validateMessage(message: HCSMessage): string | null {
    // Required fields
    if (!message.atpVersion) {
      return 'Missing atpVersion';
    }
    if (!message.message_type) {
      return 'Missing message_type';
    }
    if (!message.agent_id) {
      return 'Missing agent_id';
    }
    if (!message.timestamp) {
      return 'Missing timestamp';
    }
    if (!message.payload || typeof message.payload !== 'object') {
      return 'Missing or invalid payload';
    }

    // Version format (semantic versioning)
    if (!/^\d+\.\d+$/.test(message.atpVersion)) {
      return 'Invalid atpVersion format (expected MAJOR.MINOR)';
    }

    // Agent ID format (Hedera account/token ID)
    if (!/^0\.0\.\d+$/.test(message.agent_id)) {
      return 'Invalid agent_id format (expected 0.0.XXXXX)';
    }

    // Timestamp format (ISO 8601)
    if (isNaN(Date.parse(message.timestamp))) {
      return 'Invalid timestamp format (expected ISO 8601)';
    }

    // Message type validation (known types)
    const validMessageTypes = [
      // Agent lifecycle
      'agent_created',
      'agent_ownership_transfer',
      'agent_pricing_update',
      // Rental lifecycle
      'rental_initiated',
      'rental_instruction',
      'rental_heartbeat',
      'rental_downtime',
      'rental_completed',
      'rental_terminated',
      'rental_violation',
      // Sub-rental
      'subrental_initiated',
      // Disputes
      'dispute_filed',
      'dispute_assigned',
      'dispute_resolved',
      // Reputation
      'reputation_snapshot',
      // Trust & staking
      'trust_tier_staked',
      'trust_tier_unstaked',
      // Runtime
      'runtime_attestation',
    ];

    if (!validMessageTypes.includes(message.message_type)) {
      return `Unknown message type: ${message.message_type}`;
    }

    return null; // Valid
  }
}
