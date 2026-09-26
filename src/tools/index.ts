import * as v from 'valibot';
import type { ToolContext } from './context.ts';
import { getConversation } from './getConversation/index.ts';
import { setUserMemory } from './setUserMemory/index.ts';
import { setChannelMemory } from './setChannelMemory/index.ts';
import { setPersonality } from './setPersonality/index.ts';
import { addReaction } from './addReaction/index.ts';

// guild とチャンネルは実行中の処理から渡し、LLMには選択させない。
export const tools = {
  getConversation,
  setUserMemory,
  setChannelMemory,
  setPersonality,
  addReaction,
};

// 生成時は各ツールの引数制約を提示し、受信時の検証・変換はexecuteで行う。
export const ToolCallGenerationSchema = v.union(Object.values(tools).map(tool => tool.callSchema));

export const ToolCallSchema = v.strictObject({
  name: v.picklist(Object.values(tools).map(tool => tool.name)),
  arguments: v.record(v.string(), v.unknown()),
});
export type ToolCall = v.InferOutput<typeof ToolCallSchema>;

export async function executeTool(call: ToolCall, context: ToolContext, signal: AbortSignal) {
  return tools[call.name].execute(call.arguments, context, signal);
}
