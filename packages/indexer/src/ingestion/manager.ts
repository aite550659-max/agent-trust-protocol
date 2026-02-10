import { db } from '../db/client.js';
import { syncCursors } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { TopicSubscriber } from './subscriber.js';
import { BackfillService } from './backfill.js';
// config imported by sub-components

export type TopicStatus = 'idle' | 'backfilling' | 'streaming' | 'reconnecting' | 'error';

interface Logger {
  info(msg: string, ...args: unknown[]): void;
  info(obj: object, msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  error(obj: object, msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  warn(obj: object, msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  debug(obj: object, msg: string, ...args: unknown[]): void;
}

interface TopicState {
  status: TopicStatus;
  subscriber: TopicSubscriber | null;
  backfill: BackfillService | null;
  reconnectAttempts: number;
  reconnectTimeout?: NodeJS.Timeout;
  lastError?: string;
}

export class IngestionManager {
  private topics: Map<string, TopicState> = new Map();
  private logger: Logger;
  private _isRunning = false;

  constructor(logger?: Logger) {
    this.logger = logger || console;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  async start(topics: string[]): Promise<void> {
    this._isRunning = true;
    this.logger.info({ topics }, `Starting ingestion for ${topics.length} topics`);

    for (const topicId of topics) {
      await this.startTopic(topicId);
    }
  }

  async stop(): Promise<void> {
    this._isRunning = false;
    for (const [topicId, state] of this.topics.entries()) {
      if (state.reconnectTimeout) clearTimeout(state.reconnectTimeout);
      state.subscriber?.stop();
      state.backfill?.stop();
      state.status = 'idle';
      this.logger.info({ topicId }, 'Stopped topic ingestion');
    }
    this.topics.clear();
  }

  async addTopic(topicId: string): Promise<void> {
    if (this.topics.has(topicId)) {
      this.logger.info({ topicId }, 'Topic already being tracked');
      return;
    }
    if (this._isRunning) {
      await this.startTopic(topicId);
    }
  }

  getStatus(): Record<string, { status: TopicStatus; reconnectAttempts: number; lastError?: string }> {
    const result: Record<string, { status: TopicStatus; reconnectAttempts: number; lastError?: string }> = {};
    for (const [topicId, state] of this.topics.entries()) {
      result[topicId] = {
        status: state.status,
        reconnectAttempts: state.reconnectAttempts,
        lastError: state.lastError,
      };
    }
    return result;
  }

  private async startTopic(topicId: string): Promise<void> {
    const state: TopicState = {
      status: 'idle',
      subscriber: null,
      backfill: null,
      reconnectAttempts: 0,
    };
    this.topics.set(topicId, state);

    await this.runBackfillThenStream(topicId);
  }

  private async runBackfillThenStream(topicId: string): Promise<void> {
    const state = this.topics.get(topicId);
    if (!state || !this._isRunning) return;

    state.status = 'backfilling';
    const backfill = new BackfillService({
      topicId,
      logger: this.logger as unknown as Console,
    });
    state.backfill = backfill;

    try {
      const result = await backfill.run();
      this.logger.info({ topicId, messagesProcessed: result.messagesProcessed }, 'Backfill complete');
    } catch (error) {
      this.logger.error({ topicId, error }, 'Backfill failed');
      state.status = 'error';
      state.lastError = (error as Error).message;
      this.scheduleReconnect(topicId);
      return;
    }

    if (!this._isRunning) return;

    await this.startStreaming(topicId);
  }

  private async startStreaming(topicId: string): Promise<void> {
    const state = this.topics.get(topicId);
    if (!state || !this._isRunning) return;

    const cursor = await this.getCursor(topicId);

    state.status = 'streaming';
    state.reconnectAttempts = 0;

    const subscriber = new TopicSubscriber({
      topicId,
      startTimestamp: cursor,
      logger: this.logger as unknown as Console,
      onError: (error) => {
        this.logger.error({ topicId, error: error.message }, 'Subscriber error');
        state.lastError = error.message;
      },
      onDisconnect: () => {
        this.logger.warn({ topicId }, 'Subscriber disconnected');
        if (this._isRunning) {
          state.status = 'reconnecting';
          this.scheduleReconnect(topicId);
        }
      },
    });

    state.subscriber = subscriber;

    try {
      await subscriber.start();
    } catch (error) {
      this.logger.error({ topicId, error }, 'Failed to start subscriber');
      state.status = 'error';
      state.lastError = (error as Error).message;
      this.scheduleReconnect(topicId);
    }
  }

  private scheduleReconnect(topicId: string): void {
    const state = this.topics.get(topicId);
    if (!state || !this._isRunning) return;

    state.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts - 1), 60000);

    this.logger.info({ topicId, delay, attempt: state.reconnectAttempts }, 'Scheduling reconnect');

    state.reconnectTimeout = setTimeout(() => {
      if (this._isRunning) {
        this.runBackfillThenStream(topicId).catch((err) => {
          this.logger.error({ topicId, error: err }, 'Reconnect failed');
        });
      }
    }, delay);
  }

  private async getCursor(topicId: string): Promise<string | undefined> {
    const result = await db.select()
      .from(syncCursors)
      .where(eq(syncCursors.topicId, topicId))
      .limit(1);
    return result[0]?.lastTimestamp;
  }
}
