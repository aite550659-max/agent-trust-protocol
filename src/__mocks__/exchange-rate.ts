/**
 * Mock Exchange Rate Service for Testing
 * Provides deterministic HBAR/USD rates for test consistency
 */

export class ExchangeRateService {
  private mockRate: number = 0.10; // $0.10 per HBAR (matches test assumptions)
  private cache: { rate: number; timestamp: number; source: string } | null = null;
  
  /**
   * Set a custom rate for testing
   */
  setMockRate(rate: number): void {
    this.mockRate = rate;
    this.cache = {
      rate,
      timestamp: Date.now(),
      source: 'mock'
    };
  }
  
  /**
   * Get the mocked rate (instant, no API calls)
   */
  async getRate(): Promise<number> {
    return this.mockRate;
  }
  
  /**
   * Get cache status (for test verification)
   */
  getCacheStatus(): { rate: number; ageMs: number; source: string } | null {
    if (!this.cache) {
      return {
        rate: this.mockRate,
        ageMs: 0,
        source: 'mock'
      };
    }
    return {
      rate: this.cache.rate,
      ageMs: Date.now() - this.cache.timestamp,
      source: this.cache.source
    };
  }
  
  /**
   * Clear cache (no-op in mock, but maintains interface)
   */
  clearCache(): void {
    this.cache = null;
  }
}

/**
 * Singleton mock instance
 */
export const exchangeRateService = new ExchangeRateService();
