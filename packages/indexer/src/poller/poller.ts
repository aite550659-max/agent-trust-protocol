import { db } from '../db/client.js';
import { syncCursors, hcsMessages, agents, agentEvents, rentals, agentComms } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { MirrorNodeClient } from './mirror-client.js';
import { parseMessage } from './parser.js';
import type { HCSMessage, AgentInitialization, AgentCreated, OpenclawAction, AgentTransaction, RentalInitiated, RentalCompleted, AgentComms } from '../types/hcs.js';
import { config } from '../config.js';

export class TopicPoller {
  private client: MirrorNodeClient;
  private topicId: string;
  private pollIntervalMs: number;
  private currentInterval: number;
  private isRunning = false;
  private timeoutId?: NodeJS.Timeout;
  private logger: Console;

  constructor(topicId: string, client?: MirrorNodeClient, logger?: Console) {
    this.topicId = topicId;
    this.client = client || new MirrorNodeClient();
    this.pollIntervalMs = config.pollIntervalMs;
    this.currentInterval = this.pollIntervalMs;
    this.logger = logger || console;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(`Poller for topic ${this.topicId} is already running`);
      return;
    }

    this.isRunning = true;
    this.logger.info(`Starting poller for topic ${this.topicId}`);
    await this.poll();
  }

  stop(): void {
    this.isRunning = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    this.logger.info(`Stopped poller for topic ${this.topicId}`);
  }

  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const cursor = await this.getCursor();
      const response = await this.client.fetchMessages(this.topicId, cursor);

      if (response.messages.length > 0) {
        await this.processMessages(response.messages);
        this.currentInterval = this.pollIntervalMs;

        if (response.links.next) {
          await this.processNextPages(response.links.next);
        }
      } else {
        this.increaseBackoff();
      }
    } catch (error) {
      this.logger.error(`Error polling topic ${this.topicId}:`, error);
      this.increaseBackoff();
    }

    if (this.isRunning) {
      this.timeoutId = setTimeout(() => this.poll(), this.currentInterval);
    }
  }

  private async processNextPages(nextUrl: string): Promise<void> {
    let currentUrl: string | undefined = nextUrl;

    while (currentUrl && this.isRunning) {
      try {
        const response = await this.client.fetchNextPage(currentUrl);
        if (response.messages.length > 0) {
          await this.processMessages(response.messages);
        }
        currentUrl = response.links.next;
      } catch (error) {
        this.logger.error(`Error fetching next page:`, error);
        break;
      }
    }
  }

  private async processMessages(messages: any[]): Promise<void> {
    for (const message of messages) {
      try {
        const parsed = parseMessage(message);
        await this.storeMessage(parsed);

        if (parsed.validated) {
          await this.processTypedEvent(parsed.validated, message.consensus_timestamp);
        }

        await this.updateCursor(message.consensus_timestamp, message.sequence_number);
      } catch (error) {
        this.logger.error(`Error processing message:`, error);
      }
    }
  }

  private async storeMessage(parsed: any): Promise<void> {
    await db.insert(hcsMessages).values({
      topicId: this.topicId,
      consensusTimestamp: parsed.raw.consensus_timestamp,
      sequenceNumber: parsed.raw.sequence_number,
      payerAccountId: parsed.raw.payer_account_id,
      messageBase64: parsed.raw.message,
      decodedJson: parsed.decoded,
      messageType: parsed.messageType,
    }).onConflictDoNothing();
  }

  private async processTypedEvent(event: HCSMessage, consensusTimestamp: string): Promise<void> {
    const eventType = 'type' in event ? event.type : 'agent_comms';

    if (eventType === 'AGENT_INITIALIZATION' || eventType === 'agent_created') {
      await this.processAgentInitialization(event as AgentInitialization | AgentCreated);
    } else if (eventType === 'OPENCLAW_ACTION') {
      await this.processOpenclawAction(event as OpenclawAction, consensusTimestamp);
    } else if (eventType === 'AGENT_TRANSACTION') {
      await this.processAgentTransaction(event as AgentTransaction, consensusTimestamp);
    } else if (eventType === 'rental_initiated') {
      await this.processRentalInitiated(event as RentalInitiated);
    } else if (eventType === 'rental_completed') {
      await this.processRentalCompleted(event as RentalCompleted);
    } else if (eventType === 'agent_comms') {
      await this.processAgentComms(event as AgentComms, consensusTimestamp);
    }
  }

  private async processAgentInitialization(event: AgentInitialization | AgentCreated): Promise<void> {
    const now = new Date();
    await db.insert(agents).values({
      agentId: event.agentId,
      agentName: event.agentName,
      platform: event.platform,
      version: event.metadata?.version,
      operatingAccount: event.metadata?.operatingAccount,
      firstSeenAt: now,
      lastSeenAt: now,
      metadata: event.metadata,
    }).onConflictDoUpdate({
      target: agents.agentId,
      set: {
        lastSeenAt: now,
        agentName: event.agentName,
        platform: event.platform,
        version: event.metadata?.version,
        operatingAccount: event.metadata?.operatingAccount,
        metadata: event.metadata,
      },
    });
  }

  private async processOpenclawAction(event: OpenclawAction, consensusTimestamp: string): Promise<void> {
    await db.insert(agentEvents).values({
      agentId: event.agentId,
      eventType: 'OPENCLAW_ACTION',
      sessionKey: event.sessionKey,
      action: event.action,
      reasoning: event.reasoning,
      previousHash: event.previousHash,
      timestamp: event.timestamp,
      consensusTimestamp,
      rawData: event,
    });

    await db.update(agents)
      .set({ lastSeenAt: new Date() })
      .where(eq(agents.agentId, event.agentId));
  }

  private async processAgentTransaction(event: AgentTransaction, consensusTimestamp: string): Promise<void> {
    await db.insert(agentEvents).values({
      agentId: event.agentId,
      eventType: 'AGENT_TRANSACTION',
      transactionId: event.transactionId,
      transactionType: event.transactionType,
      details: event.details,
      reasoning: event.reasoning || undefined,
      previousHash: event.previousHash,
      timestamp: event.timestamp,
      consensusTimestamp,
      rawData: event,
    });

    await db.update(agents)
      .set({ lastSeenAt: new Date() })
      .where(eq(agents.agentId, event.agentId));
  }

  private async processRentalInitiated(event: RentalInitiated): Promise<void> {
    await db.insert(rentals).values({
      rentalId: event.rentalId,
      agentId: event.agentId,
      renter: event.renter,
      escrowAccount: event.escrowAccount,
      stakeUsd: event.stakeUsd.toString(),
      bufferUsd: event.bufferUsd.toString(),
      status: 'initiated',
      initiatedAt: event.timestamp,
    }).onConflictDoNothing();
  }

  private async processRentalCompleted(event: RentalCompleted): Promise<void> {
    await db.update(rentals)
      .set({
        totalCostUsd: event.totalCostUsd.toString(),
        settlement: event.settlement,
        status: 'completed',
        completedAt: event.timestamp,
        updatedAt: new Date(),
      })
      .where(eq(rentals.rentalId, event.rentalId));
  }

  private async processAgentComms(event: AgentComms, consensusTimestamp: string): Promise<void> {
    await db.insert(agentComms).values({
      topicId: this.topicId,
      fromAgent: event.from,
      toAgent: event.to,
      text: event.text,
      timestamp: event.timestamp,
      consensusTimestamp,
      metadata: event.metadata,
    });
  }

  private async getCursor(): Promise<string | undefined> {
    const result = await db.select()
      .from(syncCursors)
      .where(eq(syncCursors.topicId, this.topicId))
      .limit(1);

    return result[0]?.lastTimestamp;
  }

  private async updateCursor(timestamp: string, sequenceNumber: number): Promise<void> {
    await db.insert(syncCursors).values({
      topicId: this.topicId,
      lastTimestamp: timestamp,
      lastSequenceNumber: sequenceNumber,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: syncCursors.topicId,
      set: {
        lastTimestamp: timestamp,
        lastSequenceNumber: sequenceNumber,
        updatedAt: new Date(),
      },
    });
  }

  private increaseBackoff(): void {
    if (this.currentInterval === this.pollIntervalMs) {
      this.currentInterval = 15000;
    } else if (this.currentInterval === 15000) {
      this.currentInterval = 30000;
    }
  }
}

export class PollerService {
  private pollers: Map<string, TopicPoller> = new Map();
  private logger: Console;

  constructor(logger?: Console) {
    this.logger = logger || console;
  }

  start(topics: string[]): void {
    for (const topicId of topics) {
      if (!this.pollers.has(topicId)) {
        const poller = new TopicPoller(topicId, undefined, this.logger);
        this.pollers.set(topicId, poller);
        poller.start().catch((err) => {
          this.logger.error(`Failed to start poller for ${topicId}:`, err);
        });
      }
    }
  }

  stop(): void {
    for (const poller of this.pollers.values()) {
      poller.stop();
    }
    this.pollers.clear();
  }

  getStatus(): Record<string, { running: boolean }> {
    const status: Record<string, { running: boolean }> = {};
    for (const [topicId, poller] of this.pollers.entries()) {
      status[topicId] = { running: (poller as any).isRunning };
    }
    return status;
  }
}
