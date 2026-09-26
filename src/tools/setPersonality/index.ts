import { defineTool } from '../define-tool.ts';
import { MemoryUpdateSchema } from '../../memory/index.ts';

export const setPersonality = defineTool({
  name: 'setPersonality',
  description: '現在のguildでの自分の人格を全文置き換える。readVersion は取得時のバージョンUUID、未保存なら null。',
  inputSchema: MemoryUpdateSchema,
  execute(input, context, signal) {
    return context.memory.update(
      { type: 'personality', guildId: context.channel.guild.id },
      input,
      signal,
    );
  },
});
