import * as v from 'valibot';
import { DiscordIdSchema } from '../discord/id.ts';
import { ToolCallSchema } from '../tools/index.ts';

export function createActionSchema<ToolSchema extends v.GenericSchema>(toolSchema: ToolSchema) {
  return v.union([
    v.strictObject({
      type: v.literal('reply'),
      text: v.pipe(v.string(), v.minLength(1), v.maxLength(2_000)),
      // nullは返信先を指定しない通常の投稿。
      replyTo: v.nullable(DiscordIdSchema),
    }),
    v.strictObject({ type: v.literal('silent') }),
    v.strictObject({ type: v.literal('tool_call'), tool: toolSchema }),
  ]);
}

export const ActionSchema = createActionSchema(ToolCallSchema);

export type Action = v.InferOutput<typeof ActionSchema>;
