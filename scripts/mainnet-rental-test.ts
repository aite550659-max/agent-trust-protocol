/**
 * ATP Mainnet Rental Flow Test
 * 
 * Full lifecycle: initiate → complete → verify settlement on-chain
 * 
 * Accounts:
 * - Owner/Agent: 0.0.10255397 (Aite main)
 * - Renter: 0.0.10260562 (test renter)
 * - Treasury: 0.0.8332371
 * - Network: 0.0.800
 * - Creator: 0.0.10255397 (same as owner for this test — Aite created herself)
 * 
 * Agent HCS Topic: 0.0.10261370
 */

import {
  Client,
  PrivateKey,
  AccountBalanceQuery,
  AccountId,
  Hbar,
  TransferTransaction,
  TopicMessageSubmitTransaction,
  Status,
} from '@hashgraph/sdk';
import { execSync } from 'child_process';
import { exchangeRateService } from '../src/exchange-rate';
import { TRANSACTION_SPLITS, NETWORK_ACCOUNTS } from '../src/config';

// Config
const AGENT_TOPIC = '0.0.10261370';
const OWNER_ACCOUNT = '0.0.10255397';
const RENTER_ACCOUNT = '0.0.10260562';
const CREATOR_ACCOUNT = '0.0.10255397'; // Aite is both owner and creator
const TREASURY_ACCOUNT = NETWORK_ACCOUNTS.mainnet.treasury;
const NETWORK_ACCOUNT = NETWORK_ACCOUNTS.mainnet.network;

function getKey(): string {
  return execSync('security find-generic-password -s "aite-private-key" -a "hedera" -w', { encoding: 'utf8' }).trim();
}

async function getBalance(client: Client, accountId: string): Promise<number> {
  const balance = await new AccountBalanceQuery().setAccountId(accountId).execute(client);
  return balance.hbars.toTinybars().toNumber() / 1e8;
}

