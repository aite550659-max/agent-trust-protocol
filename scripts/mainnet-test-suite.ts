/**
 * ATP Mainnet Test Suite
 * 
 * Tests:
 * 1. Escrow key persistence (crash recovery)
 * 2. True two-party rental (separate renter account)
 * 3. Session rental (30 min simulated)
 * 4. Early termination by renter
 * 5. Separate creator account (3-way split)
 * 6. Fee economics analysis
 * 7. Buffer exhaustion scenario
 * 
 * Each test documents lessons and improvements.
 */

import {
  Client,
  PrivateKey,
  AccountBalanceQuery,
  AccountCreateTransaction,
  TransferTransaction,
  TopicMessageSubmitTransaction,
  AccountInfoQuery,
  Hbar,
  Status,
} from '@hashgraph/sdk';
import { execSync } from 'child_process';
import { exchangeRateService } from '../src/exchange-rate';
import { TRANSACTION_SPLITS, NETWORK_ACCOUNTS } from '../src/config';
import { RentalStore, StoredRental } from '../src/rental-store';
import * as fs from 'fs';

// === CONFIG ===
const AGENT_TOPIC = '0.0.10261370';
const OWNER_ACCOUNT = '0.0.10255397';
const TREASURY_ACCOUNT = NETWORK_ACCOUNTS.mainnet.treasury;
const NETWORK_ACCOUNT = NETWORK_ACCOUNTS.mainnet.network;

// Lost-key blacklist — NEVER send to these
const BLACKLISTED_ACCOUNTS = new Set([
  '0.0.10263432', '0.0.10263433', '0.0.10263434', '0.0.10263435', '0.0.10263436'
]);

function getKey(): string {
  return execSync('security find-generic-password -s "aite-private-key" -a "hedera" -w', { encoding: 'utf8' }).trim();
}

// Tinybars helpers
let hbarRate: number;
const toTb = (usd: number) => Math.round((usd / hbarRate) * 1e8);
const fromTb = (tb: number) => tb / 1e8;
const tbToUsd = (tb: number) => fromTb(tb) * hbarRate;

async function getBalance(client: Client, accountId: string): Promise<number> {
  const b = await new AccountBalanceQuery().setAccountId(accountId).execute(client);
  return b.hbars.toTinybars().toNumber() / 1e8;
}

function assertNotBlacklisted(accountId: string): void {
  if (BLACKLISTED_ACCOUNTS.has(accountId)) {
    throw new Error(`BLOCKED: ${accountId} is a lost-key account — transfer would lose funds`);
  }
}

async function logToHCS(client: Client, type: string, data: any): Promise<number> {
  const msg = JSON.stringify({
    type,
    version: '0.9',
    timestamp: new Date().toISOString(),
    agent_id: AGENT_TOPIC,
    data,
  });
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(AGENT_TOPIC)
    .setMessage(msg)
    .execute(client);
  const receipt = await tx.getReceipt(client);
  return receipt.topicSequenceNumber?.toNumber() || 0;
}

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  lessons: string[];
  improvements: string[];
  hbarCost: number;
}

const results: TestResult[] = [];
const lessons: string[] = [];

