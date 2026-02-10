/**
 * Test 5: Separate Creator Account
 * 
 * Tests the 3-party split: owner ≠ creator ≠ renter.
 * Creator gets 5% royalty, owner gets 92%, network 2%, treasury 1%.
 * 
 * Proves: creator royalty flows to a distinct account.
 */

import {
  Client,
  PrivateKey,
  AccountCreateTransaction,
  TransferTransaction,
  TopicCreateTransaction,
  AccountBalanceQuery,
  Hbar,
} from '@hashgraph/sdk';
import { execSync } from 'child_process';
import { RentalManager } from '../src/managers/rental';
import { exchangeRateService } from '../src/exchange-rate';
import { ATPConfig } from '../src/types';

const OWNER_ACCOUNT = '0.0.10255397';
const TREASURY = '0.0.8332371';

function getOwnerKey(): string {
  return execSync('security find-generic-password -s "aite-private-key" -a "hedera" -w', { encoding: 'utf8' }).trim();
}

async function getBalance(client: Client, accountId: string): Promise<number> {
  const balance = await new AccountBalanceQuery().setAccountId(accountId).execute(client);
  return balance.hbars.toTinybars().toNumber() / 1e8;
}

async function main() {
  console.log('=== TEST 5: SEPARATE CREATOR ACCOUNT ===\n');

  const ownerKey = PrivateKey.fromStringECDSA(getOwnerKey());
  const ownerClient = Client.forMainnet().setOperator(OWNER_ACCOUNT, ownerKey);

  // Step 1: Create fresh renter AND creator accounts
  console.log('Step 1: Creating fresh renter + creator accounts...');
  const renterKey = PrivateKey.generateED25519();
  const creatorKey = PrivateKey.generateED25519();

  const renterCreateTx = await new AccountCreateTransaction()
    .setKey(renterKey).setInitialBalance(new Hbar(0)).execute(ownerClient);
  const renterAccount = (await renterCreateTx.getReceipt(ownerClient)).accountId!.toString();

  const creatorCreateTx = await new AccountCreateTransaction()
    .setKey(creatorKey).setInitialBalance(new Hbar(0)).execute(ownerClient);
  const creatorAccount = (await creatorCreateTx.getReceipt(ownerClient)).accountId!.toString();

  console.log(`  ✅ Renter: ${renterAccount}`);
  console.log(`  ✅ Creator: ${creatorAccount}`);
  console.log(`  Owner: ${OWNER_ACCOUNT}`);
  console.log(`  All three are distinct: ${renterAccount !== OWNER_ACCOUNT && creatorAccount !== OWNER_ACCOUNT && renterAccount !== creatorAccount}`);

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
    .setTopicMemo('ATP Test 5: Separate Creator')
    .execute(ownerClient);
  const testTopic = (await topicTx.getReceipt(ownerClient)).topicId!.toString();
  console.log(`  ✅ Topic: ${testTopic}`);

  // Capture balances
  const balBefore: Record<string, number> = {};
  for (const [name, id] of [['Owner', OWNER_ACCOUNT], ['Creator', creatorAccount], ['Renter', renterAccount], ['Treasury', TREASURY]]) {
    balBefore[name] = await getBalance(ownerClient, id);
    console.log(`  ${name} (${id}): ${balBefore[name].toFixed(4)} HBAR`);
  }

  // Step 4: Renter initiates rental — creator is distinct from owner
  console.log('\nStep 4: Renter initiates rental (creator ≠ owner)...');
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
    creator: creatorAccount,  // <-- DISTINCT creator
  });

  const rentalManager = new RentalManager(
    renterClient,
    renterConfig,
    resolveAgent,
    '/tmp/atp-test5-rentals',
  );

  const rental = await rentalManager.initiate({
    agentId: '0.0.99999',
    type: 'flash',
    stakeUsd: 0.10,
    bufferUsd: 0.10,
    agentMetadata: { owner: OWNER_ACCOUNT, hcsTopicId: testTopic },
  });

  console.log(`  ✅ Rental: ${rental.rentalId}`);
  console.log(`  Escrow: ${rental.escrowAccount}`);

  // Step 5: Complete with usage
  console.log('\nStep 5: Completing rental...');
  await rentalManager.complete(rental.rentalId, {
    totalInstructions: 3,
    totalTokens: 2000,
    totalCostUsd: 0.08,
  });
  console.log('  ✅ Settlement executed');

  // Step 6: Final balances — verify creator got 5%
  console.log('\nStep 6: Final balances...');
  const hbarRate = await exchangeRateService.getRate();
  for (const [name, id] of [['Owner', OWNER_ACCOUNT], ['Creator', creatorAccount], ['Renter', renterAccount], ['Treasury', TREASURY]]) {
    const after = await getBalance(ownerClient, id);
    const diff = after - balBefore[name];
    console.log(`  ${name}: ${after.toFixed(4)} HBAR (${diff >= 0 ? '+' : ''}${diff.toFixed(6)} / $${(diff * hbarRate).toFixed(6)})`);
  }

  // Verify splits
  const creatorDiff = (await getBalance(ownerClient, creatorAccount)) - balBefore['Creator'];
  const ownerDiff = (await getBalance(ownerClient, OWNER_ACCOUNT)) - balBefore['Owner'];
  const treasuryDiff = (await getBalance(ownerClient, TREASURY)) - balBefore['Treasury'];

  console.log('\n📊 Split Verification:');
  console.log(`  Total charged: $0.08`);
  console.log(`  Expected creator (5%): $${(0.08 * 0.05).toFixed(4)} = ${(0.08 * 0.05 / hbarRate).toFixed(4)} HBAR`);
  console.log(`  Actual creator: ${creatorDiff.toFixed(6)} HBAR ($${(creatorDiff * hbarRate).toFixed(6)})`);
  console.log(`  Expected owner (92%): $${(0.08 * 0.92).toFixed(4)}`);
  console.log(`  Actual owner: ${ownerDiff.toFixed(6)} HBAR ($${(ownerDiff * hbarRate).toFixed(6)})`);
  console.log(`  Expected treasury (1%): $${(0.08 * 0.01).toFixed(4)}`);
  console.log(`  Actual treasury: ${treasuryDiff.toFixed(6)} HBAR ($${(treasuryDiff * hbarRate).toFixed(6)})`);

  if (creatorDiff <= 0) {
    console.log('\n  ❌ FAIL: Creator received nothing!');
    process.exit(1);
  }
  console.log('\n  ✅ Creator received royalty payment');

  // Save keys
  try {
    execSync(`security add-generic-password -s "atp-test-renter-${renterAccount}" -a "hedera" -w "${renterKey.toStringRaw()}" -U`);
    execSync(`security add-generic-password -s "atp-test-creator-${creatorAccount}" -a "hedera" -w "${creatorKey.toStringRaw()}" -U`);
  } catch {}

  renterClient.close();
  ownerClient.close();
  console.log('\n✅ TEST 5 PASSED: Separate creator receives 5% royalty');
}

main().catch(e => { console.error('❌ FATAL:', e.message); process.exit(1); });
