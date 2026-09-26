import OpenAI from 'openai';
import { toJsonSchema } from '@valibot/to-json-schema';
import * as v from 'valibot';
import { ActionSchema, createActionSchema } from '../conversation/action.ts';
import { ToolCallGenerationSchema } from '../tools/index.ts';
import { logger } from '../logging/logger.ts';

export class ModelOutputError extends Error {}

// OpenAIの出力ルートはオブジェクトにする。
const ResponseSchema = v.strictObject({ value: ActionSchema });
const format: OpenAI.Responses.ResponseFormatTextJSONSchemaConfig = {
  type: 'json_schema',
  name: 'result',
  strict: true,
  schema: {
    ...toJsonSchema(v.strictObject({ value: createActionSchema(ToolCallGenerationSchema) }), {
      typeMode: 'input',
      errorMode: 'throw',
      overrideSchema: ({ jsonSchema }) => {
        // OpenAIはconstにも明示的なtypeを要求する。
        const type = typeof jsonSchema.const;
        if (type === 'string' || type === 'number' || type === 'boolean') {
          return { ...jsonSchema, type };
        }
      },
    }),
  },
};

export function createActionGenerator(options: { client: OpenAI; model: string }) {
  return async ({ input, previousResponseId, instructions, signal }: {
    instructions: string;
    input: OpenAI.Responses.ResponseInput;
    previousResponseId?: string;
    signal: AbortSignal;
  }) => {
    signal.throwIfAborted();
    const request: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
      model: options.model,
      store: true,
      previous_response_id: previousResponseId,
      instructions,
      input,
      text: { format },
      tools: [{ type: 'web_search' }],
      include: ['web_search_call.action.sources'],
    };
    logger.log({ type: 'request', request });
    const response = await options.client.responses.create(request, {
      signal,
      timeout: 120_000,
      maxRetries: 0,
    });
    signal.throwIfAborted();
    logger.log({ type: 'response', response });
    if (response.status !== 'completed') throw new ModelOutputError(`Response ${response.status}`);
    if (response.output.some((item) => item.type === 'message' &&
      item.content.some((part) => part.type === 'refusal'))) {
      throw new ModelOutputError('Model refused the request');
    }
    return { action: parseAction(response.output_text), responseId: response.id };
  };
}

function parseAction(text: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    logger.log({ type: 'invalid_output', text, issues: 'Invalid JSON' });
    throw new ModelOutputError('Invalid JSON');
  }
  const parsed = v.safeParse(ResponseSchema, raw);
  if (!parsed.success) {
    logger.log({ type: 'invalid_output', text, issues: parsed.issues });
    throw new ModelOutputError('Output failed schema validation');
  }
  return parsed.output.value;
}
