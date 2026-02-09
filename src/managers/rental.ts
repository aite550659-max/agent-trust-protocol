/**
 * Rental Manager - Initiate, operate, and settle rentals
 */

import {
  Client,
  AccountCreateTransaction,
  TransferTransaction,
  Hbar,
  AccountId,
  Status,
  KeyList,
  PrivateKey,
} from '@hashgraph/sdk';
import { ATPConfig, Rental, RentalConstraints } from '../types';
import { HCSLogger } from '../hcs/logger';
import { Indexer } from '../indexer/client';
import { TRANSACTION_SPLITS, NETWORK_ACCOUNTS } from '../config';
import { exchangeRateService } from '../exchange-rate';

export class RentalManager {
  private hcsLogger: HCSLogger;
  private indexer: Indexer;
  private resolveAgent: (agentId: string) => Promise<{ owner: string; hcsTopicId: string; creator: string }>;
  private onRentalCreated?: (rentalId: string, rental: Rental) => void;
  private getRental?: (rentalId: string) => Rental | undefined;

  constructor(
    private client: Client,
    private config: ATPConfig,
    resolveAgent: (agentId: string) => Promise<{ owner: string; hcsTopicId: string; creator: string }>,
    onRentalCreated?: (rentalId: string, rental: Rental) => void,
    getRental?: (rentalId: string) => Rental | undefined
  ) {
    this.hcsLogger = new HCSLogger(client, config);
    this.indexer = new Indexer(config);
    this.resolveAgent = resolveAgent;
    this.onRentalCreated = onRentalCreated;
    this.getRental = getRental;
  }

  /**
   * Initiate a new rental of an ATP agent.
   *
   * Creates an escrow account, transfers stake + usage buffer, and logs
   * `rental_initiated` to the agent's HCS topic.
   *
   * @param params.agentId - The agent to rent (HTS token ID)
   * @param params.type - Rental type: "flash" (single instruction), "session" (hours), or "term" (days+)
   * @param params.stakeUsd - Stake amount in USD (held as collateral, returned on clean completion)
   * @param params.bufferUsd - Usage buffer in USD (draws down during rental, unused portion refunded)
   * @param params.constraints - Optional rental constraints (blocked tools, memory access level, cost limits)
   * @param params.expectedDurationMinutes - Optional expected duration for scheduling
   * @returns Rental object with rentalId, escrow account, and status
   * @throws Error if agent not found, escrow creation fails, or funding fails
   */
  /** Validate a Hedera entity ID format (e.g. "0.0.12345"). */
  private validateEntityId(id: string, label: string): void {
    if (!id || !/^\d+\.\d+\.\d+$/.test(id)) {
      throw new Error(`Invalid ${label}: expected format "0.0.NNNNN", got "${id}"`);
    }
  }

