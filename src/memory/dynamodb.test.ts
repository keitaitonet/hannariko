import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createMemoryRepository } from './dynamodb.ts';

const version = 'b88b3ce5-1cc6-44a5-b4c5-374cc424bc81';

describe('createMemoryRepository', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('未保存の場合は、初回更新に使える空の記憶を返す', async () => {
    vi.spyOn(DynamoDBDocumentClient.prototype, 'send').mockImplementation(async () => ({}));
    const repository = createMemoryRepository('memories');
    expect(await repository.read({ type: 'user', guildId: '1', userId: '2' }, new AbortController().signal))
      .toEqual({ version: null, text: '' });
  });

  it('人・チャンネル・人格とguildを区別し、保存済みの記憶だけを返す', async () => {
    const send = vi.spyOn(DynamoDBDocumentClient.prototype, 'send').mockImplementation(async () => ({
      Item: { guildId: '1', memoryKey: 'user#2', version, text: '技術の話が好き' },
    }));
    const repository = createMemoryRepository('memories');
    const signal = new AbortController().signal;
    expect(await repository.read({ type: 'user', guildId: '1', userId: '2' }, signal))
      .toEqual({ version, text: '技術の話が好き' });
    await repository.read({ type: 'channel', guildId: '1', channelId: '2' }, signal);
    await repository.read({ type: 'personality', guildId: '1' }, signal);
    await repository.read({ type: 'user', guildId: '3', userId: '2' }, signal);
    expect(send.mock.calls.map(([command]) => command.input)).toEqual([
      { TableName: 'memories', Key: { guildId: '1', memoryKey: 'user#2' }, ConsistentRead: true },
      { TableName: 'memories', Key: { guildId: '1', memoryKey: 'channel#2' }, ConsistentRead: true },
      { TableName: 'memories', Key: { guildId: '1', memoryKey: 'personality' }, ConsistentRead: true },
      { TableName: 'memories', Key: { guildId: '3', memoryKey: 'user#2' }, ConsistentRead: true },
    ]);
    expect(send.mock.calls[0]![0]).toBeInstanceOf(GetCommand);
  });

  it('初回更新は未作成を条件に保存し、保存したUUIDと本文を返す', async () => {
    const send = vi.spyOn(DynamoDBDocumentClient.prototype, 'send').mockImplementation(async () => ({}));
    const repository = createMemoryRepository('memories');
    const signal = new AbortController().signal;
    const result = await repository.update({ type: 'user', guildId: '1', userId: '2' }, { readVersion: null, text: '新しい記憶' }, signal);
    expect(result).toEqual({ status: 'saved', memory: { version: expect.any(String), text: '新しい記憶' } });
    if (result.status !== 'saved') throw new Error('保存に失敗');
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.any(PutCommand), { abortSignal: signal });
    expect(send.mock.calls[0]![0].input).toEqual({
      TableName: 'memories', Item: { guildId: '1', memoryKey: 'user#2', ...result.memory },
      ConditionExpression: 'attribute_not_exists(#key)', ExpressionAttributeNames: { '#key': 'guildId' },
      ExpressionAttributeValues: undefined,
    });
  });

  it('既存の記憶は読んだUUIDを条件に全文置換し、新しいUUIDを返す', async () => {
    const send = vi.spyOn(DynamoDBDocumentClient.prototype, 'send').mockImplementation(async () => ({}));
    const repository = createMemoryRepository('memories');
    const result = await repository.update({ type: 'channel', guildId: '1', channelId: '2' }, { readVersion: version, text: '修正した記憶' }, new AbortController().signal);
    if (result.status !== 'saved') throw new Error('保存に失敗');
    expect(result.memory.version).not.toBe(version);
    expect(send.mock.calls[0]![0].input).toEqual({
      TableName: 'memories', Item: { guildId: '1', memoryKey: 'channel#2', ...result.memory },
      ConditionExpression: '#version = :readVersion', ExpressionAttributeNames: { '#version': 'version' },
      ExpressionAttributeValues: { ':readVersion': version },
    });
  });

  it('条件が一致しなければ、上書きや再試行をせず競合として返す', async () => {
    const send = vi.spyOn(DynamoDBDocumentClient.prototype, 'send').mockRejectedValue(
      new ConditionalCheckFailedException({ message: '競合', $metadata: {} }),
    );
    const repository = createMemoryRepository('memories');
    expect(await repository.update({ type: 'personality', guildId: '1' }, { readVersion: version, text: '人格' }, new AbortController().signal))
      .toEqual({ status: 'conflict' });
    expect(send).toHaveBeenCalledOnce();
  });

  it('通信障害はバージョン競合に変換せず、呼び出し元へ伝える', async () => {
    const error = new Error('接続できません');
    vi.spyOn(DynamoDBDocumentClient.prototype, 'send').mockRejectedValue(error);
    const repository = createMemoryRepository('memories');
    await expect(repository.update({ type: 'personality', guildId: '1' }, { readVersion: version, text: '人格' }, new AbortController().signal)).rejects.toBe(error);
  });

  it('中断済みなら保存リクエストを送らない', async () => {
    const send = vi.spyOn(DynamoDBDocumentClient.prototype, 'send');
    const repository = createMemoryRepository('memories');
    const controller = new AbortController();
    controller.abort();
    await expect(repository.update({ type: 'personality', guildId: '1' }, { readVersion: null, text: '人格' }, controller.signal)).rejects.toBe(controller.signal.reason);
    expect(send).not.toHaveBeenCalled();
  });
});
