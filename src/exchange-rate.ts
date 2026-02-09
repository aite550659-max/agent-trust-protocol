/**
 * Exchange Rate Service - Real-time HBAR/USD price fetching
 * 
 * Provides cached, reliable HBAR/USD exchange rates with automatic fallback.
 * Primary: CoinGecko API (free tier, 50 req/min)
 * Fallback: Binance Spot Price API
 * Cache: 5-minute TTL
 * Stale tolerance: 15 minutes
 */

interface ExchangeRateCache {
  rate: number;
  timestamp: number;
  source: 'coingecko' | 'binance' | 'stale';
}

export class ExchangeRateService {
  private cache: ExchangeRateCache | null = null;
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes
  private readonly staleTtlMs = 15 * 60 * 1000; // 15 minutes (max age for stale)
  private readonly minSanePrice = 0.01; // $0.01 minimum (sanity check)
  private readonly maxSanePrice = 10.0; // $10.00 maximum (sanity check)
  private testRate: number | null = null; // Test override (bypasses API calls)
  
  /**
   * Get current HBAR/USD exchange rate.
   * Returns cached value if fresh (<5 min old), otherwise fetches new rate.
   * 
   * @returns Current HBAR price in USD (e.g., 0.28 = $0.28 per HBAR)
   * @throws Error if all sources fail and no stale cache available
   */
  async getRate(): Promise<number> {
    // If test rate is set, return it immediately (for deterministic testing)
    if (this.testRate !== null) {
      return this.testRate;
    }
    
    const now = Date.now();
    
    // Return cached rate if fresh
    if (this.cache && (now - this.cache.timestamp) < this.cacheTtlMs) {
      return this.cache.rate;
    }
    
    // Try to fetch fresh rate
    try {
      // Try CoinGecko first
      const rate = await this.fetchFromCoinGecko();
      this.cache = {
        rate,
        timestamp: now,
        source: 'coingecko'
      };
      return rate;
    } catch (error) {
      console.warn('CoinGecko fetch failed:', error instanceof Error ? error.message : error);
      
      // Try Binance fallback
      try {
        const rate = await this.fetchFromBinance();
        this.cache = {
          rate,
          timestamp: now,
          source: 'binance'
        };
        return rate;
      } catch (fallbackError) {
        console.warn('Binance fetch failed:', fallbackError instanceof Error ? fallbackError.message : fallbackError);
        
        // Use stale cache if available and not too old
        if (this.cache && (now - this.cache.timestamp) < this.staleTtlMs) {
          console.warn(`Using stale rate (${Math.floor((now - this.cache.timestamp) / 60000)} min old)`);
          return this.cache.rate;
        }
        
        // All sources failed, no usable cache
        throw new Error('All exchange rate sources failed and no stale cache available');
      }
    }
  }
  
  /**
   * Fetch HBAR/USD rate from CoinGecko API.
   * Free tier: 50 calls/minute, no API key required.
   * 
   * @returns HBAR price in USD
   * @throws Error if fetch fails or response invalid
   */
  private async fetchFromCoinGecko(): Promise<number> {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd';
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
    
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`CoinGecko API returned ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json() as { 'hedera-hashgraph'?: { usd?: number } };
      const rate = data?.['hedera-hashgraph']?.usd;
      
      if (typeof rate !== 'number' || !isFinite(rate)) {
        throw new Error(`Invalid rate from CoinGecko: ${rate}`);
      }
      
      // Sanity check
      if (rate < this.minSanePrice || rate > this.maxSanePrice) {
        throw new Error(`Rate ${rate} outside sane range [$${this.minSanePrice}, $${this.maxSanePrice}]`);
      }
      
      return rate;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
  
  /**
   * Fetch HBAR/USD rate from Binance Spot Price API.
   * Fallback source, no rate limits on public endpoints.
   * 
   * @returns HBAR price in USD
   * @throws Error if fetch fails or response invalid
   */
  private async fetchFromBinance(): Promise<number> {
    const url = 'https://api.binance.com/api/v3/ticker/price?symbol=HBARUSDT';
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
    
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Binance API returned ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json() as { price?: string };
      const rate = parseFloat(data?.price || '0');
      
      if (typeof rate !== 'number' || !isFinite(rate)) {
        throw new Error(`Invalid rate from Binance: ${data?.price}`);
      }
      
      // Sanity check
      if (rate < this.minSanePrice || rate > this.maxSanePrice) {
        throw new Error(`Rate ${rate} outside sane range [$${this.minSanePrice}, $${this.maxSanePrice}]`);
      }
      
      return rate;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
  
  /**
   * Get cache status (for debugging/monitoring).
   * 
   * @returns Cache info or null if no cache
   */
  getCacheStatus(): { rate: number; ageMs: number; source: string } | null {
    // If test rate is set, return test mode status
    if (this.testRate !== null) {
      return {
        rate: this.testRate,
        ageMs: 0,
        source: 'test'
      };
    }
    
    if (!this.cache) return null;
    
    return {
      rate: this.cache.rate,
      ageMs: Date.now() - this.cache.timestamp,
      source: this.cache.source
    };
  }
  
  /**
   * Clear cache (force refresh on next getRate call).
   */
  clearCache(): void {
    this.cache = null;
  }
  
  /**
   * Set a fixed test rate (bypasses API calls for deterministic testing).
   * 
   * @param rate - Fixed HBAR/USD rate to use (e.g., 0.10 = $0.10 per HBAR)
   * 
   * @example
   * ```typescript
   * import { exchangeRateService } from '@hashgraph/atp-sdk';
   * 
   * // Set deterministic rate for testing
   * exchangeRateService.setTestRate(0.10);
   * 
   * // Run tests...
   * 
   * // Restore real behavior
   * exchangeRateService.clearTestRate();
   * ```
   */
  setTestRate(rate: number): void {
    if (rate < this.minSanePrice || rate > this.maxSanePrice) {
      throw new Error(`Test rate ${rate} outside sane range [$${this.minSanePrice}, $${this.maxSanePrice}]`);
    }
    this.testRate = rate;
  }
  
  /**
   * Clear test rate (restore real API fetching behavior).
   */
  clearTestRate(): void {
    this.testRate = null;
  }
}

/**
 * Singleton instance for convenience.
 * Can be replaced with a custom instance if needed.
 */
export const exchangeRateService = new ExchangeRateService();
