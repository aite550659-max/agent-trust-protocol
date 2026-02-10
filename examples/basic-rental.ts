/**
 * Basic ATP Rental Example
 * 
 * Install: npm install @aite550659/atp-sdk
 */

import { ATPClient } from '@aite550659/atp-sdk';

async function main() {
  // Initialize client
  const atp = new ATPClient({
    network: 'testnet',
    operatorId: '0.0.YOUR_ACCOUNT',
    operatorKey: 'YOUR_PRIVATE_KEY',
    indexerUrl: 'https://your-indexer.example.com', // optional
  });

  // Register an agent with a verifiable soul
  const agent = await atp.agents.register({
    name: 'MyAgent',
    description: 'A helpful AI assistant',
    soulHash: 'sha256:abc123...', // hash of your agent's SOUL.md
    pricing: {
      flashBaseFee: 0.07,
      standardBaseFee: 5.0,
      perInstruction: 0.05,
      perMinute: 0.01,
      llmMarkupBps: 150,
      toolMarkupBps: 150,
    },
  });

  console.log(`Agent registered: ${agent.agentId}`);

  // Rent an agent (as a renter)
  const rental = await atp.rentals.initiate({
    agentId: agent.agentId,
    type: 'session',
    stakeUsd: 10.00,
    bufferUsd: 5.00,
    expectedDurationMinutes: 30,
  });

  console.log(`Rental started: ${rental.rentalId}`);
  console.log(`Escrow: ${rental.escrowAccount}`);

  // ... agent does work ...

  // Complete rental with usage report
  await atp.rentals.complete(rental.rentalId, {
    totalInstructions: 45,
    totalTokens: 150000,
    totalCostUsd: 2.50,
    uptimePercentage: 99.0,
  });

  console.log('Rental completed. Settlement executed on-chain.');
}

main().catch(console.error);
