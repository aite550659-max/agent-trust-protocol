import { Client, TopicMessageQuery, TopicId, Timestamp } from '@hashgraph/sdk';
import { db } from '../db/client.js';
import { syncCursors, hcsMessages, agents, agentEvents, rentals, agentComms } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { classifyMessageType, validateMessage } from '../poller/parser.js';
import { config } from '../config.js';
import type { HCSMessage, AgentInitialization, AgentCreated, OpenclawAction, AgentTransaction, RentalInitiated, RentalCompleted, AgentComms } from '../types/hcs.js';

export interface SubscriberOptions {
  topicId: string;
  startTimestamp?: string; // "seconds.nanos" format
  onError?: (error: Error) => void;
  onDisconnect?: () => void;
  logger?: Console;
  client?: Client;
}

export class TopicSubscriber {
  private topicId: string;
  private startTimestamp?: string;
  private onErrorCb?: (error: Error) => void;
  private onDisconnectCb?: () => void;
  private logger: Console;
  private client: Client;
  private subscriptionHandle: { unsubscribe: () => void } | null = null;
  private _isRunning = false;

  constructor(options: SubscriberOptions) {
    this.topicId = options.topicId;
    this.startTimestamp = options.startTimestamp;
    this.onErrorCb = options.onError;
    this.onDisconnectCb = options.onDisconnect;
    this.logger = options.logger || console;

    if (options.client) {
      this.client = options.client;
    } else {
      this.client = config.hederaNetwork === 'testnet'
        ? Client.forTestnet()
        : Client.forMainnet();
    }
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  async start(): Promise<void> {
    if (this._isRunning) return;
    this._isRunning = true;

    const query = new TopicMessageQuery()
      .setTopicId(TopicId.fromString(this.topicId));

    if (this.startTimestamp) {
      const [seconds, nanos] = this.startTimestamp.split('.');
      // Add 1 nano to avoid re-processing the last message
      const nanosNum = parseInt(nanos || '0', 10) + 1;
      query.setStartTime(Timestamp.fromDate(new Date(0)).plusNanos(
        Number(BigInt(seconds) * BigInt(1_000_000_000) + BigInt(nanosNum))
      ));
    }

    this.logger.info(`[Subscriber] Starting gRPC subscription for topic ${this.topicId}`);

    try {
      this.subscriptionHandle = query.subscribe(
        this.client,
        // errorHandler is the SECOND param in @hashgraph/sdk
        (error: unknown) => {
          this.logger.error(`[Subscriber] Subscription error for ${this.topicId}:`, error);
          this._isRunning = false;
          this.onErrorCb?.(error instanceof Error ? error : new Error(String(error)));
          this.onDisconnectCb?.();
        },
        // listener (message handler) is the THIRD param
        (message) => {
          this.handleMessage(message).catch((err) => {
            this.logger.error(`[Subscriber] Error processing message:`, err);
            this.onErrorCb?.(err as Error);
          });
        },
      );
    } catch (error) {
      this._isRunning = false;
      throw error;
    }
  }

  stop(): void {
    this._isRunning = false;
    if (this.subscriptionHandle) {
      this.subscriptionHandle.unsubscribe();
      this.subscriptionHandle = null;
    }
    this.logger.info(`[Subscriber] Stopped subscription for topic ${this.topicId}`);
  }

  private async handleMessage(message: any): Promise<void> {
    // Convert SDK message format to our internal format
    const contents = new TextDecoder().decode(message.contents);
    const consensusTimestamp = `${message.consensusTimestamp.seconds.toString()}.${message.consensusTimestamp.nanos.toString().padStart(9, '0')}`;
    const sequenceNumber = typeof message.sequenceNumber === 'number'
      ? message.sequenceNumber
      : message.sequenceNumber.toNumber();
    const topicId = message.topicId?.toString() || this.topicId;

    let decoded: unknown;
    try {
      decoded = JSON.parse(contents);
    } catch {
      decoded = null;
    }

    const messageType = decoded ? classifyMessageType(decoded) : null;
    const validated = decoded ? validateMessage(decoded) : null;

    // Store raw message (base64 encode for compatibility with existing schema)
    const base64Message = Buffer.from(contents).toString('base64');
    await db.insert(hcsMessages).values({
      topicId,
      consensusTimestamp,
      sequenceNumber,
      payerAccountId: null,
      messageBase64: base64Message,
      decodedJson: decoded,
      messageType,
    }).onConflictDoNothing();

    if (validated) {
      await this.processTypedEvent(validated, consensusTimestamp, topicId);
    }

    await this.updateCursor(topicId, consensusTimestamp, sequenceNumber);
  }

  private async processTypedEvent(event: HCSMessage, consensusTimestamp: string, topicId: string): Promise<void> {
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
      const e = event as AgentComms;
      await db.insert(agentComms).values({
        topicId, fromAgent: e.from, toAgent: e.to, text: e.text,
        timestamp: e.timestamp, consensusTimestamp, metadata: e.metadata,
      });
    }
  }

  private async updateCursor(topicId: string, timestamp: string, sequenceNumber: number): Promise<void> {
    await db.insert(syncCursors).values({
      topicId, lastTimestamp: timestamp, lastSequenceNumber: sequenceNumber, updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: syncCursors.topicId,
      set: { lastTimestamp: timestamp, lastSequenceNumber: sequenceNumber, updatedAt: new Date() },
    });
  }
}
