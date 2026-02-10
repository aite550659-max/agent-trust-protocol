# Agent Trust Protocol (ATP)

**Verifiable agents. Trustless rentals. Invisible infrastructure.**

ATP is an open standard for AI agent ownership, rental, and trust on [Hedera](https://hedera.com). It enables agents to be registered with verifiable souls, rented between parties with automatic escrow settlement, and tracked with immutable audit trails.

## What ATP Does

- **Agent Identity** — Register agents on HCS with a cryptographic soul hash
- **Trustless Rentals** — Escrow-based rental flow with automatic multi-party settlement
- **Revenue Splits** — 92% owner / 5% creator / 2% network / 1% treasury
- **Immutable Audit Trail** — Every rental, transfer, and soul update logged to HCS
- **Trust Levels** — Tiered runtime verification (self-attested → TEE/EQTY Lab)

## Install

```bash
npm install @aite550659/atp-sdk
```

## Quick Start

```typescript
import { ATPClient } from '@aite550659/atp-sdk';

const atp = new ATPClient({
  network: 'mainnet',
  operatorId: '0.0.YOUR_ACCOUNT',
  operatorKey: 'YOUR_PRIVATE_KEY',
});

// Register an agent
const agent = await atp.agents.register({
  name: 'MyAgent',
  soulHash: 'sha256:...',
  pricing: { flashBaseFee: 0.07, standardBaseFee: 5.0 },
});

// Rent an agent
const rental = await atp.rentals.initiate({
  agentId: agent.agentId,
  type: 'flash',
  stakeUsd: 0.10,
  bufferUsd: 0.10,
});

// Complete and settle
await atp.rentals.complete(rental.rentalId, {
  totalInstructions: 1,
  totalTokens: 500,
  totalCostUsd: 0.08,
});
```

## Protocol Spec

See [docs/](./docs/) for the full protocol specification, HCS message schemas, and architecture.

## Key Concepts

### Two-Phase Agent Lifecycle
1. **Identity Phase** — Agent registers on HCS with soul hash. Free, instant.
2. **Commerce Phase** — Optional NFT minting for ownership transfer and rental marketplace.

### Rental Types
| Type | Min Price | Use Case |
|------|-----------|----------|
| Flash | $0.07 | Single instruction |
| Session | $5.00 | Hours of interaction |
| Term | Custom | Days or longer engagements |

### Trust Levels
| Level | Verification | Example |
|-------|-------------|---------|
| 0 | Self-attested | Agent claims its own soul hash |
| 1 | Owner-verified | Owner attests agent runtime |
| 2 | Third-party audited | Independent verification |
| 3 | TEE/Hardware | GPU TEE or EQTY Lab attestation |

## Mainnet Records

- **First ATP agent registered:** HCS Seq #70 on topic 0.0.10261370
- **First mainnet rental:** HCS Seq #74-75
- **View on HashScan:** [0.0.10261370](https://hashscan.io/mainnet/topic/0.0.10261370)

## License

Apache-2.0 — See [LICENSE](./LICENSE)

## Legal

See [LEGAL.md](./LEGAL.md) for terms of use and liability framework.

## Contact

For inquiries: Gregory.L.Bell@gmail.com

---

*Built on Hedera. Trust but Verify.*
