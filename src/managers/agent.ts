/**
 * Agent Manager - Register and monetize ATP agents
 *
 * Two-phase lifecycle:
 *   Phase 1 — register(): Create HCS topic (identity + audit trail). Free, no NFT.
 *   Phase 2 — monetize(): Mint Commerce NFT linked to existing topic. Enables rental/sale.
 *
 * Legacy: create() does both phases in one call (register + monetize).
 */

import {
  Client,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TokenMintTransaction,
  TokenId,
  CustomRoyaltyFee,
  CustomFixedFee,
  Hbar,
  AccountId,
  TopicCreateTransaction,
  Status,
} from '@hashgraph/sdk';
import { ATPConfig, AgentMetadata, PricingConfig } from '../types';
import { HCSLogger } from '../hcs/logger';
import { MINIMUM_PRICING } from '../config';
import { Indexer } from '../indexer/client';

export class AgentManager {
  private hcsLogger: HCSLogger;
  private resolveAgent: (agentId: string) => Promise<{ owner: string; hcsTopicId: string; creator: string }>;
  private onAgentCreated?: (meta: AgentMetadata) => void;

  constructor(
    private client: Client,
    private config: ATPConfig,
    resolveAgent: (agentId: string) => Promise<{ owner: string; hcsTopicId: string; creator: string }>,
    onAgentCreated?: (meta: AgentMetadata) => void
  ) {
    this.hcsLogger = new HCSLogger(client, config);
    this.resolveAgent = resolveAgent;
    this.onAgentCreated = onAgentCreated;
  }

  /**
   * Phase 1: Register an agent identity (HCS topic only, no NFT).
   *
   * Creates an HCS topic and logs `agent_registered`. The agent can operate
   * indefinitely in this state — building reputation, logging actions, proving
   * integrity. Call monetize() later to mint a Commerce NFT for rental/sale.
   *
   * @param params.name - Display name
   * @param params.soulHash - SHA256 hash of agent's SOUL.md
   * @param params.manifestUri - IPFS URI to the agent's full manifest
   * @param params.capabilities - Agent capabilities list
   * @returns Agent metadata with hcsTopicId as the agentId
   *
   * @example
   * ```typescript
   * const agent = await atp.agents.register({
   *   name: 'Aite',
   *   soulHash: 'sha256:abc123...',
   *   manifestUri: 'ipfs://QmXyz...',
   *   capabilities: ['research', 'writing', 'coding']
   * });
   * // agent.agentId === agent.hcsTopicId (Phase 1)
   * ```
   */
  async register(params: {
    name: string;
    soulHash: string;
    manifestUri: string;
    capabilities?: string[];
    description?: string;
    soulImmutable?: boolean;
    lineage?: string;
  }): Promise<AgentMetadata> {
    // Input validation
    if (!params.name || params.name.trim().length === 0) {
      throw new Error('Agent name is required');
    }
    if (params.name.length > 255) {
      throw new Error(`Agent name too long: ${params.name.length} chars (max 255)`);
    }
    if (!params.soulHash || !/^sha256:[a-f0-9]{64}$/.test(params.soulHash)) {
      throw new Error(`Invalid soulHash format: expected "sha256:<64 hex chars>", got "${params.soulHash?.slice(0, 20)}..."`);
    }
    if (!params.manifestUri || !params.manifestUri.startsWith('ipfs://')) {
      throw new Error(`Invalid manifestUri: must start with "ipfs://", got "${params.manifestUri?.slice(0, 30)}"`);
    }
    if (params.lineage) {
      this.validateEntityId(params.lineage, 'lineage');
    }

    // Create dedicated HCS topic (open submit key for multi-party logging)
    const topicTx = new TopicCreateTransaction()
      .setTopicMemo(`ATP Agent: ${params.name}`)
      .setAdminKey(this.client.operatorPublicKey!);

    const topicResponse = await topicTx.execute(this.client);
    const topicReceipt = await topicResponse.getReceipt(this.client);

    if (topicReceipt.status !== Status.Success || !topicReceipt.topicId) {
      throw new Error(`Failed to create HCS topic for agent "${params.name}" (status: ${topicReceipt.status})`);
    }

    const hcsTopicId = topicReceipt.topicId.toString();

    // Log agent_registered to HCS (Phase 1 — identity only)
    const registrationMessage = this.hcsLogger.createMessage(
      'agent_registered',
      hcsTopicId, // agentId = topicId in Phase 1
      {
        creator: this.config.operatorId,
        owner: this.config.operatorId,
        name: params.name,
        manifest_uri: params.manifestUri,
        soul_hash: params.soulHash,
        soul_immutable: params.soulImmutable || false,
        lineage: params.lineage || null,
        hcs_topic: hcsTopicId,
        capabilities: params.capabilities || [],
        creation_date: new Date().toISOString(),
      }
    );

    await this.hcsLogger.log(registrationMessage, hcsTopicId);

    const agentMetadata: AgentMetadata = {
      agentId: hcsTopicId, // In Phase 1, agentId IS the topic
      name: params.name,
      creator: this.config.operatorId,
      owner: this.config.operatorId,
      manifestUri: params.manifestUri,
      soulHash: params.soulHash,
      hcsTopicId,
      royaltyPercentage: 5,
      createdAt: new Date().toISOString(),
    };

    if (this.onAgentCreated) {
      this.onAgentCreated(agentMetadata);
    }

    return agentMetadata;
  }

