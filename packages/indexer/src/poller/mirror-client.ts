import { config } from '../config.js';
import type { MirrorNodeResponse } from '../types/hcs.js';

export class MirrorNodeClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || config.mirrorNodeUrl;
  }

  async fetchMessages(topicId: string, cursor?: string, limit = 100): Promise<MirrorNodeResponse> {
    const url = new URL(`${this.baseUrl}/api/v1/topics/${topicId}/messages`);
    url.searchParams.set('limit', limit.toString());

    if (cursor) {
      url.searchParams.set('timestamp', `gt:${cursor}`);
    }

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`Mirror node request failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<MirrorNodeResponse>;
  }

  async fetchNextPage(nextUrl: string): Promise<MirrorNodeResponse> {
    const response = await fetch(nextUrl, {
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`Mirror node request failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<MirrorNodeResponse>;
  }
}
