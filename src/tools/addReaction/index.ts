import * as v from 'valibot';
import { defineTool } from '../define-tool.ts';
import { DiscordIdSchema } from '../../discord/id.ts';

export const addReaction = defineTool({
  name: 'addReaction',
  description: '現在のチャンネルのメッセージにリアクションを付ける。',
  inputSchema: v.strictObject({
    messageId: DiscordIdSchema,
    emoji: v.pipe(v.string(), v.minLength(1)),
  }),
  async execute(input, context, signal) {
    if (!context.visibleMessageIds.has(input.messageId)) {
      throw new Error('リアクション先は、この会話で取得したメッセージに限ります');
    }
    await context.channel.messages.react(input.messageId, input.emoji);
    signal.throwIfAborted();
    return null;
  },
});
