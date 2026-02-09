/**
 * Basic Rental Example
 * 
 * Demonstrates:
 * 1. Initialize ATP client
 * 2. Query agent information
 * 3. Initiate a rental
 * 4. Check rental status
 * 5. Complete rental
 */

import { ATPClient } from '../src';

async function main() {
  // Initialize client
  const atp = new ATPClient({
    network: 'testnet',
    operatorId: process.env.HEDERA_ACCOUNT_ID!,
    operatorKey: process.env.HEDERA_PRIVATE_KEY!,
    indexerUrl: 'https://atp-indexer-testnet.hedera.com'
  });

  try {
    // Get agent information
    const agentId = '0.0.XXXXXX';
    const agentResponse = await atp.indexer.getAgent(agentId);
    
    if (!agentResponse.success) {
      throw new Error(`Failed to get agent: ${agentResponse.error}`);
    }

    const agent = agentResponse.data!;
    console.log(`Agent: ${agent.name}`);
    console.log(`Owner: ${agent.owner}`);
    console.log(`Soul Hash: ${agent.soulHash}`);

    // Check renter reputation
    const repResponse = await atp.indexer.getReputation(atp.config.operatorId);
    
    if (!repResponse.success) {
      throw new Error(`Failed to get reputation: ${repResponse.error}`);
    }

    const reputation = repResponse.data!;
    console.log(`Your reputation: ${reputation.score}`);

    // Initiate rental
    console.log('Initiating rental...');
    const rental = await atp.rentals.initiate({
      agentId: agentId,
      type: 'session',
      stake: 50.00,        // $50 USD stake
      buffer: 100.00,      // $100 usage buffer
      constraints: {
        toolsBlocked: ['wallet', 'exec_elevated'],
        memoryAccessLevel: 'sandboxed',
        topicsBlocked: [],
        maxPerInstructionCost: 10.00,
        maxDailyCost: 100.00
      }
    });

    console.log(`Rental initiated: ${rental.rentalId}`);
    console.log(`Escrow account: ${rental.escrowAccount}`);

    // Check rental status periodically
    console.log('Checking rental status...');
    const statusResponse = await atp.indexer.getRentalStatus(rental.rentalId);
    
    if (!statusResponse.success) {
      throw new Error(`Failed to get status: ${statusResponse.error}`);
    }

    const status = statusResponse.data!;
    console.log(`Status: ${status.status}`);
    console.log(`Usage to date: $${status.usageToDate || 0}`);

    // ... do work with the agent ...

    // Complete rental
    console.log('Completing rental...');
    await atp.rentals.complete(rental.rentalId, {
      totalInstructions: 12,
      totalTokens: 24000,
      totalCost: 8.50,
      uptimePercentage: 100.0
    });

    console.log('Rental completed successfully!');

  } finally {
    // Clean up
    await atp.close();
  }
}

// Run example
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
