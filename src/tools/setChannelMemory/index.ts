import { defineTool } from '../define-tool.ts';
import { MemoryUpdateSchema } from '../../memory/index.ts';

export const setChannelMemory = defineTool({
  name: 'setChannelMemory',
  description: '現在のチャンネルの記憶を全文置き換える。readVersion は取得時のバージョンUUID、未保存なら null。',
  inputSchema: MemoryUpdateSchema,
  execute(input, context, signal) {
    return context.memory.update(
      { type: 'channel', guildId: context.channel.guild.id, channelId: context.channel.id },
      input,
      signal,
    );
  },
});
