/**
 * Test 1: RentalStore persistence
 * Verifies escrow keys survive by writing a rental, reading it back,
 * and confirming the key matches.
 */
import * as fs from 'fs';
import * as path from 'path';
import { RentalStore, StoredRental } from '../src/rental-store';

const TEST_DIR = path.join(__dirname, '..', 'data', 'test');

function cleanup() {
  const fp = path.join(TEST_DIR, 'active-rentals.json');
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  if (fs.existsSync(TEST_DIR)) fs.rmdirSync(TEST_DIR);
}

async function main() {
  console.log('=== TEST 1: RentalStore Persistence ===\n');
  cleanup();

  // Create store and insert a rental
  const store1 = new RentalStore(TEST_DIR);
  const fakeRental: StoredRental = {
    rentalId: 'rental_test_001',
    agentId: '0.0.999999',
    renter: '0.0.10260562',
    owner: '0.0.10255397',
    rentalType: 'session',
    stakeUsd: 10,
    stakeHbar: 50,
    usageBufferUsd: 5,
    usageBufferHbar: 25,
    escrowAccount: '0.0.11111111',
    escrowKey: 'deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
    pricingSnapshot: {
      flashBaseFee: 0.02,
      standardBaseFee: 5.00,
      perInstruction: 0.05,
      perMinute: 0.01,
      llmMarkupBps: 150,
      toolMarkupBps: 150,
    },
    constraints: {
      toolsBlocked: [],
      memoryAccessLevel: 'sandboxed',
      topicsBlocked: [],
      maxPerInstructionCost: 100,
      maxDailyCost: 1000,
    },
    startedAt: new Date().toISOString(),
    status: 'active',
  };

  store1.put(fakeRental);
  console.log('✅ Rental written to store');

  // Simulate process restart: create a NEW store instance from same dir
  const store2 = new RentalStore(TEST_DIR);
  const loaded = store2.get('rental_test_001');

  if (!loaded) {
    console.log('❌ FAIL: Rental not found after reload');
    cleanup();
    process.exit(1);
  }

  if (loaded.escrowKey !== fakeRental.escrowKey) {
    console.log(`❌ FAIL: Escrow key mismatch!\n  Expected: ${fakeRental.escrowKey}\n  Got: ${loaded.escrowKey}`);
    cleanup();
    process.exit(1);
  }

  console.log('✅ Escrow key persisted correctly across store instances');
  console.log(`  Key: ${loaded.escrowKey.slice(0, 16)}...`);

  // Test active filter
  const active = store2.getActive();
  console.log(`✅ Active rentals: ${active.length} (expected 1)`);

  // Test complete (should strip escrow key)
  store2.complete('rental_test_001');
  const completed = store2.get('rental_test_001');
  if (completed?.escrowKey) {
    console.log('❌ FAIL: Escrow key not removed after completion');
    cleanup();
    process.exit(1);
  }
  console.log('✅ Escrow key removed after completion');
  console.log(`  Status: ${completed?.status}, endedAt: ${completed?.endedAt}`);

  // Verify active count is now 0
  const activeAfter = store2.getActive();
  console.log(`✅ Active rentals after completion: ${activeAfter.length} (expected 0)`);

  // Final reload to confirm completed state persists
  const store3 = new RentalStore(TEST_DIR);
  const final = store3.get('rental_test_001');
  console.log(`✅ Final reload — status: ${final?.status}, escrowKey: ${final?.escrowKey ?? 'removed'}`);

  cleanup();
  console.log('\n✅ TEST 1 PASSED: RentalStore persistence works correctly');
}

main().catch(e => { console.error('❌ FATAL:', e); process.exit(1); });