async function main() {
  console.log('=== ATP MAINNET RENTAL FLOW TEST ===\n');

  // Setup clients
  const operatorKey = PrivateKey.fromStringECDSA(getKey());
  const ownerClient = Client.forMainnet().setOperator(OWNER_ACCOUNT, operatorKey);
  const renterClient = Client.forMainnet().setOperator(RENTER_ACCOUNT, operatorKey);

  // Step 0: Get HBAR rate and capture starting balances
  const hbarRate = await exchangeRateService.getRate();
  console.log(`HBAR Rate: $${hbarRate.toFixed(4)}`);

  const balancesBefore: Record<string, number> = {};
  for (const [name, id] of [['Owner', OWNER_ACCOUNT], ['Renter', RENTER_ACCOUNT], ['Treasury', TREASURY_ACCOUNT]]) {
    balancesBefore[name] = await getBalance(ownerClient, id);
    console.log(`${name} (${id}): ${balancesBefore[name].toFixed(4)} HBAR`);
  }

  // Step 1: Rental parameters (flash rental — minimal cost)
  const rentalType = 'flash';
  const stakeUsd = 0.10;   // $0.10 stake
  const bufferUsd = 0.10;  // $0.10 usage buffer
  const usageCostUsd = 0.05; // Simulated usage: $0.05
  
  // Use tinybars to avoid floating point precision issues
  const toTinybars = (usd: number) => Math.round((usd / hbarRate) * 1e8);
  const fromTinybars = (tb: number) => tb / 1e8;
  
  const stakeTb = toTinybars(stakeUsd);
  const bufferTb = toTinybars(bufferUsd);
  const totalTb = stakeTb + bufferTb;
  const stakeHbar = fromTinybars(stakeTb);
  const bufferHbar = fromTinybars(bufferTb);
  const totalHbar = fromTinybars(totalTb);

  console.log(`\n--- STEP 1: Initiate Rental ---`);
  console.log(`Type: ${rentalType}`);
  console.log(`Stake: $${stakeUsd} (${stakeHbar.toFixed(4)} HBAR)`);
  console.log(`Buffer: $${bufferUsd} (${bufferHbar.toFixed(4)} HBAR)`);
  console.log(`Total escrow: ${totalHbar.toFixed(4)} HBAR`);

  // Step 2: Create escrow account (using owner as operator — in production, renter's client would do this)
  const { AccountCreateTransaction } = await import('@hashgraph/sdk');
  const escrowKey = PrivateKey.generateED25519();
  const escrowTx = await new AccountCreateTransaction()
    .setKey(escrowKey)
    .setInitialBalance(new Hbar(0))
    .execute(ownerClient);
  const escrowReceipt = await escrowTx.getReceipt(ownerClient);
  const escrowAccount = escrowReceipt.accountId!.toString();
  console.log(`Escrow account created: ${escrowAccount}`);

  // Step 3: Fund escrow (from owner account acting as renter for this test)
  const fundTx = await new TransferTransaction()
    .addHbarTransfer(OWNER_ACCOUNT, Hbar.fromTinybars(-totalTb))
    .addHbarTransfer(escrowAccount, Hbar.fromTinybars(totalTb))
    .execute(ownerClient);
  const fundReceipt = await fundTx.getReceipt(ownerClient);
  console.log(`Escrow funded: ${fundReceipt.status}`);

  // Step 4: Log rental_initiated to HCS
  const rentalId = `rental_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const initiateMsg = JSON.stringify({
    type: 'rental_initiated',
    version: '0.9',
    timestamp: new Date().toISOString(),
    agent_id: AGENT_TOPIC,
    data: {
      rental_id: rentalId,
      renter: RENTER_ACCOUNT,
      owner: OWNER_ACCOUNT,
      rental_type: rentalType,
      stake_usd: stakeUsd,
      stake_hbar: stakeHbar,
      usage_buffer_usd: bufferUsd,
      usage_buffer_hbar: bufferHbar,
      escrow_account: escrowAccount,
      hbar_rate_usd: hbarRate,
    },
  });

  const hcsInitTx = await new TopicMessageSubmitTransaction()
    .setTopicId(AGENT_TOPIC)
    .setMessage(initiateMsg)
    .execute(ownerClient);
  const hcsInitReceipt = await hcsInitTx.getReceipt(ownerClient);
  console.log(`HCS rental_initiated: ${hcsInitReceipt.status} (seq: ${hcsInitReceipt.topicSequenceNumber})`);

  console.log(`\nRental ID: ${rentalId}`);
  console.log(`\n--- STEP 2: Simulate Usage ---`);
  console.log(`Simulated: 1 instruction, 500 tokens, $${usageCostUsd} cost`);

  // Step 5: Complete rental — settle escrow
  console.log(`\n--- STEP 3: Complete & Settle ---`);

  const totalCharged = usageCostUsd;
  const creatorRoyalty = totalCharged * TRANSACTION_SPLITS.creator_royalty;
  const networkContribution = totalCharged * TRANSACTION_SPLITS.network_contribution;
  const atpTreasury = totalCharged * TRANSACTION_SPLITS.atp_treasury;
  const ownerRevenue = totalCharged * TRANSACTION_SPLITS.owner_revenue;

  const chargedTb = toTinybars(totalCharged);
  const creatorTb = toTinybars(creatorRoyalty);
  const networkTb = toTinybars(networkContribution);
  const treasuryTb = toTinybars(atpTreasury);
  const ownerTb = toTinybars(ownerRevenue);
  const stakeReturnTb = stakeTb;
  const unusedBufferTb = toTinybars(Math.max(0, bufferUsd - totalCharged));
  const renterRefundTb = stakeReturnTb + unusedBufferTb;

  console.log(`Total charged: $${totalCharged} (${fromTinybars(chargedTb).toFixed(4)} HBAR)`);
  console.log(`  Owner (92%): $${ownerRevenue.toFixed(4)} (${fromTinybars(ownerTb).toFixed(4)} HBAR)`);
  console.log(`  Creator (5%): $${creatorRoyalty.toFixed(4)} (${fromTinybars(creatorTb).toFixed(4)} HBAR)`);
  console.log(`  Network (2%): $${networkContribution.toFixed(4)} (${fromTinybars(networkTb).toFixed(4)} HBAR)`);
  console.log(`  Treasury (1%): $${atpTreasury.toFixed(4)} (${fromTinybars(treasuryTb).toFixed(4)} HBAR)`);
  console.log(`  Renter refund: ${fromTinybars(renterRefundTb).toFixed(4)} HBAR (stake + unused buffer)`);

  // Owner gets owner + creator + network share (same account in this test, network account can't receive tiny amounts)
  // Absorb dust into owner share
  const ownerTotalTb = totalTb - treasuryTb - renterRefundTb;

  console.log(`  Owner total (incl creator+network): ${fromTinybars(ownerTotalTb).toFixed(4)} HBAR`);

  // Settlement transaction
  const settle = new TransferTransaction();
  settle.addHbarTransfer(escrowAccount, Hbar.fromTinybars(-totalTb));
  settle.addHbarTransfer(OWNER_ACCOUNT, Hbar.fromTinybars(ownerTotalTb));
  settle.addHbarTransfer(TREASURY_ACCOUNT, Hbar.fromTinybars(treasuryTb));
  settle.addHbarTransfer(RENTER_ACCOUNT, Hbar.fromTinybars(renterRefundTb));

  const frozenSettle = await settle.freezeWith(ownerClient);
  await frozenSettle.sign(escrowKey);
  const settleResponse = await frozenSettle.execute(ownerClient);
  const settleReceipt = await settleResponse.getReceipt(ownerClient);
  console.log(`\nSettlement tx: ${settleReceipt.status} (${settleResponse.transactionId})`);

  // Step 6: Log rental_completed to HCS
  const completeMsg = JSON.stringify({
    type: 'rental_completed',
    version: '0.9',
    timestamp: new Date().toISOString(),
    agent_id: AGENT_TOPIC,
    data: {
      rental_id: rentalId,
      renter: RENTER_ACCOUNT,
      owner: OWNER_ACCOUNT,
      creator: CREATOR_ACCOUNT,
      rental_type: rentalType,
      duration_minutes: 0,
      usage: { instructions: 1, tokens: 500, cost_usd: usageCostUsd },
      total_charged_usd: totalCharged,
      total_charged_hbar: fromTinybars(chargedTb),
      hbar_rate_usd: hbarRate,
      distribution_usd: {
        owner: ownerRevenue,
        creator: creatorRoyalty,
        network: networkContribution,
        treasury: atpTreasury,
      },
      settlement_tx: settleResponse.transactionId.toString(),
      stake_returned: true,
      unused_buffer_refunded_hbar: fromTinybars(unusedBufferTb),
    },
  });

  const hcsCompleteTx = await new TopicMessageSubmitTransaction()
    .setTopicId(AGENT_TOPIC)
    .setMessage(completeMsg)
    .execute(ownerClient);
  const hcsCompleteReceipt = await hcsCompleteTx.getReceipt(ownerClient);
  console.log(`HCS rental_completed: ${hcsCompleteReceipt.status} (seq: ${hcsCompleteReceipt.topicSequenceNumber})`);

  // Step 7: Verify final balances
  console.log(`\n--- FINAL BALANCES ---`);
  for (const [name, id] of [['Owner', OWNER_ACCOUNT], ['Renter', RENTER_ACCOUNT], ['Treasury', TREASURY_ACCOUNT]]) {
    const after = await getBalance(ownerClient, id);
    const diff = after - balancesBefore[name];
    console.log(`${name}: ${after.toFixed(4)} HBAR (${diff >= 0 ? '+' : ''}${diff.toFixed(4)})`);
  }

  console.log(`\n=== RENTAL FLOW TEST COMPLETE ===`);
  console.log(`Verify on HashScan: https://hashscan.io/mainnet/topic/${AGENT_TOPIC}`);
  console.log(`Settlement tx: https://hashscan.io/mainnet/transaction/${settleResponse.transactionId}`);

  process.exit(0);
}

main().catch(e => {
  console.error('TEST FAILED:', e.message);
  process.exit(1);
});
