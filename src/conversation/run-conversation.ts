import type { Action } from './action.ts';
import type { ToolCall } from '../tools/index.ts';
import { withDeadline } from './deadline.ts';
import { logger } from '../logging/logger.ts';

export const RUN_LIMITS = {
  modelMs: 120_000,
  toolMs: 30_000,
  jobMs: 300_000,
  toolCalls: 10,
} as const;

export type Job = { guildId: string; channelId: string; messageId: string };
export type ConversationSession = {
  decide(input: string, toolsRemaining: number, signal: AbortSignal): Promise<Action>;
};
export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };
export type Outcome =
  | { type: 'silent' }
  | { type: 'reply'; messageId: string }
  | { type: 'failed'; error: unknown };

// Discord のアクセス確認、バージョンUUIDを照合したメモリ更新、I/O は各アダプターが担当する。
// 各関数は AbortSignal に従い、中断後にバックグラウンドで書き込みを続けない。
export type ConversationPorts = {
  prepare(signal: AbortSignal): Promise<string>;
  createSession(): ConversationSession;
  execute(tool: ToolCall, signal: AbortSignal): Promise<unknown>;
  reply(action: Extract<Action, { type: 'reply' }>, signal: AbortSignal): Promise<string>;
};

// 全体の時間制限と終了結果の記録を担当する。
export async function runConversation(job: Job, ports: ConversationPorts): Promise<Outcome> {
  let outcome: Outcome;
  try {
    outcome = await withDeadline(RUN_LIMITS.jobMs, undefined, (signal) =>
      runLoop(job, ports, signal));
  } catch (error) {
    outcome = { type: 'failed', error };
  }
  logger.log({ type: 'finished', outcome });
  return outcome;
}

async function runLoop(job: Job, ports: ConversationPorts, signal: AbortSignal): Promise<Outcome> {
  const input = await ports.prepare(signal);
  signal.throwIfAborted();
  logger.log({ type: 'input', job, input });

  const session = ports.createSession();
  let nextInput = input;
  let toolCalls = 0;

  while (true) {
    const action = await decideAction(nextInput, RUN_LIMITS.toolCalls - toolCalls, session, signal);

    switch (action.type) {
      case 'reply':
        return await sendReply(action, ports, signal);

      case 'silent':
        return { type: 'silent' };

      case 'tool_call': {
        if (toolCalls >= RUN_LIMITS.toolCalls) throw new Error('Tool call limit exceeded');
        toolCalls += 1;
        const result = await executeTool(action.tool, ports, signal);
        nextInput = JSON.stringify({ toolResult: { name: action.tool.name, ...result } });
        break;
      }
    }
  }
}

async function decideAction(
  input: string,
  toolsRemaining: number,
  session: ConversationSession,
  signal: AbortSignal,
): Promise<Action> {
  const action = await withDeadline(RUN_LIMITS.modelMs, signal, (stepSignal) =>
    session.decide(input, toolsRemaining, stepSignal));
  signal.throwIfAborted();
  logger.log({ type: 'action', action });
  return action;
}

async function sendReply(
  action: Extract<Action, { type: 'reply' }>,
  ports: ConversationPorts,
  signal: AbortSignal,
): Promise<Outcome> {
  const messageId = await withDeadline(RUN_LIMITS.toolMs, signal, (stepSignal) =>
    ports.reply(action, stepSignal));
  signal.throwIfAborted();
  return { type: 'reply', messageId };
}

async function executeTool(
  tool: ToolCall,
  ports: ConversationPorts,
  signal: AbortSignal,
): Promise<ToolResult> {
  let result: ToolResult;
  try {
    const data = await withDeadline(RUN_LIMITS.toolMs, signal, (stepSignal) =>
      ports.execute(tool, stepSignal));
    result = { ok: true, data };
  } catch (error) {
    // 全体の中断は会話処理を終了させる。ツール単体の失敗はLLMへ返して再判断する。
    signal.throwIfAborted();
    logger.log({ type: 'tool_error', tool, error });
    // SDKのエラーには認証情報が含まれる可能性があるため、そのまま渡さない。
    result = { ok: false, error: 'Tool execution failed or timed out' };
  }
  signal.throwIfAborted();
  logger.log({ type: 'tool_result', tool, result });
  return result;
}