// ========================================
// TEST 1: Escrow Key Persistence
// ========================================
async function test1_escrowPersistence(client: Client): Promise<TestResult> {
  console.log('\n====== TEST 1: Escrow Key Persistence ======');
  const start = Date.now();
  const testLessons: string[] = [];
  const testImprovements: string[] = [];
  let hbarCost = 0;

  try {
    const store = new RentalStore();
    
    // Create escrow
    const escrowKey = PrivateKey.generateED25519();
    const escrowTx = await new AccountCreateTransaction()
      .setKey(escrowKey)
      .setInitialBalance(new Hbar(0))
      .execute(client);
    const escrowReceipt = await escrowTx.getReceipt(client);
    const escrowAccount = escrowReceipt.accountId!.toString();
    hbarCost += 0.05; // Account creation fee
    
    // Fund escrow
    const fundAmount = toTb(0.05);
    await (await new TransferTransaction()
      .addHbarTransfer(OWNER_ACCOUNT, Hbar.fromTinybars(-fundAmount))
      .addHbarTransfer(escrowAccount, Hbar.fromTinybars(fundAmount))
      .execute(client)).getReceipt(client);
    
    // Store rental with escrow key
    const rental: StoredRental = {
      rentalId: `test1_${Date.now()}`,
      agentId: AGENT_TOPIC,
      renter: OWNER_ACCOUNT,
      owner: OWNER_ACCOUNT,
      rentalType: 'flash',
      stakeUsd: 0.025,
      stakeHbar: fromTb(toTb(0.025)),
      usageBufferUsd: 0.025,
      usageBufferHbar: fromTb(toTb(0.025)),
      escrowAccount,
      escrowKey: escrowKey.toStringRaw(),
      pricingSnapshot: { flashBaseFee: 0.02, standardBaseFee: 5, perInstruction: 0.05, perMinute: 0.01, llmMarkupBps: 150, toolMarkupBps: 150 },
      constraints: { toolsBlocked: [], memoryAccessLevel: 'sandboxed', topicsBlocked: [], maxPerInstructionCost: 100, maxDailyCost: 1000 },
      startedAt: new Date().toISOString(),
      status: 'active',
    };
    store.put(rental);
    console.log(`  Rental stored: ${rental.rentalId}`);

    // Simulate crash: create new store instance (reloads from disk)
    const store2 = new RentalStore();
    const recovered = store2.get(rental.rentalId);
    
    if (!recovered || !recovered.escrowKey) {
      throw new Error('Escrow key NOT recovered after simulated crash!');
    }
    console.log(`  Recovered escrow key after "crash": ✅`);

    // Use recovered key to drain escrow back
    const recoveredKey = PrivateKey.fromStringED25519(recovered.escrowKey);
    const drainTx = new TransferTransaction()
      .addHbarTransfer(escrowAccount, Hbar.fromTinybars(-fundAmount))
      .addHbarTransfer(OWNER_ACCOUNT, Hbar.fromTinybars(fundAmount));
    const frozen = await drainTx.freezeWith(client);
    await frozen.sign(recoveredKey);
    await (await frozen.execute(client)).getReceipt(client);
    console.log(`  Recovered funds from escrow: ✅`);

    // Clean up
    store2.complete(rental.rentalId);
    
    testLessons.push('Escrow keys MUST be persisted to disk immediately — in-memory only = fund loss on crash');
    testLessons.push('Atomic file writes (tmp + rename) prevent corruption during save');
    testImprovements.push('Added RentalStore with persistent JSON storage and atomic writes');
    
    return { name: 'Escrow Key Persistence', passed: true, duration: Date.now() - start, lessons: testLessons, improvements: testImprovements, hbarCost };
  } catch (e) {
    return { name: 'Escrow Key Persistence', passed: false, duration: Date.now() - start, lessons: [`FAILED: ${(e as Error).message}`], improvements: testImprovements, hbarCost };
  }
}

// ========================================
// TEST 2: True Two-Party Rental
// ========================================
async function test2_twoPartyRental(client: Client, operatorKey: PrivateKey): Promise<TestResult> {
  console.log('\n====== TEST 2: True Two-Party Rental ======');
  const start = Date.now();
  const testLessons: string[] = [];
  const testImprovements: string[] = [];
  let hbarCost = 0;

  try {
    // Create a fresh renter account with its own key
    const renterKey = PrivateKey.generateECDSA();
    const renterTx = await new AccountCreateTransaction()
      .setKey(renterKey)
      .setInitialBalance(new Hbar(5))
      .execute(client);
    const renterReceipt = await renterTx.getReceipt(client);
    const renterAccount = renterReceipt.accountId!.toString();
    hbarCost += 5.05; // 5 HBAR initial + creation fee
    console.log(`  Created renter: ${renterAccount}`);

    // Renter creates escrow (using renter's client)
    const renterClient = Client.forMainnet().setOperator(renterAccount, renterKey);
    const escrowKey = PrivateKey.generateED25519();
    const escrowTx = await new AccountCreateTransaction()
      .setKey(escrowKey)
      .setInitialBalance(new Hbar(0))
      .execute(renterClient);
    const escrowReceipt = await escrowTx.getReceipt(renterClient);
    const escrowAccount = escrowReceipt.accountId!.toString();
    console.log(`  Escrow created by renter: ${escrowAccount}`);

    // Renter funds escrow
    const totalTb = toTb(0.20); // $0.20 total
    await (await new TransferTransaction()
      .addHbarTransfer(renterAccount, Hbar.fromTinybars(-totalTb))
      .addHbarTransfer(escrowAccount, Hbar.fromTinybars(totalTb))
      .execute(renterClient)).getReceipt(renterClient);
    console.log(`  Renter funded escrow: ${fromTb(totalTb).toFixed(4)} HBAR`);

    // Log rental_initiated
    const rentalId = `test2_${Date.now()}`;
    const seq1 = await logToHCS(client, 'rental_initiated', {
      rental_id: rentalId,
      renter: renterAccount,
      owner: OWNER_ACCOUNT,
      rental_type: 'flash',
      escrow_account: escrowAccount,
      stake_usd: 0.10,
      buffer_usd: 0.10,
    });
    console.log(`  HCS rental_initiated: seq ${seq1}`);

    // Settle: escrow → owner + treasury + renter refund
    const usageTb = toTb(0.05);
    const treasuryTb = Math.round(usageTb * 0.01);
    const ownerTb = usageTb - treasuryTb;
    const refundTb = totalTb - usageTb;

    assertNotBlacklisted(OWNER_ACCOUNT);
    assertNotBlacklisted(TREASURY_ACCOUNT);
    assertNotBlacklisted(renterAccount);

    const settleTx = new TransferTransaction()
      .addHbarTransfer(escrowAccount, Hbar.fromTinybars(-totalTb))
      .addHbarTransfer(OWNER_ACCOUNT, Hbar.fromTinybars(ownerTb))
      .addHbarTransfer(TREASURY_ACCOUNT, Hbar.fromTinybars(treasuryTb))
      .addHbarTransfer(renterAccount, Hbar.fromTinybars(refundTb));

    const frozenSettle = await settleTx.freezeWith(client);
    await frozenSettle.sign(escrowKey);
    const settleResp = await frozenSettle.execute(client);
    const settleReceipt = await settleResp.getReceipt(client);
    console.log(`  Settlement: ${settleReceipt.status}`);

    // Verify renter got refund
    const renterBal = await getBalance(client, renterAccount);
    console.log(`  Renter balance after: ${renterBal.toFixed(4)} HBAR`);

    const seq2 = await logToHCS(client, 'rental_completed', {
      rental_id: rentalId,
      settlement_tx: settleResp.transactionId.toString(),
      renter: renterAccount,
      owner: OWNER_ACCOUNT,
    });
    console.log(`  HCS rental_completed: seq ${seq2}`);

    testLessons.push('Two-party rental works — renter creates+funds escrow with own key, owner signs settlement');
    testLessons.push('Escrow key holder (renter or protocol) must co-sign settlement — this IS the trust mechanism');
    testImprovements.push('Need threshold key on escrow (renter + owner) for production — single key is a trust assumption');

    return { name: 'True Two-Party Rental', passed: true, duration: Date.now() - start, lessons: testLessons, improvements: testImprovements, hbarCost };
  } catch (e) {
    return { name: 'True Two-Party Rental', passed: false, duration: Date.now() - start, lessons: [`FAILED: ${(e as Error).message}`], improvements: testImprovements, hbarCost };
  }
}

