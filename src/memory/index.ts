import * as v from 'valibot';

export const VersionSchema = v.nullable(v.pipe(v.string(), v.uuid()));
export const MemoryTextSchema = v.pipe(v.string(), v.maxLength(2_000));

export const MemorySchema = v.strictObject({
  version: VersionSchema,
  text: MemoryTextSchema,
});
export type Memory = v.InferOutput<typeof MemorySchema>;

export type MemoryTarget = { guildId: string } & (
  | { type: 'user'; userId: string }
  | { type: 'channel'; channelId: string }
  | { type: 'personality' }
);

export const MemoryUpdateSchema = v.strictObject({
  readVersion: VersionSchema,
  text: MemoryTextSchema,
});
export type MemoryUpdate = v.InferOutput<typeof MemoryUpdateSchema>;
export type MemoryUpdateResult =
  | { status: 'saved'; memory: Memory }
  | { status: 'conflict' };

export type MemoryRepository = {
  // 未保存の記憶は { version: null, text: '' } として返す。
  read(target: MemoryTarget, signal: AbortSignal): Promise<Memory>;
  update(target: MemoryTarget, input: MemoryUpdate, signal: AbortSignal): Promise<MemoryUpdateResult>;
};