  /**
   * Phase 2: Monetize a registered agent by minting a Commerce NFT.
   *
   * Links an HTS NFT to the agent's existing HCS topic. Enables rental and sale.
   * Logs `agent_monetized` to HCS with pricing configuration.
   *
   * @param params.hcsTopicId - The agent's existing HCS topic from register()
   * @param params.name - Agent name (for NFT metadata)
   * @param params.pricing - Rental pricing configuration
   * @returns Updated agent metadata with NFT token ID
   *
   * @example
   * ```typescript
   * // First register (Phase 1)
   * const agent = await atp.agents.register({ ... });
   *
   * // Later, when ready to rent out (Phase 2)
   * const monetized = await atp.agents.monetize({
   *   hcsTopicId: agent.hcsTopicId,
   *   name: agent.name,
   *   pricing: { flashBaseFee: 0.02, standardBaseFee: 5.0, ... }
   * });
   * // monetized.agentId === NFT token ID (used for rentals)
   * ```
   */
  async monetize(params: {
    hcsTopicId: string;
    name: string;
    pricing: PricingConfig;
  }): Promise<AgentMetadata & { nftTokenId: string }> {
    this.validateEntityId(params.hcsTopicId, 'hcsTopicId');
    this.validatePricing(params.pricing);

    const operatorId = AccountId.fromString(this.config.operatorId);

    // Create HTS NFT with 5% creator royalty
    const tokenCreateTx = new TokenCreateTransaction()
      .setTokenName(`ATP Agent: ${params.name}`)
      .setTokenSymbol('ATPAGT')
      .setTokenType(TokenType.NonFungibleUnique)
      .setDecimals(0)
      .setInitialSupply(0)
      .setSupplyType(TokenSupplyType.Finite)
      .setMaxSupply(1)
      .setTreasuryAccountId(operatorId)
      .setAdminKey(this.client.operatorPublicKey!)
      .setSupplyKey(this.client.operatorPublicKey!)
      .setCustomFees([
        new CustomRoyaltyFee()
          .setNumerator(5)
          .setDenominator(100)
          .setFallbackFee(new CustomFixedFee().setHbarAmount(new Hbar(5)))
          .setFeeCollectorAccountId(operatorId),
      ])
      .setTokenMemo('ATP/1.0');

    const tokenResponse = await tokenCreateTx.execute(this.client);
    const tokenReceipt = await tokenResponse.getReceipt(this.client);

    if (tokenReceipt.status !== Status.Success || !tokenReceipt.tokenId) {
      throw new Error(`Failed to create Commerce NFT for "${params.name}" (status: ${tokenReceipt.status})`);
    }

    const tokenId = tokenReceipt.tokenId;
    const nftTokenId = tokenId.toString();

    // Mint NFT with compact pointer to HCS topic
    const metadata = Buffer.from(`atp:${params.hcsTopicId}`, 'utf-8');
    const mintTx = new TokenMintTransaction()
      .setTokenId(tokenId)
      .setMetadata([metadata]);

    const mintResponse = await mintTx.execute(this.client);
    const mintReceipt = await mintResponse.getReceipt(this.client);

    if (mintReceipt.status !== Status.Success) {
      throw new Error(`Failed to mint Commerce NFT (tokenId: ${tokenId}, status: ${mintReceipt.status})`);
    }

    // Log agent_monetized to HCS
    const monetizeMessage = this.hcsLogger.createMessage(
      'agent_monetized',
      params.hcsTopicId,
      {
        nft_token_id: nftTokenId,
        owner: this.config.operatorId,
        pricing: params.pricing,
        effective_date: new Date().toISOString(),
      }
    );

    await this.hcsLogger.log(monetizeMessage, params.hcsTopicId);

    const agentMetadata = {
      agentId: nftTokenId, // After monetization, NFT token ID is used for rentals
      nftTokenId,
      name: params.name,
      creator: this.config.operatorId,
      owner: this.config.operatorId,
      manifestUri: '',
      soulHash: '',
      hcsTopicId: params.hcsTopicId,
      royaltyPercentage: 5,
      createdAt: new Date().toISOString(),
    };

    if (this.onAgentCreated) {
      this.onAgentCreated(agentMetadata);
    }

    return agentMetadata;
  }