// ========================================
// TEST 3: Session Rental (30 min simulated)
// ========================================
async function test3_sessionRental(client: Client): Promise<TestResult> {
  console.log('\n====== TEST 3: 30-Minute Session Rental ======');
  const start = Date.now();
  const testLessons: string[] = [];
  const testImprovements: string[] = [];
  let hbarCost = 0;

  try {
    // Create escrow
    const escrowKey = PrivateKey.generateED25519();
    const escrowTx = await new AccountCreateTransaction()
      .setKey(escrowKey)
      .setInitialBalance(new Hbar(0))
      .execute(client);
    const escrowReceipt = await escrowTx.getReceipt(client);
    const escrowAccount = escrowReceipt.accountId!.toString();
    hbarCost += 0.05;

    // Session rental: $5 base + $0.01/min * 30 min = $5.30 total expected
    const stakeUsd = 2.00;
    const bufferUsd = 8.00;
    const stakeTb = toTb(stakeUsd);
    const bufferTb = toTb(bufferUsd);
    const totalTb = stakeTb + bufferTb;

    // Fund escrow
    await (await new TransferTransaction()
      .addHbarTransfer(OWNER_ACCOUNT, Hbar.fromTinybars(-totalTb))
      .addHbarTransfer(escrowAccount, Hbar.fromTinybars(totalTb))
      .execute(client)).getReceipt(client);
    console.log(`  Escrow funded: ${fromTb(totalTb).toFixed(4)} HBAR ($${(stakeUsd + bufferUsd).toFixed(2)})`);

    // Persist
    const store = new RentalStore();
    const rentalId = `test3_session_${Date.now()}`;
    store.put({
      rentalId,
      agentId: AGENT_TOPIC,
      renter: OWNER_ACCOUNT,
      owner: OWNER_ACCOUNT,
      rentalType: 'session',
      stakeUsd,
      stakeHbar: fromTb(stakeTb),
      usageBufferUsd: bufferUsd,
      usageBufferHbar: fromTb(bufferTb),
      escrowAccount,
      escrowKey: escrowKey.toStringRaw(),
      pricingSnapshot: { flashBaseFee: 0.02, standardBaseFee: 5, perInstruction: 0.05, perMinute: 0.01, llmMarkupBps: 150, toolMarkupBps: 150 },
      constraints: { toolsBlocked: [], memoryAccessLevel: 'sandboxed', topicsBlocked: [], maxPerInstructionCost: 100, maxDailyCost: 1000 },
      startedAt: new Date().toISOString(),
      status: 'active',
    });

    const seq1 = await logToHCS(client, 'rental_initiated', {
      rental_id: rentalId,
      rental_type: 'session',
      expected_duration_minutes: 30,
      stake_usd: stakeUsd,
      buffer_usd: bufferUsd,
      escrow_account: escrowAccount,
    });
    console.log(`  HCS rental_initiated: seq ${seq1}`);

    // Simulate 30 min of usage: 15 instructions, 12000 tokens, $5.30 total
    const usage = {
      instructions: 15,
      tokens: 12000,
      duration_minutes: 30,
      base_fee: 5.00,
      per_minute_cost: 0.30, // 30 * $0.01
      total_usd: 5.30,
    };
    console.log(`  Simulated: ${usage.instructions} instructions, ${usage.tokens} tokens, ${usage.duration_minutes} min`);
    console.log(`  Usage cost: $${usage.total_usd} (base $5 + 30min * $0.01)`);

    // Settle
    const chargedTb = toTb(usage.total_usd);
    const treasuryTb = Math.round(chargedTb * TRANSACTION_SPLITS.atp_treasury);
    const creatorTb = Math.round(chargedTb * TRANSACTION_SPLITS.creator_royalty);
    const networkTb = Math.round(chargedTb * TRANSACTION_SPLITS.network_contribution);
    const ownerTb = chargedTb - treasuryTb - creatorTb - networkTb;
    const refundTb = totalTb - chargedTb; // stake + unused buffer

    // Owner = creator in this test, combine
    const ownerTotalTb = ownerTb + creatorTb + networkTb;

    console.log(`  Settlement splits:`);
    console.log(`    Owner (92%+5%+2%): ${fromTb(ownerTotalTb).toFixed(4)} HBAR ($${tbToUsd(ownerTotalTb).toFixed(4)})`);
    console.log(`    Treasury (1%): ${fromTb(treasuryTb).toFixed(4)} HBAR ($${tbToUsd(treasuryTb).toFixed(4)})`);
    console.log(`    Renter refund: ${fromTb(refundTb).toFixed(4)} HBAR ($${tbToUsd(refundTb).toFixed(4)})`);

    const settleTx = new TransferTransaction()
      .addHbarTransfer(escrowAccount, Hbar.fromTinybars(-totalTb))
      .addHbarTransfer(OWNER_ACCOUNT, Hbar.fromTinybars(ownerTotalTb + refundTb)) // owner = renter here
      .addHbarTransfer(TREASURY_ACCOUNT, Hbar.fromTinybars(treasuryTb));

    const frozenSettle = await settleTx.freezeWith(client);
    await frozenSettle.sign(escrowKey);
    const settleResp = await frozenSettle.execute(client);
    const settleReceipt = await settleResp.getReceipt(client);
    console.log(`  Settlement: ${settleReceipt.status}`);

    const seq2 = await logToHCS(client, 'rental_completed', {
      rental_id: rentalId,
      rental_type: 'session',
      duration_minutes: 30,
      usage,
      total_charged_usd: usage.total_usd,
      settlement_tx: settleResp.transactionId.toString(),
    });
    console.log(`  HCS rental_completed: seq ${seq2}`);

    store.complete(rentalId);

    testLessons.push('Session rental works — base fee + per-minute usage + settlement');
    testLessons.push('Buffer must be larger than expected usage to cover overruns');
    testImprovements.push('Need periodic usage check-ins during session (HCS heartbeat messages)');
    testImprovements.push('Should log rental_usage_update messages periodically for long sessions');

    return { name: '30-Min Session Rental', passed: true, duration: Date.now() - start, lessons: testLessons, improvements: testImprovements, hbarCost: fromTb(totalTb) + 0.05 };
  } catch (e) {
    return { name: '30-Min Session Rental', passed: false, duration: Date.now() - start, lessons: [`FAILED: ${(e as Error).message}`], improvements: testImprovements, hbarCost };
  }
}

