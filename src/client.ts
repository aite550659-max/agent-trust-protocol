/**
 * ATP Client - Main entry point for the Agent Trust Protocol SDK.
 *
 * Provides access to all ATP functionality through sub-managers:
 * agents, rentals, reputation, disputes, HCS logging, and indexer queries.
 *
 * @example
 * ```typescript
 * const atp = new ATPClient({
 *   network: 'testnet',
 *   operatorId: '0.0.12345',
 *   operatorKey: 'your-private-key',
 * });
 *
 * const agent = await atp.agents.create({
 *   name: 'MyAgent',
 *   soulHash: 'sha256:abc123...',
 *   manifestUri: 'ipfs://Qm...',
 *   pricing: { flashBaseFee: 0.02, standardBaseFee: 5.0, ... }
 * });
 * ```
 */

import { Client, PrivateKey } from '@hashgraph/sdk';
import { ATPConfig } from './types';
import { AgentManager } from './managers/agent';
import { RentalManager } from './managers/rental';
import { ReputationManager } from './managers/reputation';
import { DisputeManager } from './managers/dispute';
import { HCSLogger } from './hcs/logger';
import { Indexer } from './indexer/client';

export class ATPClient {
  private hederaClient: Client;
  private config: ATPConfig;
  private agentCache: Map<string, { owner: string; hcsTopicId: string; creator: string }>;
  private rentalCache: Map<string, any>;
  
  /** Manage ATP agents: create, update pricing, query metadata. */
  public agents: AgentManager;
  /** Manage rentals: initiate, terminate, complete, query status. */
  public rentals: RentalManager;
  /** Query and compute reputation scores from HCS event history. */
  public reputation: ReputationManager;
  /** File and resolve disputes with challenger-funded bonds. */
  public disputes: DisputeManager;
  /** Log structured messages to Hedera Consensus Service. */
  public hcs: HCSLogger;
  /** Query the ATP indexer for agents, rentals, and reputation data. */
  public indexer: Indexer;

  /**
   * Create a new ATP client instance.
   *
   * @param config - ATP configuration including Hedera network, operator ID, and operator key.
   * @throws Error if the network is invalid or operator credentials are malformed.
   */
  constructor(config: ATPConfig) {
    this.config = config;
    this.agentCache = new Map();
    this.rentalCache = new Map();
    
    // Initialize Hedera client
    this.hederaClient = this.createHederaClient();
    
    // Initialize indexer
    this.indexer = new Indexer(this.config);
    
    // Create resolver function
    const resolveAgent = this.resolveAgent.bind(this);
    
    // Initialize managers with resolver
    this.agents = new AgentManager(
      this.hederaClient,
      this.config,
      resolveAgent,
      (meta) => this.cacheAgent(meta.agentId, meta)
    );
    this.rentals = new RentalManager(
      this.hederaClient,
      this.config,
      resolveAgent,
      (rentalId, rental) => this.rentalCache.set(rentalId, rental),
      (rentalId) => this.rentalCache.get(rentalId)
    );
    this.reputation = new ReputationManager(this.hederaClient, this.config);
    this.disputes = new DisputeManager(this.hederaClient, this.config);
    this.hcs = new HCSLogger(this.hederaClient, this.config);
  }

  private createHederaClient(): Client {
    let client: Client;
    
    switch (this.config.network) {
      case 'mainnet':
        client = Client.forMainnet();
        break;
      case 'testnet':
        client = Client.forTestnet();
        break;
      case 'previewnet':
        client = Client.forPreviewnet();
        break;
      default:
        throw new Error(`Invalid network: ${this.config.network}`);
    }
    
    // Detect key type: 0x prefix = ECDSA hex, 302e prefix = DER-encoded
    const keyStr = this.config.operatorKey;
    let operatorKey: PrivateKey;
    if (keyStr.startsWith('0x') || /^[0-9a-f]{64}$/i.test(keyStr)) {
      operatorKey = PrivateKey.fromStringECDSA(keyStr);
    } else if (keyStr.startsWith('302e')) {
      operatorKey = PrivateKey.fromStringDer(keyStr);
    } else {
      operatorKey = PrivateKey.fromStringED25519(keyStr);
    }
    client.setOperator(this.config.operatorId, operatorKey);
    
    return client;
  }

