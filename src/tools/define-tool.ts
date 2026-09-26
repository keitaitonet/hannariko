import * as v from 'valibot';
import type { ToolContext } from './context.ts';

export function defineTool<const Name extends string, Input extends v.GenericSchema, Result>(
  definition: {
    name: Name;
    description: string;
    inputSchema: Input;
    execute(input: v.InferOutput<Input>, context: ToolContext, signal: AbortSignal): Promise<Result>;
  },
) {
  return {
    name: definition.name,
    callSchema: v.pipe(
      v.strictObject({ name: v.literal(definition.name), arguments: definition.inputSchema }),
      v.description(definition.description),
    ),
    async execute(rawInput: unknown, context: ToolContext, signal: AbortSignal): Promise<Result> {
      signal.throwIfAborted();
      return definition.execute(v.parse(definition.inputSchema, rawInput), context, signal);
    },
  };
}