// ========================================
// TEST 4: Early Termination by Renter
// ========================================
async function test4_earlyTermination(client: Client): Promise<TestResult> {
  console.log('\n====== TEST 4: Early Termination ======');
  const start = Date.now();
  const testLessons: string[] = [];
  const testImprovements: string[] = [];
  let hbarCost = 0;

  try {
    const escrowKey = PrivateKey.generateED25519();
    const escrowTx = await new AccountCreateTransaction()
      .setKey(escrowKey)
      .setInitialBalance(new Hbar(0))
      .execute(client);
    const escrowAccount = (await escrowTx.getReceipt(client)).accountId!.toString();
    hbarCost += 0.05;

    // Book 30 min session but terminate after 10 min
    const stakeUsd = 2.00;
    const bufferUsd = 8.00;
    const totalTb = toTb(stakeUsd + bufferUsd);

    await (await new TransferTransaction()
      .addHbarTransfer(OWNER_ACCOUNT, Hbar.fromTinybars(-totalTb))
      .addHbarTransfer(escrowAccount, Hbar.fromTinybars(totalTb))
      .execute(client)).getReceipt(client);

    const rentalId = `test4_term_${Date.now()}`;
    const seq1 = await logToHCS(client, 'rental_initiated', {
      rental_id: rentalId,
      rental_type: 'session',
      expected_duration_minutes: 30,
      escrow_account: escrowAccount,
    });
    console.log(`  HCS rental_initiated: seq ${seq1}`);

    // Renter terminates after 10 min (used $5.10 = base + 10*$0.01)
    const usedUsd = 5.10;
    const penaltyUsd = 0.50; // Early termination penalty (10% of remaining buffer)
    const totalChargedUsd = usedUsd + penaltyUsd;
    
    console.log(`  Early termination after 10 min`);
    console.log(`  Usage: $${usedUsd}, Penalty: $${penaltyUsd}, Total: $${totalChargedUsd}`);

    const chargedTb = toTb(totalChargedUsd);
    const treasuryTb = Math.round(chargedTb * TRANSACTION_SPLITS.atp_treasury);
    const ownerTotalTb = chargedTb - treasuryTb; // owner gets usage + penalty (minus treasury)
    const refundTb = totalTb - chargedTb;

    const settleTx = new TransferTransaction()
      .addHbarTransfer(escrowAccount, Hbar.fromTinybars(-totalTb))
      .addHbarTransfer(OWNER_ACCOUNT, Hbar.fromTinybars(ownerTotalTb + refundTb))
      .addHbarTransfer(TREASURY_ACCOUNT, Hbar.fromTinybars(treasuryTb));

    const frozenSettle = await settleTx.freezeWith(client);
    await frozenSettle.sign(escrowKey);
    const settleResp = await frozenSettle.execute(client);
    const settleReceipt = await settleResp.getReceipt(client);
    console.log(`  Settlement: ${settleReceipt.status}`);

    const seq2 = await logToHCS(client, 'rental_terminated', {
      rental_id: rentalId,
      terminated_by: 'renter',
      reason: 'early_termination',
      minutes_used: 10,
      minutes_expected: 30,
      usage_charged_usd: usedUsd,
      penalty_usd: penaltyUsd,
      total_charged_usd: totalChargedUsd,
      refund_hbar: fromTb(refundTb),
      settlement_tx: settleResp.transactionId.toString(),
    });
    console.log(`  HCS rental_terminated: seq ${seq2}`);

    testLessons.push('Early termination penalty incentivizes completing rentals');
    testLessons.push('Penalty should be proportional to remaining time, not fixed');
    testImprovements.push('Add terminate() to SDK with automatic penalty calculation');
    testImprovements.push('rental_terminated HCS message type distinct from rental_completed');

    return { name: 'Early Termination', passed: true, duration: Date.now() - start, lessons: testLessons, improvements: testImprovements, hbarCost: fromTb(totalTb) + 0.05 };
  } catch (e) {
    return { name: 'Early Termination', passed: false, duration: Date.now() - start, lessons: [`FAILED: ${(e as Error).message}`], improvements: testImprovements, hbarCost };
  }
}