  /**
   * Create a new ATP agent (convenience method — runs register + monetize in one call).
   *
   * This performs five on-chain operations:
   * 1. Creates an HCS topic (Phase 1 — identity)
   * 2. Logs `agent_registered` to HCS
   * 3. Creates an HTS NFT with 5% creator royalty (Phase 2 — commerce)
   * 4. Mints the NFT with embedded metadata pointer
   * 5. Logs `agent_monetized` to HCS with pricing
   *
   * @param params.name - Display name
   * @param params.soulHash - SHA256 hash of agent's SOUL.md
   * @param params.manifestUri - IPFS URI to the agent's full manifest
   * @param params.pricing - Rental pricing configuration
   * @returns Agent metadata including NFT token ID and HCS topic ID
   *
   * @example
   * ```typescript
   * const agent = await atp.agents.create({
   *   name: 'Aite',
   *   soulHash: 'sha256:abc123...',
   *   manifestUri: 'ipfs://QmXyz...',
   *   pricing: { flashBaseFee: 0.02, standardBaseFee: 5.0, perInstruction: 0.05, perMinute: 0.01, llmMarkupBps: 150, toolMarkupBps: 150 }
   * });
   * ```
   */
  async create(params: {
    name: string;
    soulHash: string;
    manifestUri: string;
    pricing: PricingConfig;
    description?: string;
  }): Promise<AgentMetadata> {
    // Phase 1: Register identity
    const registered = await this.register({
      name: params.name,
      soulHash: params.soulHash,
      manifestUri: params.manifestUri,
      description: params.description,
    });

    // Phase 2: Monetize
    const monetized = await this.monetize({
      hcsTopicId: registered.hcsTopicId,
      name: params.name,
      pricing: params.pricing,
    });

    // Return combined metadata (agentId = NFT token ID for backward compat)
    return {
      ...registered,
      agentId: monetized.nftTokenId,
    };
  }

  /**
   * Update rental pricing for an agent. Only callable by the agent's owner.
   * Logs `agent_pricing_update` to the agent's HCS topic.
   *
   * @param agentId - The agent's HTS token ID (e.g., "0.0.12345")
   * @param pricing - New pricing configuration
   * @throws Error if agent not found or caller is not the owner
   */
  /** Validate pricing fields are positive numbers within sane bounds. */
  private validatePricing(pricing: PricingConfig): void {
    if (!pricing) throw new Error('Pricing configuration is required');
    const fields: (keyof PricingConfig)[] = [
      'flashBaseFee', 'standardBaseFee', 'perInstruction', 'perMinute', 'llmMarkupBps', 'toolMarkupBps'
    ];
    for (const field of fields) {
      const val = pricing[field];
      if (typeof val !== 'number' || !isFinite(val) || val < 0) {
        throw new Error(`Invalid pricing.${field}: must be a non-negative number, got ${val}`);
      }
    }
    
    // Enforce minimum pricing (prevents spam, ensures economic sustainability)
    if (pricing.flashBaseFee < MINIMUM_PRICING.flashBaseFee) {
      throw new Error(`flashBaseFee must be at least $${MINIMUM_PRICING.flashBaseFee.toFixed(2)} (got $${pricing.flashBaseFee.toFixed(2)})`);
    }
    if (pricing.standardBaseFee < MINIMUM_PRICING.standardBaseFee) {
      throw new Error(`standardBaseFee must be at least $${MINIMUM_PRICING.standardBaseFee.toFixed(2)} (got $${pricing.standardBaseFee.toFixed(2)})`);
    }
    
    if (pricing.llmMarkupBps > 10000 || pricing.toolMarkupBps > 10000) {
      throw new Error('Markup basis points cannot exceed 10000 (100%)');
    }
  }

