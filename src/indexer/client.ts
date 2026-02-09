/**
 * Indexer Client - Query ATP state via indexer REST API
 */

import { ATPConfig, IndexerResponse, AgentMetadata, Rental, ReputationScore } from '../types';

export class Indexer {
  private baseUrl: string;

  constructor(private config: ATPConfig) {
    this.baseUrl = config.indexerUrl || 'http://localhost:3000';
  }

  /**
   * Get agent metadata
   */
  async getAgent(agentId: string): Promise<IndexerResponse<AgentMetadata>> {
    return this.get(`/agent/${agentId}`);
  }

  /**
   * Get active rentals for an agent
   */
  async getActiveRentals(agentId: string): Promise<IndexerResponse<Rental[]>> {
    return this.get(`/agent/${agentId}/rentals/active`);
  }

  /**
   * Get rental status
   */
  async getRentalStatus(rentalId: string): Promise<IndexerResponse<Rental>> {
    return this.get(`/rental/${rentalId}/status`);
  }

  /**
   * Get reputation score
   */
  async getReputation(accountId: string): Promise<IndexerResponse<ReputationScore>> {
    return this.get(`/account/${accountId}/reputation`);
  }

  /**
   * Generic GET request
   */
  private async get<T = any>(path: string): Promise<IndexerResponse<T>> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`);
      const data = await response.json() as T & { error?: string };
      return {
        success: response.ok,
        data: response.ok ? (data as T) : undefined,
        error: response.ok ? undefined : data.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
