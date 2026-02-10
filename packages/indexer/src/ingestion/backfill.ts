import { db } from '../db/client.js';
import { syncCursors } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { MirrorNodeClient } from '../poller/mirror-client.js';
import { parseMessage } from '../poller/parser.js';
import { config } from '../config.js';
import { hcsMessages, agents, agentEvents, rentals, agentComms } from '../db/schema.js';
import type { HCSMessage, AgentInitialization, AgentCreated, OpenclawAction, AgentTransaction, RentalInitiated, RentalCompleted, AgentComms as AgentCommsType } from '../types/hcs.js';

export interface BackfillOptions {
  topicId: string;
  mirrorClient?: MirrorNodeClient;
  logger?: Console;
  pageDelayMs?: number;
}

export interface BackfillResult {
  messagesProcessed: number;
  lastTimestamp?: string;
}

export class BackfillService {
  private client: MirrorNodeClient;
  private topicId: string;
  private logger: Console;
  private pageDelayMs: number;
  private _isRunning = false;
  private _shouldStop = false;

  constructor(options: BackfillOptions) {
    this.topicId = options.topicId;
    this.client = options.mirrorClient || new MirrorNodeClient();
    this.logger = options.logger || console;
    this.pageDelayMs = options.pageDelayMs ?? config.backfillPageDelayMs;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  async run(): Promise<BackfillResult> {
    if (this._isRunning) throw new Error('Backfill already running');
    this._isRunning = true;
    this._shouldStop = false;

    let messagesProcessed = 0;
    let lastTimestamp: string | undefined;

    try {
      const cursor = await this.getCursor();
      this.logger.info(`[Backfill] Starting for topic ${this.topicId}, cursor: ${cursor || 'none'}`);

      let response = await this.client.fetchMessages(this.topicId, cursor);

      while (!this._shouldStop) {
        for (const message of response.messages) {
          if (this._shouldStop) break;

          const parsed = parseMessage(message);

          await db.insert(hcsMessages).values({
            topicId: this.topicId,
            consensusTimestamp: parsed.raw.consensus_timestamp,
            sequenceNumber: parsed.raw.sequence_number,
            payerAccountId: parsed.raw.payer_account_id,
            messageBase64: parsed.raw.message,
            decodedJson: parsed.decoded,
            messageType: parsed.messageType,
          }).onConflictDoNothing();

          if (parsed.validated) {
            await this.processTypedEvent(parsed.validated, message.consensus_timestamp);
          }

          await db.insert(syncCursors).values({
            topicId: this.topicId,
            lastTimestamp: message.consensus_timestamp,
            lastSequenceNumber: message.sequence_number,
            updatedAt: new Date(),
          }).onConflictDoUpdate({
            target: syncCursors.topicId,
            set: {
              lastTimestamp: message.consensus_timestamp,
              lastSequenceNumber: message.sequence_number,
              updatedAt: new Date(),
            },
          });

          messagesProcessed++;
          lastTimestamp = message.consensus_timestamp;
        }

        if (!response.links.next || this._shouldStop) break;

        if (this.pageDelayMs > 0) {
          await new Promise((r) => setTimeout(r, this.pageDelayMs));
        }

        response = await this.client.fetchNextPage(response.links.next);
      }

      this.logger.info(`[Backfill] Completed for topic ${this.topicId}: ${messagesProcessed} messages`);
    } finally {
      this._isRunning = false;
    }

    return { messagesProcessed, lastTimestamp };
  }

  stop(): void {
    this._shouldStop = true;
  }

  private async getCursor(): Promise<string | undefined> {
    const result = await db.select()
      .from(syncCursors)
      .where(eq(syncCursors.topicId, this.topicId))
      .limit(1);
    return result[0]?.lastTimestamp;
  }

  private async processTypedEvent(event: HCSMessage, consensusTimestamp: string): Promise<void> {
    const eventType = 'type' in event ? event.type : 'agent_comms';

    if (eventType === 'AGENT_INITIALIZATION' || eventType === 'agent_created') {
      const e = event as AgentInitialization | AgentCreated;
      const now = new Date();
      await db.insert(agents).values({
        agentId: e.agentId, agentName: e.agentName, platform: e.platform,
        version: e.metadata?.version, operatingAccount: e.metadata?.operatingAccount,
        firstSeenAt: now, lastSeenAt: now, metadata: e.metadata,
      }).onConflictDoUpdate({
        target: agents.agentId,
        set: { lastSeenAt: now, agentName: e.agentName, platform: e.platform,
          version: e.metadata?.version, operatingAccount: e.metadata?.operatingAccount, metadata: e.metadata },
      });
    } else if (eventType === 'OPENCLAW_ACTION') {
      const e = event as OpenclawAction;
      await db.insert(agentEvents).values({
        agentId: e.agentId, eventType: 'OPENCLAW_ACTION', sessionKey: e.sessionKey,
        action: e.action, reasoning: e.reasoning, previousHash: e.previousHash,
        timestamp: e.timestamp, consensusTimestamp, rawData: event,
      });
      await db.update(agents).set({ lastSeenAt: new Date() }).where(eq(agents.agentId, e.agentId));
    } else if (eventType === 'AGENT_TRANSACTION') {
      const e = event as AgentTransaction;
      await db.insert(agentEvents).values({
        agentId: e.agentId, eventType: 'AGENT_TRANSACTION', transactionId: e.transactionId,
        transactionType: e.transactionType, details: e.details, reasoning: e.reasoning || undefined,
        previousHash: e.previousHash, timestamp: e.timestamp, consensusTimestamp, rawData: event,
      });
      await db.update(agents).set({ lastSeenAt: new Date() }).where(eq(agents.agentId, e.agentId));
    } else if (eventType === 'rental_initiated') {
      const e = event as RentalInitiated;
      await db.insert(rentals).values({
        rentalId: e.rentalId, agentId: e.agentId, renter: e.renter,
        escrowAccount: e.escrowAccount, stakeUsd: e.stakeUsd.toString(),
        bufferUsd: e.bufferUsd.toString(), status: 'initiated', initiatedAt: e.timestamp,
      }).onConflictDoNothing();
    } else if (eventType === 'rental_completed') {
      const e = event as RentalCompleted;
      await db.update(rentals).set({
        totalCostUsd: e.totalCostUsd.toString(), settlement: e.settlement,
        status: 'completed', completedAt: e.timestamp, updatedAt: new Date(),
      }).where(eq(rentals.rentalId, e.rentalId));
    } else if (eventType === 'agent_comms') {
      const e = event as AgentCommsType;
      await db.insert(agentComms).values({
        topicId: this.topicId, fromAgent: e.from, toAgent: e.to, text: e.text,
        timestamp: e.timestamp, consensusTimestamp, metadata: e.metadata,
      });
    }
  }
}