  /** Validate a Hedera entity ID format (e.g. "0.0.12345"). */
  private validateEntityId(id: string, label: string): void {
    if (!id || !/^\d+\.\d+\.\d+$/.test(id)) {
      throw new Error(`Invalid ${label}: expected format "0.0.NNNNN", got "${id}"`);
    }
  }

  async updatePricing(agentId: string, pricing: PricingConfig): Promise<void> {
    this.validateEntityId(agentId, 'agentId');
    this.validatePricing(pricing);

    // Get agent metadata using resolver
    const agent = await this.resolveAgent(agentId);

    // Verify caller is owner
    if (agent.owner !== this.config.operatorId) {
      throw new Error(`Only agent owner can update pricing (agent: ${agentId}, owner: ${agent.owner}, caller: ${this.config.operatorId})`);
    }

    // Log pricing update to HCS
    const updateMessage = this.hcsLogger.createMessage(
      'agent_pricing_update',
      agentId,
      {
        owner: this.config.operatorId,
        previous_pricing: {}, // Would need to fetch from indexer
        new_pricing: pricing,
        effective_date: new Date().toISOString(),
      }
    );

    await this.hcsLogger.log(updateMessage, agent.hcsTopicId);
  }

  /**
   * Retrieve agent metadata using the resolver chain.
   *
   * @param agentId - The agent's HTS token ID (e.g., "0.0.12345")
   * @returns Agent metadata including owner, creator, and HCS topic
   * @throws Error if agent not found
   */
  async get(agentId: string): Promise<{ owner: string; hcsTopicId: string; creator: string }> {
    this.validateEntityId(agentId, 'agentId');
    return await this.resolveAgent(agentId);
  }

  /**
   * Update the agent's soul hash (Phase 1 — soul evolution).
   *
   * Logs `soul_updated` to the agent's HCS topic with old hash, new hash, and reason.
   * Rejected if:
   * - Caller is not the owner
   * - Agent has `soul_immutable: true`
   * - Agent has active rentals (soul locked during rental)
   *
   * @param params.agentId - The agent's ID (HCS topic or NFT token ID)
   * @param params.oldHash - Current soul hash (must match latest on HCS)
   * @param params.newHash - New SHA-256 hash of updated SOUL.md
   * @param params.reason - Human-readable explanation of what changed
   * @throws Error if agent not found, not owner, immutable, or has active rentals
   *
   * @example
   * ```typescript
   * await atp.agents.updateSoul({
   *   agentId: '0.0.10261370',
   *   oldHash: 'sha256:abc123...',
   *   newHash: 'sha256:def456...',
   *   reason: 'Added rental boundaries and communication preferences'
   * });
   * ```
   */
  async updateSoul(params: {
    agentId: string;
    oldHash: string;
    newHash: string;
    reason: string;
  }): Promise<void> {
    this.validateEntityId(params.agentId, 'agentId');

    if (!params.oldHash || !/^sha256:[a-f0-9]{64}$/.test(params.oldHash)) {
      throw new Error(`Invalid oldHash format: expected "sha256:<64 hex chars>"`);
    }
    if (!params.newHash || !/^sha256:[a-f0-9]{64}$/.test(params.newHash)) {
      throw new Error(`Invalid newHash format: expected "sha256:<64 hex chars>"`);
    }
    if (!params.reason || params.reason.trim().length === 0) {
      throw new Error('Reason is required for soul updates');
    }
    if (params.oldHash === params.newHash) {
      throw new Error('oldHash and newHash are identical — no change detected');
    }

    // Resolve agent and verify ownership
    const agent = await this.resolveAgent(params.agentId);
    if (agent.owner !== this.config.operatorId) {
      throw new Error(`Only agent owner can update soul (agent: ${params.agentId}, owner: ${agent.owner}, caller: ${this.config.operatorId})`);
    }

    // Note: soul_immutable and active rental checks would require reading HCS history
    // or querying the indexer. For now, log the message — indexers will flag invalid
    // soul_updated messages for immutable agents or agents with active rentals.
    // Full enforcement requires indexer integration (Phase 2 hardening).

    const updateMessage = this.hcsLogger.createMessage(
      'soul_updated',
      params.agentId,
      {
        old_hash: params.oldHash,
        new_hash: params.newHash,
        reason: params.reason,
        updated_by: this.config.operatorId,
        timestamp: new Date().toISOString(),
      }
    );

    await this.hcsLogger.log(updateMessage, agent.hcsTopicId);
  }
}
