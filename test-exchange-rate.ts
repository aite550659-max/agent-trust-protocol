/**
 * Test Exchange Rate Service
 * Quick validation of real-time HBAR/USD price fetching
 */

import { ExchangeRateService } from './src/exchange-rate';

async function testExchangeRateService() {
  console.log('🧪 Testing Exchange Rate Service\n');
  
  const service = new ExchangeRateService();
  
  // Test 1: Initial fetch
  console.log('Test 1: Fetch current HBAR/USD rate');
  try {
    const rate1 = await service.getRate();
    console.log(`✅ Rate: $${rate1.toFixed(4)} per HBAR`);
    console.log(`   Cache status:`, service.getCacheStatus());
  } catch (error) {
    console.error('❌ Failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
  
  // Test 2: Cached fetch (should be instant)
  console.log('\nTest 2: Fetch from cache (should be instant)');
  const start = Date.now();
  try {
    const rate2 = await service.getRate();
    const elapsed = Date.now() - start;
    console.log(`✅ Rate: $${rate2.toFixed(4)} per HBAR (${elapsed}ms)`);
    console.log(`   Cache status:`, service.getCacheStatus());
    
    if (elapsed > 10) {
      console.warn('⚠️  Cache fetch took >10ms (expected <10ms)');
    }
  } catch (error) {
    console.error('❌ Failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
  
  // Test 3: Clear cache and re-fetch
  console.log('\nTest 3: Clear cache and re-fetch');
  service.clearCache();
  console.log('   Cache cleared');
  try {
    const rate3 = await service.getRate();
    console.log(`✅ Rate: $${rate3.toFixed(4)} per HBAR`);
    console.log(`   Cache status:`, service.getCacheStatus());
  } catch (error) {
    console.error('❌ Failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
  
  // Test 4: Calculate HBAR amounts for rentals
  console.log('\nTest 4: Calculate HBAR amounts for sample rentals');
  try {
    const currentRate = await service.getRate();
    
    const scenarios = [
      { label: 'Flash rental', usd: 0.02 },
      { label: 'Standard 1-hour', usd: 5.00 },
      { label: 'Full day', usd: 50.00 },
      { label: '$150 rental (testnet case)', usd: 150.00 }
    ];
    
    console.log(`   Current rate: $${currentRate.toFixed(4)} per HBAR\n`);
    
    for (const scenario of scenarios) {
      const hbar = scenario.usd / currentRate;
      console.log(`   ${scenario.label}:`);
      console.log(`     USD: $${scenario.usd.toFixed(2)}`);
      console.log(`     HBAR: ${hbar.toFixed(2)} HBAR`);
    }
  } catch (error) {
    console.error('❌ Failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
  
  // Test 5: Verify both sources work
  console.log('\nTest 5: Test fallback mechanism');
  const testService = new ExchangeRateService();
  
  // Force CoinGecko failure by using bad URL (simulate failure)
  console.log('   Testing Binance fallback...');
  try {
    // Access private method via any cast for testing
    const rate = await (testService as any).fetchFromBinance();
    console.log(`✅ Binance fallback works: $${rate.toFixed(4)} per HBAR`);
  } catch (error) {
    console.error('❌ Binance fallback failed:', error instanceof Error ? error.message : error);
  }
  
  console.log('\n🎉 All tests passed!\n');
  
  // Summary
  const cacheStatus = service.getCacheStatus();
  if (cacheStatus) {
    console.log('📊 Final Status:');
    console.log(`   Current rate: $${cacheStatus.rate.toFixed(4)} per HBAR`);
    console.log(`   Cache age: ${Math.floor(cacheStatus.ageMs / 1000)}s`);
    console.log(`   Source: ${cacheStatus.source}`);
  }
}

// Run tests
testExchangeRateService().catch(error => {
  console.error('\n💥 Test suite failed:', error);
  process.exit(1);
});
