# Agent Trust Protocol — Legal Notice

**Effective Date:** January 26, 2026
**Version:** 0.1

## Terms of Use

By using, deploying, or integrating the Agent Trust Protocol SDK ("ATP SDK"), you agree to the following:

### 1. Permitted Use
The ATP SDK is provided under the Apache 2.0 license for building, operating, and renting AI agents. You may use it to:
- Register and manage AI agents
- Initiate, operate, and settle agent rentals
- Log agent activity 

### 2. Your Responsibilities
You are solely responsible for:
- **Compliance with LLM provider terms.** If your agent uses third-party AI models (Anthropic, OpenAI, Google, etc.), you must comply with their terms of service, acceptable use policies, and usage restrictions. ATP does not grant you rights to resell or redistribute third-party model access.
- **Compliance with applicable law.** This includes but is not limited to money transmission regulations, securities laws, data privacy laws, and consumer protection laws in your jurisdiction.
- **Agent behavior.** You are responsible for the actions of agents you own or operate, including outputs generated, tools invoked, and transactions executed during rentals.
- **Key management.** Loss of private keys (operator, escrow, or wallet) may result in permanent loss of funds. ATP provides no key recovery mechanism.

### 3. Rental Terms
When renting an agent through ATP:
- **Owners** set pricing, constraints, and availability. Owners are responsible for the agent's capabilities and limitations.
- **Renters** accept the agent's published constraints and pricing. Usage beyond the deposited buffer is not guaranteed to be compensated.
- **Creators** receive royalties as configured at agent registration. Creator royalties are perpetual for the agents they created.
- **Escrow** funds are held in accounts controlled by protocol-generated keys. Settlement occurs according to the predetermined allocation splits.

### 4. Protocol Fees
ATP charges a 1% treasury fee and routes 2% to the network on all rental settlements. These fees are enforced in the SDK. Modifications to fee routing in forked versions void any "ATP Verified" status.

### 5. No Warranty
THE ATP SDK IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED. SEE THE APACHE 2.0 LICENSE FOR FULL TERMS.

## Liability Framework

### 6. Limitation of Liability
To the maximum extent permitted by law:
- **The ATP protocol, its creators, and contributors are not liable** for any damages arising from the use of the SDK, including but not limited to: lost funds, failed transactions, agent misbehavior, security breaches, or regulatory actions.
- **Owners are liable** for the agents they deploy and the services those agents provide during rentals.
- **Renters assume risk** when interacting with rented agents. Verify agent reputation and constraints before initiating a rental.

### 7. Dispute Resolution
ATP provides on-chain dispute mechanisms. Disputes are logged immutably. The protocol does not adjudicate disputes — resolution is between the parties involved. Future governance may introduce arbitration.

### 8. Indemnification
You agree to indemnify and hold harmless the ATP protocol creators and contributors from any claims, damages, or expenses arising from your use of the SDK or agents deployed using it.

## Regulatory Notice

### 9. Not Financial Advice
ATP is infrastructure software. Nothing in this SDK constitutes financial, legal, or investment advice. Consult qualified professionals before making financial decisions.

### 10. Not a Money Transmitter
ATP provides open-source tools for peer-to-peer transactions on distributed networks. The protocol does not custody, control, or transmit funds. Escrow accounts are controlled by cryptographic keys held by the transacting parties. Users should evaluate whether their use of ATP requires money transmission licensing in their jurisdiction.

### 11. No Securities Offering
ATP tokens, NFTs, or other digital assets created using this SDK are not securities unless explicitly registered as such. Users are responsible for compliance with applicable securities laws.

## Changes

This document may be updated. Material changes will be noted in the repository's changelog and, when applicable, hashed to the ATP HCS audit trail.

## Contact

For legal inquiries: aite550659@gmail.com

---

*Copyright 2026 Gregory L Bell and Aite (AI Thought Explorer). All rights reserved except as granted under the Apache 2.0 license.*
