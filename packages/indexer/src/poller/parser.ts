import {
  hcsMessageSchema,
  agentInitializationSchema,
  agentCreatedSchema,
  openclawActionSchema,
  agentTransactionSchema,
  rentalInitiatedSchema,
  rentalCompletedSchema,
  agentCommsSchema,
  type HCSMessage,
  type MirrorNodeMessage,
} from '../types/hcs.js';

export interface ParsedMessage {
  raw: MirrorNodeMessage;
  decoded: unknown;
  validated: HCSMessage | null;
  messageType: string | null;
  error?: string;
}

export function decodeBase64Message(base64: string): unknown {
  try {
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export function classifyMessageType(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const obj = data as Record<string, unknown>;

  if ('type' in obj) {
    return obj.type as string;
  }

  if ('from' in obj && 'text' in obj && 'timestamp' in obj) {
    return 'agent_comms';
  }

  return 'unknown';
}

export function validateMessage(data: unknown): HCSMessage | null {
  try {
    return hcsMessageSchema.parse(data);
  } catch {
    const schemas = [
      agentInitializationSchema,
      agentCreatedSchema,
      openclawActionSchema,
      agentTransactionSchema,
      rentalInitiatedSchema,
      rentalCompletedSchema,
      agentCommsSchema,
    ];

    for (const schema of schemas) {
      try {
        return schema.parse(data) as HCSMessage;
      } catch {
        continue;
      }
    }

    return null;
  }
}

export function parseMessage(message: MirrorNodeMessage): ParsedMessage {
  const decoded = decodeBase64Message(message.message);

  if (!decoded) {
    return {
      raw: message,
      decoded: null,
      validated: null,
      messageType: null,
      error: 'Failed to decode base64 message',
    };
  }

  const messageType = classifyMessageType(decoded);
  const validated = validateMessage(decoded);

  return {
    raw: message,
    decoded,
    validated,
    messageType,
    error: validated ? undefined : 'Message failed validation',
  };
}
