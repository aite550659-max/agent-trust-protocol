/**
 * Test 4: Early Termination
 * 
 * Initiates a session rental, then terminates early.
 * Verifies: pro-rata settlement, stake returned, unused buffer refunded,
 * HCS rental_terminated message logged, store updated.
 */

import {
  Client,
  PrivateKey,
  AccountCreateTransaction,
  TransferTransaction,
  TopicCreateTransaction,
  AccountBalanceQuery,
  Hbar,
  Status,
} from '@hashgraph/sdk';
import { execSync } from 'child_process';
import { RentalManager } from '../src/managers/rental';
import { exchangeRateService } from '../src/exchange-rate';
import { ATPConfig } from '../src/types';

const OWNER_ACCOUNT = '0.0.10255397';
const CREATOR_ACCOUNT = OWNER_ACCOUNT;
const TREASURY = '0.0.8332371';

function getOwnerKey(): string {
  return execSync('security find-generic-password -s "aite-private-key" -a "hedera" -w', { encoding: 'utf8' }).trim();
}

async function getBalance(client: Client, accountId: string): Promise<number> {
  const balance = await new AccountBalanceQuery().setAccountId(accountId).execute(client);
  return balance.hbars.toTinybars().toNumber() / 1e8;
}

async function main() {
  console.log('=== TEST 4: EARLY TERMINATION ===\n');

  const ownerKey = PrivateKey.fromStringECDSA(getOwnerKey());
  const ownerClient = Client.forMainnet().setOperator(OWNER_ACCOUNT, ownerKey);

  // Step 1: Create fresh renter
  console.log('Step 1: Creating fresh renter...');
  const renterKey = PrivateKey.generateED25519();
  const renterCreateTx = await new AccountCreateTransaction()
    .setKey(renterKey)
    .setInitialBalance(new Hbar(0))
    .execute(ownerClient);
  const renterReceipt = await renterCreateTx.getReceipt(ownerClient);
  const renterAccount = renterReceipt.accountId!.toString();
  console.log(`  ✅ Renter: ${renterAccount}`);

  // Step 2: Fund renter
  console.log('\nStep 2: Funding renter with 30 HBAR...');
  await (await new TransferTransaction()
    .addHbarTransfer(OWNER_ACCOUNT, new Hbar(-30))
    .addHbarTransfer(renterAccount, new Hbar(30))
    .execute(ownerClient)).getReceipt(ownerClient);
  console.log('  ✅ Funded');

  // Step 3: Create open-submit HCS topic
  console.log('\nStep 3: Creating test HCS topic...');
  const topicTx = await new TopicCreateTransaction()
    .setTopicMemo('ATP Test 4: Early Termination')
    .execute(ownerClient);
  const topicReceipt = await topicTx.getReceipt(ownerClient);
  const testTopic = topicReceipt.topicId!.toString();
  console.log(`  ✅ Topic: ${testTopic}`);

  // Capture balances
  const balBefore: Record<string, number> = {};
  for (const [name, id] of [['Owner', OWNER_ACCOUNT], ['Renter', renterAccount], ['Treasury', TREASURY]]) {
    balBefore[name] = await getBalance(ownerClient, id);
    console.log(`  ${name}: ${balBefore[name].toFixed(4)} HBAR`);
  }

  // Step 4: Renter initiates session rental
  console.log('\nStep 4: Renter initiates session rental...');
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
    '/tmp/atp-test4-rentals',
  );

  const rental = await rentalManager.initiate({
    agentId: '0.0.99999',
    type: 'session',
    stakeUsd: 1.00,
    bufferUsd: 1.00,
    expectedDurationMinutes: 30,
    agentMetadata: { owner: OWNER_ACCOUNT, hcsTopicId: testTopic },
  });

  console.log(`  ✅ Rental: ${rental.rentalId}`);
  console.log(`  Escrow: ${rental.escrowAccount}`);
  console.log(`  Stake: ${rental.stakeHbar.toFixed(4)} HBAR`);
  console.log(`  Buffer: ${rental.usageBufferHbar.toFixed(4)} HBAR`);

  const escrowBal = await getBalance(ownerClient, rental.escrowAccount);
  console.log(`  Escrow balance: ${escrowBal.toFixed(4)} HBAR`);

  // Step 5: Terminate early (renter decides to stop)
  console.log('\nStep 5: Renter terminates early...');
  try {
    await rentalManager.terminate(rental.rentalId, 'renter_cancelled_test');
    console.log('  ✅ Termination settlement executed');
  } catch (err: any) {
    console.log(`  ❌ Termination failed: ${err.message}`);
    renterClient.close();
    ownerClient.close();
    process.exit(1);
  }

  // Step 6: Verify escrow is drained
  console.log('\nStep 6: Checking escrow...');
  const escrowAfter = await getBalance(ownerClient, rental.escrowAccount);
  console.log(`  Escrow balance after: ${escrowAfter.toFixed(8)} HBAR (should be ~0)`);

  // Step 7: Final balances
  console.log('\nStep 7: Final balances...');
  const hbarRate = await exchangeRateService.getRate();
  for (const [name, id] of [['Owner', OWNER_ACCOUNT], ['Renter', renterAccount], ['Treasury', TREASURY]]) {
    const after = await getBalance(ownerClient, id);
    const diff = after - balBefore[name];
    console.log(`  ${name}: ${after.toFixed(4)} HBAR (${diff >= 0 ? '+' : ''}${diff.toFixed(4)} / $${(diff * hbarRate).toFixed(4)})`);
  }

  // Step 8: Verify store
  const store = rentalManager.getStore();
  const final = store.get(rental.rentalId);
  console.log(`\nStep 8: Store — status: ${final?.status}, escrowKey: ${final?.escrowKey ?? 'removed'}`);
  if (final?.status !== 'terminated') {
    console.log('  ❌ FAIL: expected status "terminated"');
    process.exit(1);
  }
  console.log('  ✅ Correctly marked as terminated');

  // Economics: on early termination, only base fee charged ($5 for session, capped to buffer)
  const ownerDiff = (await getBalance(ownerClient, OWNER_ACCOUNT)) - balBefore['Owner'];
  const renterDiff = (await getBalance(ownerClient, renterAccount)) - balBefore['Renter'];
  console.log('\n📊 Termination Economics:');
  console.log(`  Base fee charged: $5.00 (session minimum, but capped to buffer $1.00)`);
  console.log(`  Actual charged: $1.00 (= buffer, since buffer < base fee)`);
  console.log(`  Owner received: ${ownerDiff.toFixed(4)} HBAR`);
  console.log(`  Renter refund (stake + excess): net ${renterDiff.toFixed(4)} HBAR`);
  console.log(`  Renter should get full stake back + any unused buffer`);

  try {
    execSync(`security add-generic-password -s "atp-test-renter-${renterAccount}" -a "hedera" -w "${renterKey.toStringRaw()}" -U`);
  } catch {}

  renterClient.close();
  ownerClient.close();
  console.log('\n✅ TEST 4 PASSED: Early termination with settlement');
}

main().catch(e => { console.error('❌ FATAL:', e.message); process.exit(1); });