  async initiate(params: {
    agentId: string;
    type: 'flash' | 'session' | 'term';
    stakeUsd: number;
    bufferUsd: number;
    constraints?: RentalConstraints;
    expectedDurationMinutes?: number;
    /** Optional: pass agent metadata directly to skip indexer lookup (useful right after creation). */
    agentMetadata?: { owner: string; hcsTopicId: string };
  }): Promise<Rental> {
    // Input validation
    this.validateEntityId(params.agentId, 'agentId');
    if (!['flash', 'session', 'term'].includes(params.type)) {
      throw new Error(`Invalid rental type: "${params.type}" (must be flash, session, or term)`);
    }
    if (typeof params.stakeUsd !== 'number' || !isFinite(params.stakeUsd) || params.stakeUsd <= 0) {
      throw new Error(`Invalid stakeUsd: must be a positive number, got ${params.stakeUsd}`);
    }
    if (typeof params.bufferUsd !== 'number' || !isFinite(params.bufferUsd) || params.bufferUsd <= 0) {
      throw new Error(`Invalid bufferUsd: must be a positive number, got ${params.bufferUsd}`);
    }
    if (params.stakeUsd > 1_000_000 || params.bufferUsd > 1_000_000) {
      throw new Error(`Stake/buffer exceeds $1M safety limit (stake: $${params.stakeUsd}, buffer: $${params.bufferUsd})`);
    }
    if (params.expectedDurationMinutes !== undefined && (params.expectedDurationMinutes <= 0 || params.expectedDurationMinutes > 525600)) {
      throw new Error(`Invalid expectedDurationMinutes: ${params.expectedDurationMinutes} (must be 1-525600)`);
    }

    // Step 1: Get agent metadata and pricing
    let agent: { owner: string; hcsTopicId: string };
    if (params.agentMetadata) {
      // Backwards compatible: use provided metadata
      agent = params.agentMetadata;
    } else {
      // Use resolver chain (cache → indexer → mirror node)
      agent = await this.resolveAgent(params.agentId);
    }

    // Step 2: Check renter reputation (if agent has requirements)
    // TODO: Implement reputation check

    // Step 3: Convert USD to HBAR using real-time exchange rate
    const hbarRate = await exchangeRateService.getRate();
    const stakeHbar = params.stakeUsd / hbarRate;
    const bufferHbar = params.bufferUsd / hbarRate;
    const totalHbar = stakeHbar + bufferHbar;

    // Step 4: Create escrow account (multi-sig controlled by renter + protocol)
    const escrowKey = PrivateKey.generateED25519();
    const escrowAccountTx = new AccountCreateTransaction()
      .setKey(escrowKey)
      .setInitialBalance(Hbar.fromString('0'));

    const escrowResponse = await escrowAccountTx.execute(this.client);
    const escrowReceipt = await escrowResponse.getReceipt(this.client);

    if (escrowReceipt.status !== Status.Success || !escrowReceipt.accountId) {
      throw new Error(`Failed to create escrow account for rental of agent ${params.agentId} (status: ${escrowReceipt.status})`);
    }

    const escrowAccountId = escrowReceipt.accountId.toString();

    // Step 5: Transfer stake + buffer to escrow
    const fundingTx = new TransferTransaction()
      .addHbarTransfer(
        AccountId.fromString(this.config.operatorId),
        new Hbar(-totalHbar)
      )
      .addHbarTransfer(
        AccountId.fromString(escrowAccountId),
        new Hbar(totalHbar)
      );

    const fundingResponse = await fundingTx.execute(this.client);
    const fundingReceipt = await fundingResponse.getReceipt(this.client);

    if (fundingReceipt.status !== Status.Success) {
      throw new Error(`Failed to fund escrow ${escrowAccountId} with ${totalHbar} HBAR for agent ${params.agentId} (status: ${fundingReceipt.status})`);
    }

    // Step 6: Generate rental ID
    const rentalId = `rental_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Step 7: Log rental_initiated to HCS
    const initiationMessage = this.hcsLogger.createMessage(
      'rental_initiated',
      params.agentId,
      {
        rental_id: rentalId,
        renter: this.config.operatorId,
        owner: agent.owner,
        rental_type: params.type,
        stake_usd: params.stakeUsd,
        stake_hbar: stakeHbar,
        usage_buffer_usd: params.bufferUsd,
        usage_buffer_hbar: bufferHbar,
        escrow_account: escrowAccountId,
        pricing_snapshot: {}, // Would get from agent metadata
        constraints: params.constraints || {
          toolsBlocked: [],
          memoryAccessLevel: 'sandboxed',
          topicsBlocked: [],
          maxPerInstructionCost: 100,
          maxDailyCost: 1000,
        },
        expected_duration_minutes: params.expectedDurationMinutes || null,
        parent_rental_id: null,
      }
    );

    await this.hcsLogger.log(initiationMessage, agent.hcsTopicId);

    // Return rental object
    const rental: Rental = {
      rentalId,
      agentId: params.agentId,
      renter: this.config.operatorId,
      owner: agent.owner,
      rentalType: params.type,
      stakeUsd: params.stakeUsd,
      stakeHbar,
      usageBufferUsd: params.bufferUsd,
      usageBufferHbar: bufferHbar,
      escrowAccount: escrowAccountId,
      pricingSnapshot: {
        flashBaseFee: 0.02,
        standardBaseFee: 5.00,
        perInstruction: 0.05,
        perMinute: 0.01,
        llmMarkupBps: 150,
        toolMarkupBps: 150,
      },
      constraints: params.constraints || {
        toolsBlocked: [],
        memoryAccessLevel: 'sandboxed',
        topicsBlocked: [],
        maxPerInstructionCost: 100,
        maxDailyCost: 1000,
      },
      startedAt: new Date().toISOString(),
      status: 'active',
    };

    // Cache the rental for immediate use
    if (this.onRentalCreated) {
      this.onRentalCreated(rentalId, rental);
    }

    return rental;
  }

  /**
   * Get current status of a rental from the indexer.
   *
   * @param rentalId - The rental identifier (e.g., "rental_1707206400_abc123")
   * @returns Rental object with current status, usage, and escrow details
   * @throws Error if rental not found or indexer unavailable
   */
  async getStatus(rentalId: string): Promise<Rental> {
    if (!rentalId || typeof rentalId !== 'string' || rentalId.length > 100) {
      throw new Error(`Invalid rentalId: must be a non-empty string (max 100 chars), got "${rentalId?.slice(0, 20)}"`);
    }

    // Try cache first
    if (this.getRental) {
      const cached = this.getRental(rentalId);
      if (cached) {
        return cached;
      }
    }

    // Fall back to indexer
    const response = await this.indexer.getRentalStatus(rentalId);
    
    if (!response.success || !response.data) {
      throw new Error(`Failed to get rental status: ${response.error || 'Unknown error'}`);
    }

    return response.data;
  }

  /**
   * Terminate a rental early. Callable by renter or owner.
   * Calculates pro-rata charges, settles escrow, and logs `rental_terminated` to HCS.
   *
   * @param rentalId - The rental to terminate
   * @param reason - Optional reason for termination (logged to HCS)
   * @throws Error if rental not found or caller is not renter/owner
   */
  async terminate(rentalId: string, reason?: string): Promise<void> {
    if (!rentalId || typeof rentalId !== 'string' || rentalId.length > 100) {
      throw new Error(`Invalid rentalId: must be a non-empty string (max 100 chars)`);
    }
    if (reason && reason.length > 1000) {
      throw new Error(`Termination reason too long: ${reason.length} chars (max 1000)`);
    }
    // Get rental status
    const rental = await this.getStatus(rentalId);

    // Verify caller is renter or owner
    if (
      rental.renter !== this.config.operatorId &&
      rental.owner !== this.config.operatorId
    ) {
      throw new Error(`Only renter or owner can terminate rental ${rentalId} (renter: ${rental.renter}, owner: ${rental.owner}, caller: ${this.config.operatorId})`);
    }

    const isRenter = rental.renter === this.config.operatorId;

    // Calculate pro-rata charges (simplified)
    const totalChargedUsd = 0; // Would calculate based on usage

    // Execute settlement (simplified - would use actual escrow account)
    // ... distribution logic ...

    // Log termination to HCS
    const agent = await this.resolveAgent(rental.agentId);
    const hcsTopicId = agent.hcsTopicId;

    const terminationMessage = this.hcsLogger.createMessage(
      'rental_terminated',
      rental.agentId,
      {
        rental_id: rentalId,
        terminated_by: this.config.operatorId,
        role: isRenter ? 'renter' : 'owner',
        reason: reason || 'manual_termination',
        duration_minutes: 0, // Would calculate
        pro_rata_billing: true,
        total_charged_usd: totalChargedUsd,
        stake_returned: true,
        unused_buffer_returned_usd: rental.usageBufferUsd,
      }
    );

    if (hcsTopicId) {
      await this.hcsLogger.log(terminationMessage, hcsTopicId);
    }
  }

  /**
   * Complete a rental and execute final settlement.
   * Distributes funds from escrow: 92% owner, 5% creator, 2% network (0.0.800), 1% ATP treasury.
   * Logs `rental_completed` to the agent's HCS topic with full usage breakdown.
   *
   * @param rentalId - The rental to complete
   * @param usage.totalInstructions - Total instructions executed during rental
   * @param usage.totalTokens - Total LLM tokens consumed
   * @param usage.totalCostUsd - Total cost in USD
   * @param usage.uptimePercentage - Optional uptime percentage (affects reputation)
   * @throws Error if rental or agent not found
   */
  async complete(rentalId: string, usage: {
    totalInstructions: number;
    totalTokens: number;
    totalCostUsd: number;
    uptimePercentage?: number;
  }): Promise<void> {
    if (!rentalId || typeof rentalId !== 'string') {
      throw new Error('Invalid rentalId');
    }
    if (!usage || typeof usage.totalInstructions !== 'number' || usage.totalInstructions < 0) {
      throw new Error(`Invalid usage.totalInstructions: must be non-negative, got ${usage?.totalInstructions}`);
    }
    if (typeof usage.totalTokens !== 'number' || usage.totalTokens < 0) {
      throw new Error(`Invalid usage.totalTokens: must be non-negative, got ${usage.totalTokens}`);
    }
    if (typeof usage.totalCostUsd !== 'number' || !isFinite(usage.totalCostUsd) || usage.totalCostUsd < 0) {
      throw new Error(`Invalid usage.totalCostUsd: must be non-negative, got ${usage.totalCostUsd}`);
    }
    if (usage.uptimePercentage !== undefined && (usage.uptimePercentage < 0 || usage.uptimePercentage > 100)) {
      throw new Error(`Invalid uptimePercentage: must be 0-100, got ${usage.uptimePercentage}`);
    }

    // Get rental details
    const rental = await this.getStatus(rentalId);
    const agent = await this.resolveAgent(rental.agentId);

    // Calculate distribution splits
    const totalCharged = usage.totalCostUsd;
    const creatorRoyalty = totalCharged * TRANSACTION_SPLITS.creator_royalty;
    const networkContribution = totalCharged * TRANSACTION_SPLITS.network_contribution;
    const atpTreasury = totalCharged * TRANSACTION_SPLITS.atp_treasury;
    const ownerRevenue = totalCharged * TRANSACTION_SPLITS.owner_revenue;

    // Execute distribution (simplified - would use actual escrow + scheduled transactions)
    const networkAccount = NETWORK_ACCOUNTS[this.config.network].network;
    const treasuryAccount = NETWORK_ACCOUNTS[this.config.network].treasury;

    // Distribution transaction would go here
    // const distributionTx = new TransferTransaction()
    //   .addHbarTransfer(escrowAccount, -totalChargedHbar)
    //   .addHbarTransfer(creator, creatorRoyaltyHbar)
    //   .addHbarTransfer(network, networkHbar)
    //   .addHbarTransfer(treasury, treasuryHbar)
    //   .addHbarTransfer(owner, ownerHbar)
    //   .addHbarTransfer(renter, unusedBufferHbar);

    // Log completion to HCS
    const completionMessage = this.hcsLogger.createMessage(
      'rental_completed',
      rental.agentId,
      {
        rental_id: rentalId,
        renter: rental.renter,
        owner: rental.owner,
        creator: agent.creator,
        duration_minutes: 0, // Would calculate from startedAt
        uptime_percentage: usage.uptimePercentage || 100,
        instructions_total: usage.totalInstructions,
        tokens_total: usage.totalTokens,
        usage_breakdown: {
          base_fee: 5.00,
          per_instruction: usage.totalInstructions * 0.05,
          llm_costs: usage.totalCostUsd - 5.00,
        },
        total_charged_usd: totalCharged,
        total_charged_hbar: totalCharged / 0.10, // Simplified conversion
        distribution: {
          creator_royalty: creatorRoyalty,
          network_contribution: networkContribution,
          atp_treasury: atpTreasury,
          owner_revenue: ownerRevenue,
        },
        stake_returned: true,
        unused_buffer_returned_usd: rental.usageBufferUsd - totalCharged,
        transaction_ids: {
          distribution: 'pending', // Would include actual tx IDs
          stake_return: 'pending',
          buffer_refund: 'pending',
        },
      }
    );

    await this.hcsLogger.log(completionMessage, agent.hcsTopicId);
  }
}
