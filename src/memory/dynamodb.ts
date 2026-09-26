import { randomUUID } from 'node:crypto';
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import * as v from 'valibot';
import { MemorySchema, type MemoryRepository, type MemoryTarget } from './index.ts';

export function createMemoryRepository(tableName: string): MemoryRepository {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 1 }));

  return {
    async read(target, signal) {
      signal.throwIfAborted();
      const { Item } = await client.send(new GetCommand({
        TableName: tableName,
        Key: keyOf(target),
        ConsistentRead: true,
      }), { abortSignal: signal });
      signal.throwIfAborted();
      if (!Item) return { version: null, text: '' };
      return v.parse(MemorySchema, { version: Item.version, text: Item.text });
    },
    async update(target, input, signal) {
      signal.throwIfAborted();
      const memory = { version: randomUUID(), text: input.text };
      const creating = input.readVersion === null;
      try {
        await client.send(new PutCommand({
          TableName: tableName,
          Item: { ...keyOf(target), ...memory },
          ConditionExpression: creating ? 'attribute_not_exists(#key)' : '#version = :readVersion',
          ExpressionAttributeNames: creating ? { '#key': 'guildId' } : { '#version': 'version' },
          ExpressionAttributeValues: creating ? undefined : { ':readVersion': input.readVersion },
        }), { abortSignal: signal });
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof ConditionalCheckFailedException) return { status: 'conflict' };
        throw error;
      }
      signal.throwIfAborted();
      return { status: 'saved', memory };
    },
  };
}

function keyOf(target: MemoryTarget) {
  switch (target.type) {
    case 'user':
      return { guildId: target.guildId, memoryKey: `user#${target.userId}` };
    case 'channel':
      return { guildId: target.guildId, memoryKey: `channel#${target.channelId}` };
    case 'personality':
      return { guildId: target.guildId, memoryKey: 'personality' };
  }
}
