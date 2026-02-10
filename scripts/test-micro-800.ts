/**
 * Test micro payment to 0.0.800 (Hedera network account)
 * Validates that ATP network fee split will work
 */
import {
  Client,
  PrivateKey,
  TransferTransaction,
  Hbar,
  HbarUnit,
  AccountBalanceQuery,
} from '@hashgraph/sdk';
import { execSync } from 'child_process';

const OWNER_ACCOUNT = '0.0.10255397';

function getKey(): string {
  return execSync('security find-generic-password -s "aite-private-key" -a "hedera" -w', { encoding: 'utf8' }).trim();
}

async function main() {
  const key = PrivateKey.fromStringECDSA(getKey());
  const client = Client.forMainnet().setOperator(OWNER_ACCOUNT, key);

  // Check starting balance
  const balBefore = await new AccountBalanceQuery().setAccountId(OWNER_ACCOUNT).execute(client);
  console.log(`Owner balance before: ${balBefore.hbars.toString()}`);

  // Send 1 tinybar (0.00000001 HBAR) to 0.0.800
  const amounts = [1, 100, 10000]; // 1 tinybar, 100 tinybar, 10000 tinybar (0.0001 HBAR)
  
  for (const tinybars of amounts) {
    try {
      console.log(`\nSending ${tinybars} tinybar to 0.0.800...`);
      const tx = await new TransferTransaction()
        .addHbarTransfer(OWNER_ACCOUNT, Hbar.fromTinybars(-tinybars))
        .addHbarTransfer('0.0.800', Hbar.fromTinybars(tinybars))
        .execute(client);

      const receipt = await tx.getReceipt(client);
      console.log(`  ✅ Status: ${receipt.status} | Tx: ${tx.transactionId.toString()}`);
    } catch (err: any) {
      console.log(`  ❌ Failed: ${err.message?.slice(0, 120)}`);
    }
  }

  // Check ending balance
  const balAfter = await new AccountBalanceQuery().setAccountId(OWNER_ACCOUNT).execute(client);
  console.log(`\nOwner balance after: ${balAfter.hbars.toString()}`);
  console.log(`Cost (including fees): ${(balBefore.hbars.toTinybars().toNumber() - balAfter.hbars.toTinybars().toNumber())} tinybar`);

  client.close();
}

main().catch(console.error);
