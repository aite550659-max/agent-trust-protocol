/**
 * HCS Message Validation Tests
 *
 * These are critical — invalid messages corrupt the audit trail,
 * which is ATP's core trust guarantee.
 */

import { ATP_VERSION } from '../config';

// We test validateMessage directly without needing a Hedera client.
// Extract the validation logic to test in isolation.
// For now, we reconstruct the validator inline since HCSLogger requires Client.

const validMessageTypes = [
  'agent_created', 'agent_ownership_transfer', 'agent_pricing_update',
  'rental_initiated', 'rental_instruction', 'rental_heartbeat',
  'rental_downtime', 'rental_completed', 'rental_terminated', 'rental_violation',
  'subrental_initiated',
  'dispute_filed', 'dispute_assigned', 'dispute_resolved',
  'reputation_snapshot',
  'trust_tier_staked', 'trust_tier_unstaked',
  'runtime_attestation',
];

interface HCSMessage {
  atpVersion: string;
  messageType: string;
  agentId: string;
  timestamp: string;
  payload: Record<string, any>;
}

function validateMessage(message: Partial<HCSMessage>): string | null {
  if (!message.atpVersion) return 'Missing atpVersion';
  if (!message.messageType) return 'Missing messageType';
  if (!message.agentId) return 'Missing agentId';
  if (!message.timestamp) return 'Missing timestamp';
  if (!message.payload || typeof message.payload !== 'object') return 'Missing or invalid payload';
  if (!/^\d+\.\d+$/.test(message.atpVersion)) return 'Invalid atpVersion format (expected MAJOR.MINOR)';
  if (!/^0\.0\.\d+$/.test(message.agentId)) return 'Invalid agentId format (expected 0.0.XXXXX)';
  if (isNaN(Date.parse(message.timestamp))) return 'Invalid timestamp format (expected ISO 8601)';
  if (!validMessageTypes.includes(message.messageType)) return `Unknown message type: ${message.messageType}`;
  return null;
}

function validMessage(overrides: Partial<HCSMessage> = {}): HCSMessage {
  return {
    atpVersion: ATP_VERSION,
    messageType: 'agent_created',
    agentId: '0.0.12345',
    timestamp: '2026-02-08T12:00:00Z',
    payload: { name: 'TestAgent' },
    ...overrides,
  };
}

describe('HCS Message Validation', () => {
  test('accepts a valid message', () => {
    expect(validateMessage(validMessage())).toBeNull();
  });

  // --- Required fields ---

  test('rejects missing atpVersion', () => {
    expect(validateMessage(validMessage({ atpVersion: '' }))).toBe('Missing atpVersion');
  });

  test('rejects missing messageType', () => {
    expect(validateMessage(validMessage({ messageType: '' }))).toBe('Missing messageType');
  });

  test('rejects missing agentId', () => {
    expect(validateMessage(validMessage({ agentId: '' }))).toBe('Missing agentId');
  });

  test('rejects missing timestamp', () => {
    expect(validateMessage(validMessage({ timestamp: '' }))).toBe('Missing timestamp');
  });

  test('rejects missing payload', () => {
    expect(validateMessage({ ...validMessage(), payload: undefined as any })).toBe('Missing or invalid payload');
  });

  test('rejects non-object payload', () => {
    expect(validateMessage({ ...validMessage(), payload: 'string' as any })).toBe('Missing or invalid payload');
  });

  // --- Format validation ---

  test('rejects invalid atpVersion format (three segments)', () => {
    expect(validateMessage(validMessage({ atpVersion: '1.0.0' }))).toBe('Invalid atpVersion format (expected MAJOR.MINOR)');
  });

  test('rejects invalid atpVersion format (text)', () => {
    expect(validateMessage(validMessage({ atpVersion: 'v1' }))).toBe('Invalid atpVersion format (expected MAJOR.MINOR)');
  });

  test('accepts valid atpVersion formats', () => {
    expect(validateMessage(validMessage({ atpVersion: '1.0' }))).toBeNull();
    expect(validateMessage(validMessage({ atpVersion: '2.1' }))).toBeNull();
    expect(validateMessage(validMessage({ atpVersion: '10.99' }))).toBeNull();
  });

  // --- Agent ID format ---

  test('rejects invalid agentId (no prefix)', () => {
    expect(validateMessage(validMessage({ agentId: '12345' }))).toBe('Invalid agentId format (expected 0.0.XXXXX)');
  });

  test('rejects invalid agentId (wrong prefix)', () => {
    expect(validateMessage(validMessage({ agentId: '0.1.12345' }))).toBe('Invalid agentId format (expected 0.0.XXXXX)');
  });

  test('rejects invalid agentId (letters)', () => {
    expect(validateMessage(validMessage({ agentId: '0.0.abc' }))).toBe('Invalid agentId format (expected 0.0.XXXXX)');
  });

  test('accepts valid agentId formats', () => {
    expect(validateMessage(validMessage({ agentId: '0.0.1' }))).toBeNull();
    expect(validateMessage(validMessage({ agentId: '0.0.10255397' }))).toBeNull();
  });

  // --- Timestamp ---

  test('rejects invalid timestamp', () => {
    expect(validateMessage(validMessage({ timestamp: 'not-a-date' }))).toBe('Invalid timestamp format (expected ISO 8601)');
  });

  test('accepts various valid ISO timestamps', () => {
    expect(validateMessage(validMessage({ timestamp: '2026-02-08T12:00:00Z' }))).toBeNull();
    expect(validateMessage(validMessage({ timestamp: '2026-02-08T12:00:00.000Z' }))).toBeNull();
    expect(validateMessage(validMessage({ timestamp: '2026-02-08' }))).toBeNull();
  });

  // --- Message types ---

  test('rejects unknown message type', () => {
    const result = validateMessage(validMessage({ messageType: 'agent_destroyed' }));
    expect(result).toBe('Unknown message type: agent_destroyed');
  });

  test('accepts all valid message types', () => {
    for (const type of validMessageTypes) {
      expect(validateMessage(validMessage({ messageType: type }))).toBeNull();
    }
  });

  // --- Edge cases ---

  test('accepts empty payload object', () => {
    expect(validateMessage(validMessage({ payload: {} }))).toBeNull();
  });

  test('rejects null payload', () => {
    expect(validateMessage({ ...validMessage(), payload: null as any })).toBe('Missing or invalid payload');
  });
});