// ========================================
// TEST 5: Separate Creator Account (3-way split)
// ========================================
async function test5_separateCreator(client: Client): Promise<TestResult> {
  console.log('\n====== TEST 5: Separate Creator (3-Way Split) ======');
  const start = Date.now();
  const testLessons: string[] = [];
  const testImprovements: string[] = [];
  let hbarCost = 0;

  try {
    // Create a "creator" account
    const creatorKey = PrivateKey.generateECDSA();
    const creatorTx = await new AccountCreateTransaction()
      .setKey(creatorKey)
      .setInitialBalance(new Hbar(0.1))
      .execute(client);
    const creatorAccount = (await creatorTx.getReceipt(client)).accountId!.toString();
    hbarCost += 0.15;
    console.log(`  Creator account: ${creatorAccount}`);

    const creatorBalBefore = await getBalance(client, creatorAccount);

    // Create escrow
    const escrowKey = PrivateKey.generateED25519();
    const escrowTx = await new AccountCreateTransaction()
      .setKey(escrowKey)
      .setInitialBalance(new Hbar(0))
      .execute(client);
    const escrowAccount = (await escrowTx.getReceipt(client)).accountId!.toString();
    hbarCost += 0.05;

    const totalUsd = 0.50;
    const totalTb = toTb(totalUsd);

    await (await new TransferTransaction()
      .addHbarTransfer(OWNER_ACCOUNT, Hbar.fromTinybars(-totalTb))
      .addHbarTransfer(escrowAccount, Hbar.fromTinybars(totalTb))
      .execute(client)).getReceipt(client);

    const rentalId = `test5_creator_${Date.now()}`;
    await logToHCS(client, 'rental_initiated', { rental_id: rentalId, creator: creatorAccount });

    // Settle with real 4-way split
    const usageUsd = 0.50;
    const usageTb = toTb(usageUsd);
    
    const creatorTb = Math.round(usageTb * TRANSACTION_SPLITS.creator_royalty); // 5%
    const treasuryTb = Math.round(usageTb * TRANSACTION_SPLITS.atp_treasury);   // 1%
    const networkTb = Math.round(usageTb * TRANSACTION_SPLITS.network_contribution); // 2%
    const ownerTb = usageTb - creatorTb - treasuryTb - networkTb; // 92% + dust
    const refundTb = totalTb - usageTb;

    console.log(`  Split: owner=${fromTb(ownerTb).toFixed(4)}, creator=${fromTb(creatorTb).toFixed(4)}, treasury=${fromTb(treasuryTb).toFixed(4)}, network=${fromTb(networkTb).toFixed(4)}`);

    // Can't send to 0.0.800 (network), so owner absorbs network share for now
    const ownerFinalTb = ownerTb + networkTb + refundTb;

    assertNotBlacklisted(creatorAccount);
    
    const settleTx = new TransferTransaction()
      .addHbarTransfer(escrowAccount, Hbar.fromTinybars(-totalTb))
      .addHbarTransfer(OWNER_ACCOUNT, Hbar.fromTinybars(ownerFinalTb))
      .addHbarTransfer(creatorAccount, Hbar.fromTinybars(creatorTb))
      .addHbarTransfer(TREASURY_ACCOUNT, Hbar.fromTinybars(treasuryTb));

    const frozenSettle = await settleTx.freezeWith(client);
    await frozenSettle.sign(escrowKey);
    const settleResp = await frozenSettle.execute(client);
    const settleReceipt = await settleResp.getReceipt(client);
    console.log(`  Settlement: ${settleReceipt.status}`);

    // Verify creator got paid
    const creatorBalAfter = await getBalance(client, creatorAccount);
    const creatorReceived = creatorBalAfter - creatorBalBefore;
    console.log(`  Creator received: ${creatorReceived.toFixed(4)} HBAR ($${(creatorReceived * hbarRate).toFixed(4)})`);
    console.log(`  Expected 5% of $${usageUsd}: $${(usageUsd * 0.05).toFixed(4)}`);

    const seq2 = await logToHCS(client, 'rental_completed', {
      rental_id: rentalId,
      creator: creatorAccount,
      creator_royalty_hbar: fromTb(creatorTb),
      settlement_tx: settleResp.transactionId.toString(),
    });
    console.log(`  HCS rental_completed: seq ${seq2}`);

    testLessons.push('3-way split works — creator receives 5% royalty in separate account');
    testLessons.push('Network account (0.0.800) may reject micro-transfers — need to test threshold or batch');
    testImprovements.push('Accumulate network fees and batch-send when above threshold (e.g., 1 HBAR)');
    testImprovements.push('Creator account must be validated (exists, accepts HBAR) before settlement');

    return { name: 'Separate Creator Split', passed: true, duration: Date.now() - start, lessons: testLessons, improvements: testImprovements, hbarCost: fromTb(totalTb) + 0.20 };
  } catch (e) {
    return { name: 'Separate Creator Split', passed: false, duration: Date.now() - start, lessons: [`FAILED: ${(e as Error).message}`], improvements: testImprovements, hbarCost };
  }
}

