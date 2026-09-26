import type { MemoryRepository } from '../memory/index.ts';
import type { Message } from 'discord.js';
import { runConversation, type ConversationPorts } from '../conversation/run-conversation.ts';
import { getConversation } from '../tools/getConversation/index.ts';
import { executeTool } from '../tools/index.ts';
import type { ToolContext } from '../tools/context.ts';
import { reply } from './reply.ts';

export function processMessage(
  message: Message<true>,
  dependencies: Pick<ConversationPorts, 'createSession'> & { memory: MemoryRepository },
) {
  const channel = message.channel;
  const visibleMessageIds = new Set<string>();
  const job = { guildId: message.guildId, channelId: channel.id, messageId: message.id };

  const context: ToolContext = {
    channel,
    self: message.client.user,
    targetMessageId: message.id,
    visibleMessageIds,
    memory: dependencies.memory,
  };

  return runConversation(job, {
    prepare: async (signal) => {
      const [conversation, channelMemory, personality] = await Promise.all([
        getConversation.execute({ around: message.id, limit: 10 }, context, signal),
        dependencies.memory.read({ type: 'channel', guildId: job.guildId, channelId: channel.id }, signal),
        dependencies.memory.read({ type: 'personality', guildId: job.guildId }, signal),
      ]);
      signal.throwIfAborted();
      return JSON.stringify({ ...conversation, channelMemory, personality });
    },
    createSession: dependencies.createSession,
    execute: (tool, signal) => executeTool(tool, context, signal),
    reply: (action, signal) => reply(action, channel, visibleMessageIds, signal),
  });
}
