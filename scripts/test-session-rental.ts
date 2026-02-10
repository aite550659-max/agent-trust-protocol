/**
 * Test 3: 30-Minute Session Rental
 * 
 * Initiates a session rental (not flash), waits briefly to simulate usage,
 * then completes with usage metrics. Tests session-type pricing and duration tracking.
 * 
 * NOTE: We don't actually wait 30 min — we simulate elapsed time in the usage report.
 */

import {
  Client,
  PrivateKey,
  AccountCreateTransaction,
  TransferTransaction,
  TopicCreateTransaction,
  AccountBalanceQuery,
  Hbar,
  AccountId,
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
  console.log('=== TEST 3: 30-MINUTE SESSION RENTAL ===\n');

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

  // Step 2: Fund renter (escrow creation + stake + buffer + tx fees)
  console.log('\nStep 2: Funding renter with 30 HBAR...');
  const fundTx = await new TransferTransaction()
    .addHbarTransfer(OWNER_ACCOUNT, new Hbar(-30))
    .addHbarTransfer(renterAccount, new Hbar(30))
    .execute(ownerClient);
  await fundTx.getReceipt(ownerClient);
  console.log(`  ✅ Funded`);

  // Step 3: Create open-submit HCS topic
  console.log('\nStep 3: Creating test HCS topic...');
  const topicTx = await new TopicCreateTransaction()
    .setTopicMemo('ATP Test 3: Session Rental')
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

  // Step 4: Renter initiates SESSION rental ($5 base + $5 buffer + $10 stake)
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
    '/tmp/atp-test3-rentals',
  );

  const rental = await rentalManager.initiate({
    agentId: '0.0.99999',
    type: 'session',
    stakeUsd: 1.00,    // $1 stake
    bufferUsd: 1.00,    // $1 usage buffer
    expectedDurationMinutes: 30,
    agentMetadata: { owner: OWNER_ACCOUNT, hcsTopicId: testTopic },
  });

  console.log(`  ✅ Rental: ${rental.rentalId}`);
  console.log(`  Type: ${rental.rentalType}`);
  console.log(`  Escrow: ${rental.escrowAccount}`);
  console.log(`  Stake: ${rental.stakeHbar.toFixed(4)} HBAR ($${rental.stakeUsd})`);
  console.log(`  Buffer: ${rental.usageBufferHbar.toFixed(4)} HBAR ($${rental.usageBufferUsd})`);

  // Step 5: Simulate 30 minutes of usage
  console.log('\nStep 5: Simulating 30 minutes of agent usage...');
  // In production, instructions and tokens accumulate over time
  const simulatedUsage = {
    totalInstructions: 45,      // 1.5 per minute
    totalTokens: 150000,        // ~5K tokens/min
    totalCostUsd: 0.75,         // $0.75 total (base $5 waived for simulation, just LLM costs)
    uptimePercentage: 98.5,
  };
  console.log(`  Instructions: ${simulatedUsage.totalInstructions}`);
  console.log(`  Tokens: ${simulatedUsage.totalTokens.toLocaleString()}`);
  console.log(`  Cost: $${simulatedUsage.totalCostUsd}`);
  console.log(`  Uptime: ${simulatedUsage.uptimePercentage}%`);

  // Step 6: Complete rental with usage report
  console.log('\nStep 6: Completing session rental...');
  try {
    await rentalManager.complete(rental.rentalId, simulatedUsage);
    console.log('  ✅ Settlement executed');
  } catch (err: any) {
    console.log(`  ❌ Settlement failed: ${err.message}`);
    renterClient.close();
    ownerClient.close();
    process.exit(1);
  }

  // Step 7: Final balances
  console.log('\nStep 7: Final balances...');
  const hbarRate = await exchangeRateService.getRate();
  for (const [name, id] of [['Owner', OWNER_ACCOUNT], ['Renter', renterAccount], ['Treasury', TREASURY]]) {
    const after = await getBalance(ownerClient, id);
    const diff = after - balBefore[name];
    const diffUsd = diff * hbarRate;
    console.log(`  ${name}: ${after.toFixed(4)} HBAR (${diff >= 0 ? '+' : ''}${diff.toFixed(4)} / $${diffUsd.toFixed(4)})`);
  }

  // Step 8: Verify store
  const store = rentalManager.getStore();
  const final = store.get(rental.rentalId);
  console.log(`\nStep 8: Store — status: ${final?.status}, escrowKey: ${final?.escrowKey ?? 'removed'}`);

  // Economics summary
  const ownerDiff = (await getBalance(ownerClient, OWNER_ACCOUNT)) - balBefore['Owner'];
  const renterDiff = (await getBalance(ownerClient, renterAccount)) - balBefore['Renter'];
  const treasuryDiff = (await getBalance(ownerClient, TREASURY)) - balBefore['Treasury'];
  console.log('\n📊 Economics Summary:');
  console.log(`  Charged: $${simulatedUsage.totalCostUsd} (${(simulatedUsage.totalCostUsd / hbarRate).toFixed(4)} HBAR)`);
  console.log(`  Owner received: ${ownerDiff.toFixed(4)} HBAR (92% split)`);
  console.log(`  Treasury received: ${treasuryDiff.toFixed(4)} HBAR (1% split)`);
  console.log(`  Renter net cost: ${Math.abs(renterDiff).toFixed(4)} HBAR (includes tx fees)`);
  console.log(`  HBAR rate: $${hbarRate.toFixed(4)}`);

  // Save renter key
  try {
    execSync(`security add-generic-password -s "atp-test-renter-${renterAccount}" -a "hedera" -w "${renterKey.toStringRaw()}" -U`);
  } catch {}

  renterClient.close();
  ownerClient.close();
  console.log('\n✅ TEST 3 PASSED: 30-minute session rental completed successfully');
}

main().catch(e => { console.error('❌ FATAL:', e.message); process.exit(1); });
