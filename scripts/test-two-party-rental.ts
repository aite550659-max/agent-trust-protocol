/**
 * Test 2: True Two-Party Rental
 * 
 * Creates a fresh renter account with its own key, then runs the full
 * rental lifecycle: renter initiates → escrow funded → complete → settlement
 * 
 * Proves: owner and renter are cryptographically distinct parties.
 */

import {
  Client,
  PrivateKey,
  AccountCreateTransaction,
  TransferTransaction,
  AccountBalanceQuery,
  TopicCreateTransaction,
  Hbar,
  AccountId,
  Status,
} from '@hashgraph/sdk';
import { execSync } from 'child_process';
import { RentalManager } from '../src/managers/rental';
import { exchangeRateService } from '../src/exchange-rate';
import { ATPConfig } from '../src/types';

const OWNER_ACCOUNT = '0.0.10255397';
const AGENT_TOPIC = '0.0.10261370';
const CREATOR_ACCOUNT = OWNER_ACCOUNT; // Aite is both owner and creator
const TREASURY = '0.0.8332371';

function getOwnerKey(): string {
  return execSync('security find-generic-password -s "aite-private-key" -a "hedera" -w', { encoding: 'utf8' }).trim();
}

async function getBalance(client: Client, accountId: string): Promise<number> {
  const balance = await new AccountBalanceQuery().setAccountId(accountId).execute(client);
  return balance.hbars.toTinybars().toNumber() / 1e8;
}