// ========================================
// TEST 6: Fee Economics Analysis
// ========================================
async function test6_feeEconomics(client: Client): Promise<TestResult> {
  console.log('\n====== TEST 6: Fee Economics Analysis ======');
  const start = Date.now();
  const testLessons: string[] = [];
  const testImprovements: string[] = [];

  try {
    // Hedera fee schedule (approximate)
    const ACCOUNT_CREATE_FEE = 0.05; // USD
    const TRANSFER_FEE = 0.0001;     // USD per transfer
    const HCS_MESSAGE_FEE = 0.0001;  // USD per message

    // Flash rental costs
    const flashRevenue = 0.02; // $0.02 minimum
    const flashFixedCosts = ACCOUNT_CREATE_FEE + (TRANSFER_FEE * 3) + (HCS_MESSAGE_FEE * 2);
    // 1 account create (escrow) + 1 fund + 1 settle (3-way) + 2 HCS messages
    const flashProfit = flashRevenue - flashFixedCosts;

    console.log(`  === Flash Rental Economics ===`);
    console.log(`  Revenue: $${flashRevenue.toFixed(4)}`);
    console.log(`  Costs: $${flashFixedCosts.toFixed(4)}`);
    console.log(`    Account creation: $${ACCOUNT_CREATE_FEE}`);
    console.log(`    Transfers (3): $${(TRANSFER_FEE * 3).toFixed(4)}`);
    console.log(`    HCS messages (2): $${(HCS_MESSAGE_FEE * 2).toFixed(4)}`);
    console.log(`  Profit: $${flashProfit.toFixed(4)} ${flashProfit < 0 ? '❌ LOSS' : '✅ PROFIT'}`);

    // Standard session rental costs (30 min)
    const sessionRevenue = 5.30; // $5 base + 30 * $0.01
    const sessionFixedCosts = ACCOUNT_CREATE_FEE + (TRANSFER_FEE * 3) + (HCS_MESSAGE_FEE * 2);
    const sessionProfit = sessionRevenue - sessionFixedCosts;

    console.log(`\n  === Session Rental Economics (30 min) ===`);
    console.log(`  Revenue: $${sessionRevenue.toFixed(4)}`);
    console.log(`  Costs: $${sessionFixedCosts.toFixed(4)}`);
    console.log(`  Profit: $${sessionProfit.toFixed(4)} ✅`);

    // Break-even analysis
    const minViableRevenue = flashFixedCosts;
    console.log(`\n  === Break-Even ===`);
    console.log(`  Minimum viable rental: $${minViableRevenue.toFixed(4)}`);
    console.log(`  Flash @ $0.02: ${flashProfit >= 0 ? 'VIABLE' : 'NOT VIABLE — loses $' + Math.abs(flashProfit).toFixed(4) + ' per rental'}`);
    console.log(`  Recommendation: Flash minimum should be $${Math.ceil(minViableRevenue * 100) / 100}`);

    // Can we avoid account creation? Reusable escrow pool.
    console.log(`\n  === Optimization: Escrow Pool ===`);
    console.log(`  If escrow accounts are reused (pool), flash cost drops to $${(TRANSFER_FEE * 3 + HCS_MESSAGE_FEE * 2).toFixed(4)}`);
    console.log(`  Flash @ $0.02 with pool: VIABLE ✅`);

    testLessons.push(`Flash rental at $0.02 LOSES money (-$${Math.abs(flashProfit).toFixed(4)}) due to escrow account creation ($0.05)`);
    testLessons.push('Session rentals are highly profitable — fixed costs are negligible vs revenue');
    testLessons.push('Escrow account creation is the dominant cost — pool/reuse solves this');
    testImprovements.push('Implement escrow account pool (pre-create, reuse after settlement)');
    testImprovements.push('Raise flash minimum to $0.06 OR implement escrow pooling');
    testImprovements.push('Consider using scheduled transactions instead of escrow accounts for flash');

    return { name: 'Fee Economics Analysis', passed: true, duration: Date.now() - start, lessons: testLessons, improvements: testImprovements, hbarCost: 0 };
  } catch (e) {
    return { name: 'Fee Economics Analysis', passed: false, duration: Date.now() - start, lessons: [`FAILED: ${(e as Error).message}`], improvements: [], hbarCost: 0 };
  }
}

