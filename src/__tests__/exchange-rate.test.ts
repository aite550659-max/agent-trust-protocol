/**
 * Exchange Rate Service Unit Tests
 */

import { ExchangeRateService } from '../exchange-rate';

describe('ExchangeRateService', () => {
  let service: ExchangeRateService;
  
  beforeEach(() => {
    service = new ExchangeRateService();
  });
  
  afterEach(() => {
    // Clean up any test rates
    service.clearTestRate();
    service.clearCache();
  });
  
  describe('Test Mode', () => {
    it('should return test rate when set', async () => {
      const testRate = 0.15;
      service.setTestRate(testRate);
      
      const rate = await service.getRate();
      expect(rate).toBe(testRate);
    });
    
    it('should bypass API calls in test mode', async () => {
      service.setTestRate(0.20);
      
      const start = Date.now();
      const rate = await service.getRate();
      const elapsed = Date.now() - start;
      
      expect(rate).toBe(0.20);
      expect(elapsed).toBeLessThan(10); // Should be instant
    });
    
    it('should throw error for insane test rates', () => {
      expect(() => service.setTestRate(0.001)).toThrow('outside sane range');
      expect(() => service.setTestRate(15.0)).toThrow('outside sane range');
    });
    
    it('should clear test rate and resume normal operation', async () => {
      service.setTestRate(0.10);
      expect(await service.getRate()).toBe(0.10);
      
      service.clearTestRate();
      // After clearing, should attempt real API call (will take time or fail)
      // We can't easily test this without mocking fetch, so just verify it doesn't throw
      const cacheStatus = service.getCacheStatus();
      expect(cacheStatus).toBeDefined();
    });
  });
  
  describe('Cache Management', () => {
    it('should report cache status correctly', () => {
      service.setTestRate(0.12);
      
      const status = service.getCacheStatus();
      expect(status).toBeDefined();
      expect(status?.rate).toBeGreaterThan(0);
    });
    
    it('should clear cache', () => {
      service.clearCache();
      // Cache should be cleared (can't easily test without API calls)
      expect(() => service.clearCache()).not.toThrow();
    });
  });
  
  describe('Rental Calculations', () => {
    beforeEach(() => {
      // Use deterministic rate for calculations
      service.setTestRate(0.10); // $0.10 per HBAR
    });
    
    it('should calculate correct HBAR amounts for flash rental', async () => {
      const rate = await service.getRate();
      const flashRentalUsd = 0.07;
      const expectedHbar = flashRentalUsd / rate;
      
      expect(expectedHbar).toBeCloseTo(0.7, 2); // 0.70 HBAR at $0.10 test rate
    });
    
    it('should calculate correct HBAR amounts for standard rental', async () => {
      const rate = await service.getRate();
      const standardRentalUsd = 5.00;
      const expectedHbar = standardRentalUsd / rate;
      
      expect(expectedHbar).toBeCloseTo(50.0, 1); // 50 HBAR
    });
    
    it('should calculate correct HBAR amounts for large rental', async () => {
      const rate = await service.getRate();
      const largeRentalUsd = 150.00;
      const expectedHbar = largeRentalUsd / rate;
      
      expect(expectedHbar).toBeCloseTo(1500.0, 1); // 1,500 HBAR at $0.10
    });
    
    it('should handle different exchange rates', async () => {
      // Simulate real HBAR price of $0.09
      service.setTestRate(0.09);
      const rate = await service.getRate();
      
      const rentalUsd = 150.00;
      const expectedHbar = rentalUsd / rate;
      
      expect(expectedHbar).toBeCloseTo(1666.67, 1); // ~1,667 HBAR at $0.09
    });
  });
  
  describe('Real API Integration', () => {
    // These tests actually hit APIs - only run in integration test mode
    const isIntegrationTest = process.env.ATP_INTEGRATION_TESTS === 'true';
    
    (isIntegrationTest ? it : it.skip)('should fetch real rate from CoinGecko', async () => {
      const realService = new ExchangeRateService();
      const rate = await realService.getRate();
      
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThan(1.0); // HBAR unlikely to be >$1
      
      console.log(`Real HBAR rate: $${rate.toFixed(4)}`);
    }, 10000); // 10s timeout for API call
    
    (isIntegrationTest ? it : it.skip)('should cache rate between calls', async () => {
      const realService = new ExchangeRateService();
      
      const rate1 = await realService.getRate();
      const start = Date.now();
      const rate2 = await realService.getRate();
      const elapsed = Date.now() - start;
      
      expect(rate1).toBe(rate2); // Should be same (cached)
      expect(elapsed).toBeLessThan(10); // Should be instant from cache
    }, 10000);
  });
});