async function main() {
  console.log('=== TEST 2: TRUE TWO-PARTY RENTAL ===\n');

  const ownerKey = PrivateKey.fromStringECDSA(getOwnerKey());
  const ownerClient = Client.forMainnet().setOperator(OWNER_ACCOUNT, ownerKey);

  // Step 1: Create a fresh renter account with its own ED25519 key
  console.log('Step 1: Creating fresh renter account...');
  const renterKey = PrivateKey.generateED25519();
  const renterCreateTx = await new AccountCreateTransaction()
    .setKey(renterKey)
    .setInitialBalance(new Hbar(0))
    .execute(ownerClient);
  const renterReceipt = await renterCreateTx.getReceipt(ownerClient);
  const renterAccount = renterReceipt.accountId!.toString();
  console.log(`  ✅ Renter account: ${renterAccount}`);
  console.log(`  Renter key: ${renterKey.toStringRaw().slice(0, 16)}... (ED25519)`);

  // Step 2: Fund renter with 5 HBAR (enough for stake + buffer + fees)
  console.log('\nStep 2: Funding renter...');
  const fundTx = await new TransferTransaction()
    .addHbarTransfer(OWNER_ACCOUNT, new Hbar(-5))
    .addHbarTransfer(renterAccount, new Hbar(5))
    .execute(ownerClient);
  await fundTx.getReceipt(ownerClient);
  console.log(`  ✅ Funded ${renterAccount} with 5 HBAR`);

  // Capture starting balances
  const balancesBefore: Record<string, number> = {};
  for (const [name, id] of [['Owner', OWNER_ACCOUNT], ['Renter', renterAccount], ['Treasury', TREASURY]]) {
    balancesBefore[name] = await getBalance(ownerClient, id);
    console.log(`  ${name} (${id}): ${balancesBefore[name].toFixed(4)} HBAR`);
  }

  // Step 3: Create an open-submit HCS topic for this test
  console.log('\nStep 3: Creating open-submit HCS topic for test...');
  const topicTx = await new TopicCreateTransaction()
    .setTopicMemo('ATP Test 2: Two-Party Rental')
    .execute(ownerClient);
  const topicReceipt = await topicTx.getReceipt(ownerClient);
  const testTopic = topicReceipt.topicId!.toString();
  console.log(`  ✅ Test topic: ${testTopic} (no submit key — anyone can write)`);

  // Step 4: Renter initiates rental using their own client
  console.log('\nStep 4: Renter initiates rental...');
  const renterClient = Client.forMainnet().setOperator(renterAccount, renterKey);

  const renterConfig: ATPConfig = {
    network: 'mainnet',
    operatorId: renterAccount,
    operatorKey: renterKey.toStringRaw(),
    indexerUrl: '',
  };

  const resolveAgent = async (_agentId: string) => ({
    owner: OWNER_ACCOUNT,
    hcsTopicId: testTopic,
    creator: CREATOR_ACCOUNT,
  });

  const rentalManager = new RentalManager(
    renterClient,
    renterConfig,
    resolveAgent,
    '/tmp/atp-test2-rentals',
  );

  const rental = await rentalManager.initiate({
    agentId: '0.0.99999', // Placeholder agent ID
    type: 'flash',
    stakeUsd: 0.05,
    bufferUsd: 0.05,
    agentMetadata: { owner: OWNER_ACCOUNT, hcsTopicId: testTopic },
  });

  console.log(`  ✅ Rental initiated: ${rental.rentalId}`);
  console.log(`  Escrow: ${rental.escrowAccount}`);
  console.log(`  Renter: ${rental.renter} (should be ${renterAccount})`);
  console.log(`  Owner: ${rental.owner} (should be ${OWNER_ACCOUNT})`);
  console.log(`  Stake: ${rental.stakeHbar.toFixed(4)} HBAR ($${rental.stakeUsd})`);
  console.log(`  Buffer: ${rental.usageBufferHbar.toFixed(4)} HBAR ($${rental.usageBufferUsd})`);

  // Verify two-party: renter ≠ owner
  if (rental.renter === rental.owner) {
    console.log('  ❌ FAIL: renter === owner (not a true two-party test!)');
    renterClient.close();
    ownerClient.close();
    process.exit(1);
  }
  console.log('  ✅ CONFIRMED: renter ≠ owner');

  // Step 4: Verify escrow key persisted in store
  console.log('\nStep 5: Checking RentalStore persistence...');
  const store = rentalManager.getStore();
  const stored = store.get(rental.rentalId);
  if (!stored?.escrowKey) {
    console.log('  ❌ FAIL: escrow key not in store');
    process.exit(1);
  }
  console.log(`  ✅ Escrow key persisted: ${stored.escrowKey.slice(0, 16)}...`);

  // Step 5: Complete rental — settlement distributes from escrow
  console.log('\nStep 6: Completing rental (settlement)...');
  try {
    await rentalManager.complete(rental.rentalId, {
      totalInstructions: 1,
      totalTokens: 500,
      totalCostUsd: 0.03,
    });
    console.log('  ✅ Settlement executed successfully');
  } catch (err: any) {
    console.log(`  ❌ Settlement failed: ${err.message}`);
    renterClient.close();
    ownerClient.close();
    process.exit(1);
  }

  // Step 6: Check final balances
  console.log('\nStep 7: Final balances...');
  for (const [name, id] of [['Owner', OWNER_ACCOUNT], ['Renter', renterAccount], ['Treasury', TREASURY]]) {
    const after = await getBalance(ownerClient, id);
    const diff = after - balancesBefore[name];
    console.log(`  ${name}: ${after.toFixed(4)} HBAR (${diff >= 0 ? '+' : ''}${diff.toFixed(4)})`);
  }

  // Step 7: Verify store marked completed and key removed
  const final = store.get(rental.rentalId);
  console.log(`\nStep 8: Store state — status: ${final?.status}, escrowKey: ${final?.escrowKey ?? 'removed'}`);
  if (final?.status !== 'completed') {
    console.log('  ❌ FAIL: rental not marked completed');
    process.exit(1);
  }
  if (final?.escrowKey) {
    console.log('  ❌ FAIL: escrow key not cleaned up');
    process.exit(1);
  }
  console.log('  ✅ Store correctly updated');

  // Store renter key in keychain for future reference
  try {
    execSync(`security add-generic-password -s "atp-test-renter-${renterAccount}" -a "hedera" -w "${renterKey.toStringRaw()}" -U`);
    console.log(`\n📝 Renter key saved to keychain: atp-test-renter-${renterAccount}`);
  } catch {
    console.log(`\n⚠️ Could not save renter key to keychain`);
  }

  renterClient.close();
  ownerClient.close();
  console.log('\n✅ TEST 2 PASSED: True two-party rental with distinct keys');
}

main().catch(e => { console.error('❌ FATAL:', e.message); process.exit(1); });
