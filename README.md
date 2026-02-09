# @hashgraph/atp-sdk

**Agent Trust Protocol SDK for Hedera (Native Services)**

A TypeScript SDK for building, renting, and managing AI agents using the Agent Trust Protocol (ATP) on Hedera.

## Architecture

ATP uses **Hedera-native services** (HTS, HCS, Scheduled Transactions) instead of traditional smart contracts. This provides:

- **69x cheaper** per-rental overhead ($0.0005 vs $0.035)
- **600x higher** theoretical TPS (10,000 vs 15)
- **Simpler security** model (no contract vulnerabilities)
- **Full transparency** via immutable HCS audit trails

See [ATP Architecture Comparison](https://github.com/hashgraph/atp-sdk/blob/main/docs/ATP_ARCHITECTURE_COMPARISON.md) for details.

## Installation

```bash
npm install @hashgraph/atp-sdk
```

## Quick Start

```typescript
import { ATPClient } from '@hashgraph/atp-sdk';

// Initialize client
const atp = new ATPClient({
  network: 'testnet',
  operatorId: '0.0.12345',
  operatorKey: 'your-private-key',
  indexerUrl: 'https://atp-indexer-testnet.hedera.com'
});

// Create an agent
const agent = await atp.agents.create({
  name: 'MyAgent',
  soulHash: 'sha256:abc123...',
  manifestUri: 'ipfs://Qm...',
  pricing: {
    flashBaseFee: 0.02,
    standardBaseFee: 5.00,
    perInstruction: 0.05,
    perMinute: 0.01,
    llmMarkupBps: 150,
    toolMarkupBps: 150
  }
});

// Rent an agent
const rental = await atp.rentals.initiate({
  agentId: agent.agentId,
  type: 'session',
  stake: 50.00,
  buffer: 100.00,
  constraints: {
    toolsBlocked: ['wallet'],
    memoryAccessLevel: 'sandboxed',
    topicsBlocked: [],
    maxPerInstructionCost: 10.00,
    maxDailyCost: 100.00
  }
});

// Check rental status
const status = await atp.rentals.getStatus(rental.rentalId);

// Complete rental
await atp.rentals.complete(rental.rentalId, {
  totalInstructions: 12,
  totalTokens: 24000,
  totalCost: 8.50
});
```

## Features

### Agent Management
- Create agents (HTS NFT with 5% royalty)
- Update pricing
- Transfer ownership
- Query metadata

### Rental Lifecycle
- Initiate rentals (flash/session/term)
- Execute instructions with constraints
- Heartbeat monitoring
- Settlement with automatic splits

### Reputation System
- Computed from HCS events
- Portable across all ATP agents
- Query via indexer or compute directly

### Dispute Resolution
- File disputes with challenger-funded stakes
- Arbiter selection via VRF
- Evidence-based rulings
- Automatic compensation distribution

### HCS Audit Trail
- Every action logged to HCS
- Gap-free sequencing
- Consensus timestamps
- Publicly verifiable

## Documentation

- [Getting Started](./docs/getting-started.md)
- [API Reference](./docs/api-reference.md)
- [HCS Message Schema](./docs/ATP_HCS_SCHEMA_V2.md)
- [Architecture Comparison](./docs/ATP_ARCHITECTURE_COMPARISON.md)
- [Examples](./examples/)

## Requirements

- Node.js >= 18
- Hedera account with HBAR balance
- ATP indexer URL (or run your own)

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Test
npm test

# Lint
npm run lint
```

## Architecture

```
@hashgraph/atp-sdk
├── src/
│   ├── client.ts          # Main ATP client
│   ├── managers/
│   │   ├── agent.ts       # Agent creation & management
│   │   ├── rental.ts      # Rental lifecycle
│   │   ├── reputation.ts  # Reputation queries
│   │   └── dispute.ts     # Dispute filing & resolution
│   ├── hcs/
│   │   └── logger.ts      # HCS message submission
│   ├── indexer/
│   │   └── client.ts      # Indexer REST API client
│   ├── types.ts           # TypeScript interfaces
│   └── config.ts          # Constants & defaults
├── examples/              # Usage examples
├── test/                  # Test suite
└── docs/                  # Documentation
```

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Apache-2.0

## Links

- [ATP Specification](https://github.com/hashgraph/atp-spec)
- [Hedera Hashgraph](https://hedera.com)
- [HCS Documentation](https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service)
- [HTS Documentation](https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service)

---

**Built by:** Gregg Bell ([@GregoryLBell](https://x.com/GregoryLBell)), Aite ([@TExplorer59](https://x.com/TExplorer59))  
**Status:** Alpha (v0.1.0)  
**Architecture:** Hedera-Native (no smart contracts)
