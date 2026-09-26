import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, Client } from 'discord.js';
import * as v from 'valibot';
import { defineTool } from './define-tool.ts';
import { executeTool } from './index.ts';
import type { ToolContext } from './context.ts';
import { ActionSchema } from '../conversation/action.ts';

describe('defineTool', () => {
  let client: Client;
  let context: ToolContext;

  beforeEach(async () => {
    client = new Client({ intents: [] });
    vi.spyOn(client.rest, 'get')
      .mockResolvedValueOnce({ id: '1', name: 'サーバー' })
      .mockResolvedValueOnce({ id: '2', guild_id: '1', type: ChannelType.GuildText, name: '雑談' })
      .mockResolvedValueOnce({ id: '7', username: 'Bot', bot: true });
    await client.guilds.fetch('1');
    const channel = await client.channels.fetch('2');
    assert(channel?.type === ChannelType.GuildText);
    context = {
      channel,
      self: await client.users.fetch('7'),
      targetMessageId: '3',
      visibleMessageIds: new Set(),
      memory: { read: vi.fn(), update: vi.fn() },
    };
  });

  afterEach(async () => {
    await client.destroy();
    vi.restoreAllMocks();
  });

  it('行動の解析では引数を変更せず、実行入口で一度だけ変換して実装へ渡す', async () => {
    const transform = vi.fn((text: string) => Number(text));
    const execute = vi.fn(async (input: { value: number }) => input.value + 1);
    const tool = defineTool({
      name: 'setPersonality',
      description: '変換の検証用ツール',
      inputSchema: v.strictObject({ value: v.pipe(v.string(), v.transform(transform)) }),
      execute,
    });
    const action = v.parse(ActionSchema, {
      type: 'tool_call', tool: { name: tool.name, arguments: { value: '42' } },
    });
    assert(action.type === 'tool_call');
    expect(action.tool.arguments).toEqual({ value: '42' });
    expect(transform).not.toHaveBeenCalled();
    const signal = new AbortController().signal;

    expect(await tool.execute(action.tool.arguments, context, signal)).toBe(43);

    expect(transform).toHaveBeenCalledExactlyOnceWith('42');
    expect(execute).toHaveBeenCalledExactlyOnceWith({ value: 42 }, context, signal);
  });

  it('登録済みツールへ不正な引数が渡ると、実行入口で止めてDBを更新しない', async () => {
    const action = v.parse(ActionSchema, {
      type: 'tool_call',
      tool: { name: 'setPersonality', arguments: { readVersion: null, text: 42 } },
    });
    assert(action.type === 'tool_call');

    await expect(executeTool(action.tool, context, new AbortController().signal)).rejects.toBeInstanceOf(v.ValiError);

    expect(context.memory.update).not.toHaveBeenCalled();
  });
});