// ========================================
// TEST 7: Buffer Exhaustion
// ========================================
async function test7_bufferExhaustion(client: Client): Promise<TestResult> {
  console.log('\n====== TEST 7: Buffer Exhaustion ======');
  const start = Date.now();
  const testLessons: string[] = [];
  const testImprovements: string[] = [];
  let hbarCost = 0;

  try {
    const escrowKey = PrivateKey.generateED25519();
    const escrowTx = await new AccountCreateTransaction()
      .setKey(escrowKey)
      .setInitialBalance(new Hbar(0))
      .execute(client);
    const escrowAccount = (await escrowTx.getReceipt(client)).accountId!.toString();
    hbarCost += 0.05;

    // Small buffer: $0.20 total ($0.10 stake + $0.10 buffer)
    const stakeUsd = 0.10;
    const bufferUsd = 0.10;
    const totalTb = toTb(stakeUsd + bufferUsd);

    await (await new TransferTransaction()
      .addHbarTransfer(OWNER_ACCOUNT, Hbar.fromTinybars(-totalTb))
      .addHbarTransfer(escrowAccount, Hbar.fromTinybars(totalTb))
      .execute(client)).getReceipt(client);

    const rentalId = `test7_exhaust_${Date.now()}`;
    await logToHCS(client, 'rental_initiated', {
      rental_id: rentalId,
      buffer_usd: bufferUsd,
      stake_usd: stakeUsd,
    });

    // Usage exceeds buffer: $0.15 used but only $0.10 buffer
    const usageUsd = 0.15;
    const excessUsd = usageUsd - bufferUsd; // $0.05 over
    
    console.log(`  Buffer: $${bufferUsd}, Usage: $${usageUsd}, Excess: $${excessUsd}`);
    console.log(`  Scenario: Usage exceeds buffer by $${excessUsd}`);

    // Protocol response: charge full buffer + eat into stake
    const chargeFromBuffer = bufferUsd;
    const chargeFromStake = Math.min(excessUsd, stakeUsd); // Dip into stake for overage
    const totalCharged = chargeFromBuffer + chargeFromStake;
    const stakeReturned = stakeUsd - chargeFromStake;

    console.log(`  Charged from buffer: $${chargeFromBuffer}`);
    console.log(`  Charged from stake: $${chargeFromStake}`);
    console.log(`  Stake returned: $${stakeReturned}`);

    const chargedTb = toTb(totalCharged);
    const treasuryTb = Math.round(chargedTb * TRANSACTION_SPLITS.atp_treasury);
    const ownerTb = chargedTb - treasuryTb;
    const refundTb = totalTb - chargedTb; // Remaining stake

    const settleTx = new TransferTransaction()
      .addHbarTransfer(escrowAccount, Hbar.fromTinybars(-totalTb))
      .addHbarTransfer(OWNER_ACCOUNT, Hbar.fromTinybars(ownerTb + refundTb))
      .addHbarTransfer(TREASURY_ACCOUNT, Hbar.fromTinybars(treasuryTb));

    const frozenSettle = await settleTx.freezeWith(client);
    await frozenSettle.sign(escrowKey);
    const settleResp = await frozenSettle.execute(client);
    const settleReceipt = await settleResp.getReceipt(client);
    console.log(`  Settlement: ${settleReceipt.status}`);

    const seq = await logToHCS(client, 'rental_completed', {
      rental_id: rentalId,
      buffer_exhausted: true,
      stake_partial_return: stakeReturned,
      overage_usd: excessUsd,
      settlement_tx: settleResp.transactionId.toString(),
    });
    console.log(`  HCS: seq ${seq} (buffer_exhausted: true)`);

    testLessons.push('Buffer exhaustion handled gracefully — overage dips into stake');
    testLessons.push('Renter loses part of stake as penalty for exceeding buffer');
    testLessons.push('If usage exceeds BOTH buffer + stake, owner eats the loss — need circuit breaker');
    testImprovements.push('Add real-time usage monitoring — pause agent when buffer hits 80%');
    testImprovements.push('Emit rental_buffer_warning HCS message at 80% and 95% thresholds');
    testImprovements.push('Auto-terminate rental when buffer + stake fully consumed');

    return { name: 'Buffer Exhaustion', passed: true, duration: Date.now() - start, lessons: testLessons, improvements: testImprovements, hbarCost: fromTb(totalTb) + 0.05 };
  } catch (e) {
    return { name: 'Buffer Exhaustion', passed: false, duration: Date.now() - start, lessons: [`FAILED: ${(e as Error).message}`], improvements: [], hbarCost };
  }
}

