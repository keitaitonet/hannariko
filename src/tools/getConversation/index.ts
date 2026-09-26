import * as v from 'valibot';
import { logger } from '../../logging/logger.ts';
import { formatConversation } from '../../discord/format-conversation.ts';
import { defineTool } from '../define-tool.ts';
import { DiscordIdSchema } from '../../discord/id.ts';

const LimitSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100));

export const getConversation = defineTool({
  name: 'getConversation',
  description: '現在のチャンネルで、指定したメッセージの前後の会話を取得する。',
  inputSchema: v.union([
    v.strictObject({ before: DiscordIdSchema, limit: LimitSchema }),
    v.strictObject({ around: DiscordIdSchema, limit: LimitSchema }),
    v.strictObject({ after: DiscordIdSchema, limit: LimitSchema }),
  ]),
  async execute(input, context, signal) {
    const { channel, self, targetMessageId, memory, visibleMessageIds } = context;
    const messages = await channel.messages.fetch({ ...input, cache: false });
    logger.log({ type: 'discord_history', channelId: channel.id, messages: messages.map(message => message.toJSON()) });
    signal.throwIfAborted();

    // Discord API は新しい順に返すため、会話として読む順番へ並べ替える。
    const conversation = formatConversation(self, channel, targetMessageId, [...messages.values()].reverse());
    const userIds = [...new Set(conversation.messages
      .filter(item => !item.author.bot && !item.webhook)
      .map(item => item.author.id))];
    const userMemories = await Promise.all(userIds.map(async userId => ({
      userId,
      ...await memory.read({ type: 'user', guildId: channel.guild.id, userId }, signal),
    })));
    signal.throwIfAborted();
    for (const item of conversation.messages) visibleMessageIds.add(item.id);
    return { ...conversation, userMemories };
  },
});
