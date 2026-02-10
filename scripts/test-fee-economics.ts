/**
 * Test 6: Fee Economics Analysis
 * 
 * Answers: Is a $0.02 flash rental viable after Hedera transaction costs?
 * 
 * Measures actual tx costs for each step of the rental lifecycle:
 * 1. Escrow account creation (~$0.05)
 * 2. Escrow funding transfer
 * 3. HCS message (rental_initiated)
 * 4. Settlement transfer (multi-party)
 * 5. HCS message (rental_completed)
 * 
 * Then calculates break-even pricing.
 */

import {
  Client,
  PrivateKey,
  AccountCreateTransaction,
  TransferTransaction,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  AccountBalanceQuery,
  Hbar,
  TopicId,
} from '@hashgraph/sdk';
import { execSync } from 'child_process';
import { exchangeRateService } from '../src/exchange-rate';

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
  console.log('=== TEST 6: FEE ECONOMICS ANALYSIS ===\n');

  const ownerKey = PrivateKey.fromStringECDSA(getOwnerKey());
  const client = Client.forMainnet().setOperator(OWNER_ACCOUNT, ownerKey);
  const hbarRate = await exchangeRateService.getRate();
  console.log(`HBAR Rate: $${hbarRate.toFixed(4)}\n`);

  const costs: { step: string; hbar: number; usd: number }[] = [];

  async function measureCost(label: string, fn: () => Promise<void>): Promise<number> {
    const before = await getBalance(client, OWNER_ACCOUNT);
    await fn();
    const after = await getBalance(client, OWNER_ACCOUNT);
    const costHbar = before - after;
    const costUsd = costHbar * hbarRate;
    costs.push({ step: label, hbar: costHbar, usd: costUsd });
    console.log(`  ${label}: ${costHbar.toFixed(6)} HBAR ($${costUsd.toFixed(6)})`);
    return costHbar;
  }

  // 1. Account creation (escrow)
  let escrowAccount = '';
  let escrowKey: PrivateKey;
  await measureCost('1. Escrow account creation', async () => {
    escrowKey = PrivateKey.generateED25519();
    const tx = await new AccountCreateTransaction()
      .setKey(escrowKey!)
      .setInitialBalance(new Hbar(0))
      .execute(client);
    const receipt = await tx.getReceipt(client);
    escrowAccount = receipt.accountId!.toString();
  });

  // 2. Funding transfer (operator → escrow)
  await measureCost('2. Escrow funding transfer', async () => {
    await (await new TransferTransaction()
      .addHbarTransfer(OWNER_ACCOUNT, new Hbar(-1))
      .addHbarTransfer(escrowAccount, new Hbar(1))
      .execute(client)).getReceipt(client);
  });

  // 3. HCS message (rental_initiated)
  let testTopic = '';
  // Create topic first (not measured)
  const topicTx = await new TopicCreateTransaction()
    .setTopicMemo('ATP Test 6: Fee Economics')
    .execute(client);
  testTopic = (await topicTx.getReceipt(client)).topicId!.toString();

  await measureCost('3. HCS message (initiated)', async () => {
    const msg = JSON.stringify({ type: 'rental_initiated', rental_id: 'test', ts: Date.now() });
    await (await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(testTopic))
      .setMessage(Buffer.from(msg))
      .execute(client)).getReceipt(client);
  });

  // 4. Settlement transfer (escrow → 4 parties, requires escrow key signature)
  await measureCost('4. Settlement (5-way split)', async () => {
    // escrow has 1 HBAR, split it
    const totalTb = 100000000; // 1 HBAR in tinybars
    const ownerTb = 92000000;
    const creatorTb = 5000000;
    const networkTb = 2000000;
    const treasuryTb = 1000000;

    const tx = new TransferTransaction()
      .addHbarTransfer(escrowAccount, Hbar.fromTinybars(-totalTb))
      .addHbarTransfer(OWNER_ACCOUNT, Hbar.fromTinybars(ownerTb))
      .addHbarTransfer(OWNER_ACCOUNT, Hbar.fromTinybars(creatorTb)) // same account for test
      .addHbarTransfer('0.0.800', Hbar.fromTinybars(networkTb))
      .addHbarTransfer(TREASURY, Hbar.fromTinybars(treasuryTb))
      .freezeWith(client);

    await tx.sign(escrowKey!);
    await (await tx.execute(client)).getReceipt(client);
  });

  // 5. HCS message (rental_completed)
  await measureCost('5. HCS message (completed)', async () => {
    const msg = JSON.stringify({ type: 'rental_completed', rental_id: 'test', ts: Date.now() });
    await (await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(testTopic))
      .setMessage(Buffer.from(msg))
      .execute(client)).getReceipt(client);
  });

  // Summary
  const totalHbar = costs.reduce((s, c) => s + c.hbar, 0);
  const totalUsd = costs.reduce((s, c) => s + c.usd, 0);

  console.log('\n' + '='.repeat(55));
  console.log('📊 FULL RENTAL LIFECYCLE COST');
  console.log('='.repeat(55));
  for (const c of costs) {
    console.log(`  ${c.step.padEnd(35)} ${c.hbar.toFixed(6)} HBAR  $${c.usd.toFixed(6)}`);
  }
  console.log('  ' + '-'.repeat(53));
  console.log(`  ${'TOTAL'.padEnd(35)} ${totalHbar.toFixed(6)} HBAR  $${totalUsd.toFixed(6)}`);

  // Break-even analysis
  const flashMinPrice = 0.02;
  const sessionMinPrice = 5.00;
  console.log('\n📊 BREAK-EVEN ANALYSIS');
  console.log('='.repeat(55));
  console.log(`  Lifecycle tx cost:     $${totalUsd.toFixed(4)}`);
  console.log(`  Flash min price:       $${flashMinPrice.toFixed(2)}`);
  console.log(`  Flash margin:          $${(flashMinPrice - totalUsd).toFixed(4)} (${((flashMinPrice - totalUsd) / flashMinPrice * 100).toFixed(1)}%)`);
  console.log(`  Session min price:     $${sessionMinPrice.toFixed(2)}`);
  console.log(`  Session margin:        $${(sessionMinPrice - totalUsd).toFixed(4)} (${((sessionMinPrice - totalUsd) / sessionMinPrice * 100).toFixed(1)}%)`);

  if (totalUsd > flashMinPrice) {
    console.log('\n  ⚠️  FLASH RENTAL IS NOT VIABLE at $0.02!');
    console.log(`  Minimum viable flash price: $${(totalUsd * 1.2).toFixed(4)} (cost + 20% margin)`);
    console.log(`  Recommendation: Raise flash minimum or use escrow pooling`);
  } else {
    console.log('\n  ✅ Flash rental IS viable at $0.02');
  }

  // Cost without account creation (if escrow reuse is implemented)
  const withoutCreation = totalUsd - costs[0].usd;
  console.log(`\n  Without escrow creation: $${withoutCreation.toFixed(4)}`);
  console.log(`  Flash viable with reuse: ${withoutCreation < flashMinPrice ? '✅ YES' : '❌ NO'}`);

  client.close();
  console.log('\n✅ TEST 6 COMPLETE: Fee economics analyzed');
}

main().catch(e => { console.error('❌ FATAL:', e.message); process.exit(1); });