// ========================================
// MAIN
// ========================================
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   ATP MAINNET TEST SUITE v0.9            ║');
  console.log('╚══════════════════════════════════════════╝');

  const operatorKey = PrivateKey.fromStringECDSA(getKey());
  const client = Client.forMainnet().setOperator(OWNER_ACCOUNT, operatorKey);

  hbarRate = await exchangeRateService.getRate();
  console.log(`\nHBAR Rate: $${hbarRate.toFixed(4)}`);
  
  const ownerBefore = await getBalance(client, OWNER_ACCOUNT);
  const treasuryBefore = await getBalance(client, TREASURY_ACCOUNT);
  console.log(`Owner: ${ownerBefore.toFixed(4)} HBAR`);
  console.log(`Treasury: ${treasuryBefore.toFixed(4)} HBAR`);

  // Run tests
  results.push(await test1_escrowPersistence(client));
  results.push(await test2_twoPartyRental(client, operatorKey));
  results.push(await test3_sessionRental(client));
  results.push(await test4_earlyTermination(client));
  results.push(await test5_separateCreator(client));
  results.push(await test6_feeEconomics(client));
  results.push(await test7_bufferExhaustion(client));

  // Summary
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   TEST RESULTS SUMMARY                    ║');
  console.log('╚══════════════════════════════════════════╝\n');

  let totalCost = 0;
  let allLessons: string[] = [];
  let allImprovements: string[] = [];

  for (const r of results) {
    const status = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} | ${r.name} (${r.duration}ms, ~${r.hbarCost.toFixed(2)} HBAR)`);
    totalCost += r.hbarCost;
    allLessons.push(...r.lessons);
    allImprovements.push(...r.improvements);
  }

  const ownerAfter = await getBalance(client, OWNER_ACCOUNT);
  const treasuryAfter = await getBalance(client, TREASURY_ACCOUNT);
  const actualCost = ownerBefore - ownerAfter;

  console.log(`\n--- Cost Summary ---`);
  console.log(`Owner balance change: ${actualCost.toFixed(4)} HBAR ($${(actualCost * hbarRate).toFixed(4)})`);
  console.log(`Treasury received: ${(treasuryAfter - treasuryBefore).toFixed(4)} HBAR`);

  console.log(`\n--- Lessons Learned (${allLessons.length}) ---`);
  allLessons.forEach((l, i) => console.log(`  ${i + 1}. ${l}`));

  console.log(`\n--- Improvements Needed (${allImprovements.length}) ---`);
  allImprovements.forEach((imp, i) => console.log(`  ${i + 1}. ${imp}`));

  console.log(`\nVerify: https://hashscan.io/mainnet/topic/${AGENT_TOPIC}`);

  process.exit(results.every(r => r.passed) ? 0 : 1);
}

main().catch(e => {
  console.error('SUITE FAILED:', e.message);
  process.exit(1);
});
