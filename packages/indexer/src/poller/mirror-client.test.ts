import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MirrorNodeClient } from './mirror-client.js';

describe('MirrorNodeClient', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('fetchMessages', () => {
    it('should fetch messages with default parameters', async () => {
      const mockResponse = {
        messages: [
          {
            consensus_timestamp: '1234567890.000000000',
            topic_id: '0.0.123',
            message: 'base64message',
            payer_account_id: '0.0.456',
            sequence_number: 1,
            running_hash: 'hash',
            running_hash_version: 3,
          },
        ],
        links: {},
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const client = new MirrorNodeClient('https://test.hedera.com');
      const result = await client.fetchMessages('0.0.123');

      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('0.0.123/messages'),
        expect.any(Object)
      );
    });

    it('should include cursor in request when provided', async () => {
      const mockResponse = { messages: [], links: {} };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const client = new MirrorNodeClient('https://test.hedera.com');
      await client.fetchMessages('0.0.123', '1234567890.000000000');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('timestamp=gt%3A1234567890.000000000'),
        expect.any(Object)
      );
    });

    it('should throw error on failed request', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const client = new MirrorNodeClient('https://test.hedera.com');
      await expect(client.fetchMessages('0.0.123')).rejects.toThrow('Mirror node request failed: 404 Not Found');
    });
  });

  describe('fetchNextPage', () => {
    it('should fetch next page from URL', async () => {
      const mockResponse = { messages: [], links: {} };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const client = new MirrorNodeClient('https://test.hedera.com');
      const result = await client.fetchNextPage('https://test.hedera.com/next');

      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith('https://test.hedera.com/next', expect.any(Object));
    });
  });
});
