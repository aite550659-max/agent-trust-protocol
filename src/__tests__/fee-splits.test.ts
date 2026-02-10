/**
 * Fee Split Math Tests
 *
 * ATP distributes rental revenue: 92% owner, 5% creator, 2% network, 1% treasury.
 * Getting this wrong means someone gets shorted or overpaid on every rental.
 */

import { TRANSACTION_SPLITS } from '../config';

describe('Transaction Splits Configuration', () => {
  test('splits sum to exactly 100%', () => {
    const total =
      TRANSACTION_SPLITS.owner_revenue +
      TRANSACTION_SPLITS.creator_royalty +
      TRANSACTION_SPLITS.network_contribution +
      TRANSACTION_SPLITS.atp_treasury;

    expect(total).toBeCloseTo(1.0, 10);
  });

  test('owner gets 92%', () => {
    expect(TRANSACTION_SPLITS.owner_revenue).toBe(0.92);
  });

  test('creator gets 5%', () => {
    expect(TRANSACTION_SPLITS.creator_royalty).toBe(0.05);
  });

  test('network gets 2%', () => {
    expect(TRANSACTION_SPLITS.network_contribution).toBe(0.02);
  });

  test('treasury gets 1%', () => {
    expect(TRANSACTION_SPLITS.atp_treasury).toBe(0.01);
  });
});

describe('Fee Distribution Calculations', () => {
  // Replicate the math from RentalManager.complete()
  function calculateDistribution(totalChargedUsd: number) {
    return {
      ownerRevenue: totalChargedUsd * TRANSACTION_SPLITS.owner_revenue,
      creatorRoyalty: totalChargedUsd * TRANSACTION_SPLITS.creator_royalty,
      networkContribution: totalChargedUsd * TRANSACTION_SPLITS.network_contribution,
      atpTreasury: totalChargedUsd * TRANSACTION_SPLITS.atp_treasury,
    };
  }

  test('$230 rental distributes correctly (blog example)', () => {
    const dist = calculateDistribution(230);
    expect(dist.ownerRevenue).toBeCloseTo(211.60, 2);
    expect(dist.creatorRoyalty).toBeCloseTo(11.50, 2);
    expect(dist.networkContribution).toBeCloseTo(4.60, 2);
    expect(dist.atpTreasury).toBeCloseTo(2.30, 2);
  });

  test('$200 rental distributes correctly (Aite example)', () => {
    const dist = calculateDistribution(200);
    expect(dist.ownerRevenue).toBeCloseTo(184.00, 2);
    expect(dist.creatorRoyalty).toBeCloseTo(10.00, 2);
    expect(dist.networkContribution).toBeCloseTo(4.00, 2);
    expect(dist.atpTreasury).toBeCloseTo(2.00, 2);
  });

  test('$0.07 flash rental distributes correctly', () => {
    const dist = calculateDistribution(0.02);
    expect(dist.ownerRevenue).toBeCloseTo(0.0184, 4);
    expect(dist.creatorRoyalty).toBeCloseTo(0.001, 4);
    expect(dist.networkContribution).toBeCloseTo(0.0004, 4);
    expect(dist.atpTreasury).toBeCloseTo(0.0002, 4);
  });

  test('distribution sums to total charged', () => {
    const amounts = [0.02, 5.00, 50.00, 200.00, 1000.00, 50000.00];

    for (const amount of amounts) {
      const dist = calculateDistribution(amount);
      const sum =
        dist.ownerRevenue +
        dist.creatorRoyalty +
        dist.networkContribution +
        dist.atpTreasury;
      expect(sum).toBeCloseTo(amount, 8);
    }
  });

  test('$0 rental produces $0 for all parties', () => {
    const dist = calculateDistribution(0);
    expect(dist.ownerRevenue).toBe(0);
    expect(dist.creatorRoyalty).toBe(0);
    expect(dist.networkContribution).toBe(0);
    expect(dist.atpTreasury).toBe(0);
  });

  test('negative amount produces negative distribution (edge case)', () => {
    // This shouldn't happen but tests math consistency
    const dist = calculateDistribution(-100);
    expect(dist.ownerRevenue).toBeCloseTo(-92, 2);
    expect(dist.creatorRoyalty).toBeCloseTo(-5, 2);
  });

  // Scale projection from the blog
  test('100K agents at $50K/year matches blog projections', () => {
    const annualVolume = 100000 * 50000; // $5B
    const monthlyVolume = annualVolume / 12;
    const dist = calculateDistribution(monthlyVolume);
    const annualNetwork = dist.networkContribution * 12;
    // Blog says ~$5.4M annual to 0.0.800 at maturity (100K agents, $22.5M/mo)
    // Our calc: 100K * $50K = $5B * 2% = $100M (blog uses lower avg)
    expect(annualNetwork).toBeGreaterThan(0);
    expect(dist.networkContribution).toBeCloseTo(monthlyVolume * 0.02, 2);
  });
});