  /**
   * Resolve agent metadata using the resolution chain:
   * 1. Cache (in-memory)
   * 2. Indexer (if available)
   * 3. Mirror node (direct Hedera query)
   *
   * @param agentId - The agent's HTS token ID (e.g., "0.0.12345")
   * @returns Agent metadata with owner, hcsTopicId, and creator
   * @throws Error if agent not found in any source
   */
  public async resolveAgent(agentId: string): Promise<{ owner: string; hcsTopicId: string; creator: string }> {
    // Try cache first
    const cached = this.agentCache.get(agentId);
    if (cached) {
      return cached;
    }

    // Try indexer second
    try {
      const response = await this.indexer.getAgent(agentId);
      if (response.success && response.data) {
        const metadata = {
          owner: response.data.owner,
          hcsTopicId: response.data.hcsTopicId,
          creator: response.data.creator,
        };
        this.agentCache.set(agentId, metadata);
        return metadata;
      }
    } catch (err) {
      // Indexer unavailable, fall through to mirror node
    }

    // Try mirror node third
    try {
      const metadata = await this.queryMirrorNode(agentId);
      this.agentCache.set(agentId, metadata);
      return metadata;
    } catch (err) {
      throw new Error(`Agent not found in cache, indexer, or mirror node: ${agentId} (${err instanceof Error ? err.message : 'unknown error'})`);
    }
  }

  /**
   * Cache agent metadata for faster resolution.
   *
   * @param agentId - The agent's HTS token ID
   * @param metadata - Agent metadata to cache
   */
  public cacheAgent(agentId: string, metadata: { owner: string; hcsTopicId: string; creator: string }): void {
    this.agentCache.set(agentId, {
      owner: metadata.owner,
      hcsTopicId: metadata.hcsTopicId,
      creator: metadata.creator,
    });
  }

  /**
   * Query Hedera mirror node for agent metadata.
   * Fallback when indexer is unavailable.
   *
   * @param agentId - The agent's HTS token ID
   * @returns Agent metadata parsed from NFT and token info
   * @throws Error if mirror node queries fail or metadata is invalid
   */
  private async queryMirrorNode(agentId: string): Promise<{ owner: string; hcsTopicId: string; creator: string }> {
    const baseUrl = this.config.network === 'mainnet'
      ? 'https://mainnet-public.mirrornode.hedera.com'
      : 'https://testnet.mirrornode.hedera.com';

    // Get NFT metadata (contains atp:<topicId>)
    const nftRes = await fetch(`${baseUrl}/api/v1/tokens/${agentId}/nfts/1`);
    if (!nftRes.ok) {
      throw new Error(`Mirror node NFT query failed: ${nftRes.status} ${nftRes.statusText}`);
    }
    const nftData: any = await nftRes.json();
    const metadataBase64 = nftData.metadata;
    if (!metadataBase64) {
      throw new Error('NFT metadata not found in mirror node response');
    }
    const metadataStr = Buffer.from(metadataBase64, 'base64').toString('utf-8');

    // Parse "atp:0.0.XXXXX" format
    const topicMatch = metadataStr.match(/^atp:(0\.0\.\d+)$/);
    if (!topicMatch) {
      throw new Error(`Invalid NFT metadata format: ${metadataStr}`);
    }
    const hcsTopicId = topicMatch[1];

    // Get token info for owner (treasury account)
    const tokenRes = await fetch(`${baseUrl}/api/v1/tokens/${agentId}`);
    if (!tokenRes.ok) {
      throw new Error(`Mirror node token query failed: ${tokenRes.status} ${tokenRes.statusText}`);
    }
    const tokenData: any = await tokenRes.json();
    const owner = tokenData.treasury_account_id;

    // Creator is in custom_fees.royalty_fees[0].collector_account_id
    let creator = owner;
    const royaltyFees = tokenData.custom_fees?.royalty_fees;
    if (Array.isArray(royaltyFees) && royaltyFees.length > 0 && royaltyFees[0].collector_account_id) {
      creator = royaltyFees[0].collector_account_id;
    }

    return { owner, hcsTopicId, creator };
  }

  /**
   * Close all connections and release resources.
   * Call this when done using the client.
   */
  async close(): Promise<void> {
    await this.hederaClient.close();
  }
}
