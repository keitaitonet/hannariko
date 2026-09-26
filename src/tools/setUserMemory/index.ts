import * as v from 'valibot';
import { defineTool } from '../define-tool.ts';
import { DiscordIdSchema } from '../../discord/id.ts';
import { MemoryUpdateSchema } from '../../memory/index.ts';

export const setUserMemory = defineTool({
  name: 'setUserMemory',
  description: 'ユーザーの一般的な特徴に関する記憶を全文置き換える。具体的な会話内容は含めない。readVersion は取得時のバージョンUUID、未保存なら null。',
  inputSchema: v.strictObject({
    userId: DiscordIdSchema,
    ...MemoryUpdateSchema.entries,
  }),
  execute(input, context, signal) {
    return context.memory.update(
      { type: 'user', guildId: context.channel.guild.id, userId: input.userId },
      { readVersion: input.readVersion, text: input.text },
      signal,
    );
  },
});
