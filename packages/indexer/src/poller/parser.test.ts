import { describe, it, expect } from 'vitest';
import { decodeBase64Message, classifyMessageType, validateMessage, parseMessage } from './parser.js';
import type { MirrorNodeMessage } from '../types/hcs.js';

describe('Parser', () => {
  describe('decodeBase64Message', () => {
    it('should decode valid base64 JSON message', () => {
      const message = { type: 'test', value: 123 };
      const base64 = Buffer.from(JSON.stringify(message)).toString('base64');
      const result = decodeBase64Message(base64);
      expect(result).toEqual(message);
    });

    it('should return null for invalid base64', () => {
      const result = decodeBase64Message('not-valid-base64!!!');
      expect(result).toBeNull();
    });

    it('should return null for non-JSON content', () => {
      const base64 = Buffer.from('not json').toString('base64');
      const result = decodeBase64Message(base64);
      expect(result).toBeNull();
    });
  });

  describe('classifyMessageType', () => {
    it('should classify AGENT_INITIALIZATION', () => {
      const data = { type: 'AGENT_INITIALIZATION', agentId: 'test' };
      expect(classifyMessageType(data)).toBe('AGENT_INITIALIZATION');
    });

    it('should classify OPENCLAW_ACTION', () => {
      const data = { type: 'OPENCLAW_ACTION', agentId: 'test' };
      expect(classifyMessageType(data)).toBe('OPENCLAW_ACTION');
    });

    it('should classify agent_comms from structure', () => {
      const data = { from: 'agent1', text: 'hello', timestamp: '2026-01-01' };
      expect(classifyMessageType(data)).toBe('agent_comms');
    });

    it('should return unknown for unrecognized messages', () => {
      const data = { something: 'else' };
      expect(classifyMessageType(data)).toBe('unknown');
    });

    it('should return null for invalid input', () => {
      expect(classifyMessageType(null)).toBeNull();
      expect(classifyMessageType('string')).toBeNull();
      expect(classifyMessageType(123)).toBeNull();
    });
  });

  describe('validateMessage', () => {
    it('should validate AGENT_INITIALIZATION message', () => {
      const data = {
        version: '1.0',
        type: 'AGENT_INITIALIZATION',
        agentId: 'test-agent',
        agentName: 'Test Agent',
        platform: 'OpenClaw',
        timestamp: 1234567890,
      };
      const result = validateMessage(data);
      expect(result).toBeTruthy();
      expect(result?.type).toBe('AGENT_INITIALIZATION');
    });

    it('should validate OPENCLAW_ACTION message', () => {
      const data = {
        version: '1.0',
        type: 'OPENCLAW_ACTION',
        agentId: 'test-agent',
        sessionKey: 'main',
        action: { tool: 'test', parameters: {}, result: 'success' },
        timestamp: 1234567890,
      };
      const result = validateMessage(data);
      expect(result).toBeTruthy();
      expect(result?.type).toBe('OPENCLAW_ACTION');
    });

    it('should validate agent_comms message', () => {
      const data = {
        from: 'agent1',
        timestamp: '2026-01-01T00:00:00.000Z',
        text: 'Hello world',
      };
      const result = validateMessage(data);
      expect(result).toBeTruthy();
    });

    it('should return null for invalid message', () => {
      const data = { invalid: 'message' };
      const result = validateMessage(data);
      expect(result).toBeNull();
    });
  });

  describe('parseMessage', () => {
    it('should parse valid message successfully', () => {
      const messageData = {
        version: '1.0',
        type: 'AGENT_INITIALIZATION',
        agentId: 'test-agent',
        agentName: 'Test Agent',
        platform: 'OpenClaw',
        timestamp: 1234567890,
      };
      const base64 = Buffer.from(JSON.stringify(messageData)).toString('base64');
      const mirrorMessage: MirrorNodeMessage = {
        consensus_timestamp: '1234567890.000000000',
        topic_id: '0.0.123',
        message: base64,
        payer_account_id: '0.0.456',
        sequence_number: 1,
        running_hash: 'hash',
        running_hash_version: 3,
      };

      const result = parseMessage(mirrorMessage);
      expect(result.decoded).toEqual(messageData);
      expect(result.messageType).toBe('AGENT_INITIALIZATION');
      expect(result.validated).toBeTruthy();
      expect(result.error).toBeUndefined();
    });

    it('should handle invalid base64', () => {
      const mirrorMessage: MirrorNodeMessage = {
        consensus_timestamp: '1234567890.000000000',
        topic_id: '0.0.123',
        message: 'invalid!!!',
        payer_account_id: '0.0.456',
        sequence_number: 1,
        running_hash: 'hash',
        running_hash_version: 3,
      };

      const result = parseMessage(mirrorMessage);
      expect(result.decoded).toBeNull();
      expect(result.validated).toBeNull();
      expect(result.error).toBe('Failed to decode base64 message');
    });
  });
});
