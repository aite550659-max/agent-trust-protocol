/**
 * ATP Configuration constants
 */

export const ATP_VERSION = '1.0';
export const HCS_SCHEMA_VERSION = '2.0';

export const MINIMUM_PRICING = {
  flashBaseFee: 0.02,      // $0.02 minimum (prevents spam)
  standardBaseFee: 5.00,   // $5.00 minimum (ensures sustainability)
};

export const DEFAULT_INDEXER_URLS = {
  mainnet: 'https://atp-indexer.hedera.com',
  testnet: 'https://atp-indexer-testnet.hedera.com',
  previewnet: 'https://atp-indexer-preview.hedera.com',
};

export const NETWORK_ACCOUNTS = {
  mainnet: {
    network: '0.0.800',
    treasury: '0.0.801',
  },
  testnet: {
    network: '0.0.800',
    treasury: '0.0.801',
  },
  previewnet: {
    network: '0.0.800',
    treasury: '0.0.801',
  },
};

export const TRANSACTION_SPLITS = {
  creator_royalty: 0.05,      // 5%
  network_contribution: 0.02,  // 2%
  atp_treasury: 0.01,          // 1%
  owner_revenue: 0.92,         // 92%
};

export const REPUTATION_DELTAS = {
  rental_completed: 10,
  early_termination_renter: -5,
  early_termination_owner: 0,
  violation: -20,
  stake_slashed: -50,
  dispute_won: 5,
  dispute_lost: -30,
  arbiter_overturned: -100,
};

export const TRUST_TIERS = [
  { tier: 0, name: 'unverified', minStake: 0 },
  { tier: 1, name: 'basic', minStake: 100 },
  { tier: 2, name: 'verified', minStake: 1000 },
  { tier: 3, name: 'professional', minStake: 10000 },
  { tier: 4, name: 'enterprise', minStake: 100000 },
];
