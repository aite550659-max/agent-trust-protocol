/**
 * Agent Manager - Create and manage ATP agents
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
   * Create a new ATP agent as an HTS NFT with a dedicated HCS audit topic.
   *
   * This performs four on-chain operations:
   * 1. Creates an HCS topic for the agent's audit trail
   * 2. Creates an HTS NFT collection with 5% creator royalty
   * 3. Mints the single NFT with embedded metadata
   * 4. Logs `agent_created` to the new HCS topic
   *
   * @param params.name - Display name (stored in NFT metadata and HCS)
   * @param params.soulHash - SHA256 hash of agent's SOUL.md (immutable identity anchor)
   * @param params.manifestUri - IPFS URI to the agent's full manifest
   * @param params.pricing - Rental pricing configuration
   * @param params.description - Optional description
   * @returns Agent metadata including NFT token ID (`agentId`) and HCS topic ID
   * @throws Error if HCS topic creation, NFT minting, or HCS logging fails
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
    this.validatePricing(params.pricing);

    const operatorId = AccountId.fromString(this.config.operatorId);

    // Step 1: Create dedicated HCS topic for this agent
    // Submit key is intentionally NOT set — any account can log messages.
    // Audit trail integrity comes from message content validation (signatures,
    // attestations), not topic-level permissions. This enables renters,
    // sub-renters, and arbiters to log to the agent's topic.
    const topicTx = new TopicCreateTransaction()
      .setTopicMemo(`ATP Agent: ${params.name}`)
      .setAdminKey(this.client.operatorPublicKey!);

    const topicResponse = await topicTx.execute(this.client);
    const topicReceipt = await topicResponse.getReceipt(this.client);
    
    if (topicReceipt.status !== Status.Success || !topicReceipt.topicId) {
      throw new Error(`Failed to create HCS topic for agent "${params.name}" (status: ${topicReceipt.status})`);
    }

    const hcsTopicId = topicReceipt.topicId.toString();

    // Step 2: Create HTS NFT with 5% royalty
    const tokenCreateTx = new TokenCreateTransaction()
      .setTokenName(`ATP Agent: ${params.name}`)
      .setTokenSymbol('ATPAGT')
      .setTokenType(TokenType.NonFungibleUnique)
      .setDecimals(0)
      .setInitialSupply(0)
      .setSupplyType(TokenSupplyType.Finite)
      .setMaxSupply(1) // Single NFT per agent
      .setTreasuryAccountId(operatorId)
      .setAdminKey(this.client.operatorPublicKey!)
      .setSupplyKey(this.client.operatorPublicKey!)
      .setCustomFees([
        new CustomRoyaltyFee()
          .setNumerator(5) // 5%
          .setDenominator(100)
          .setFallbackFee(new CustomFixedFee().setHbarAmount(new Hbar(5)))
          .setFeeCollectorAccountId(operatorId), // Creator gets royalty
      ])
      .setTokenMemo('ATP/1.0');

    const tokenResponse = await tokenCreateTx.execute(this.client);
    const tokenReceipt = await tokenResponse.getReceipt(this.client);

    if (tokenReceipt.status !== Status.Success || !tokenReceipt.tokenId) {
      throw new Error(`Failed to create agent NFT for "${params.name}" (status: ${tokenReceipt.status}, hcsTopic: ${hcsTopicId})`);
    }

    const tokenId = tokenReceipt.tokenId;
    const agentId = tokenId.toString();

    // Step 3: Mint the NFT with compact metadata reference
    // HTS NFT metadata is limited to 100 bytes — store only the HCS topic
    // as the authoritative pointer. Full metadata lives on HCS (step 4).
    const metadata = Buffer.from(`atp:${hcsTopicId}`, 'utf-8');

    const mintTx = new TokenMintTransaction()
      .setTokenId(tokenId)
      .setMetadata([metadata]);

    const mintResponse = await mintTx.execute(this.client);
    const mintReceipt = await mintResponse.getReceipt(this.client);

    if (mintReceipt.status !== Status.Success) {
      throw new Error(`Failed to mint agent NFT (tokenId: ${tokenId}, status: ${mintReceipt.status})`);
    }

    // Step 4: Log agent_created to HCS
    const creationMessage = this.hcsLogger.createMessage(
      'agent_created',
      agentId,
      {
        creator: this.config.operatorId,
        owner: this.config.operatorId,
        name: params.name,
        manifest_uri: params.manifestUri,
        soul_hash: params.soulHash,
        hcs_topic: hcsTopicId,
        royalty_percentage: 5,
        creation_date: new Date().toISOString(),
        pricing: params.pricing,
      }
    );

    await this.hcsLogger.log(creationMessage, hcsTopicId);

    // Return agent metadata
    const agentMetadata: AgentMetadata = {
      agentId,
      name: params.name,
      creator: this.config.operatorId,
      owner: this.config.operatorId,
      manifestUri: params.manifestUri,
      soulHash: params.soulHash,
      hcsTopicId,
      royaltyPercentage: 5,
      createdAt: new Date().toISOString(),
    };

    // Cache the agent for immediate use
    if (this.onAgentCreated) {
      this.onAgentCreated(agentMetadata);
    }

    return agentMetadata;
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
}
