import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { formatMessagesForObserver } from "@mastra/memory/processors";

const require = createRequire(import.meta.url);
const implementations = {
  esm: formatMessagesForObserver,
  cjs: require("@mastra/memory/processors").formatMessagesForObserver,
};

function message(id, text, attributes, type = "user") {
  return {
    id,
    role: "signal",
    createdAt: new Date("2026-09-15T10:00:00Z"),
    content: {
      format: 2,
      parts: [{ type: "text", text }],
      metadata: { signal: { type, attributes } },
    },
  };
}

for (const [name, format] of Object.entries(implementations)) {
  test(`${name}: keeps distinct authors when summarizing a group conversation`, () => {
    const output = format([
      message("a", "俺には猫語で返して", { authorName: "同じ表示名", authorId: "111" }),
      message("b", "明日の集合時間は？", { authorName: "同じ表示名", authorId: "222" }),
    ]);
    assert.match(output, /User \{"name":"同じ表示名","id":"111"\}.*俺には猫語で返して/);
    assert.match(output, /User \{"name":"同じ表示名","id":"222"\}.*明日の集合時間は？/);
  });

  test(`${name}: handles missing identity and escapes multiline display names`, () => {
    const output = format([
      message("a", "こんにちは", { authorName: '名前\n"別の行"', authorId: "111" }),
      message("b", "IDのみ", { authorId: "222" }),
      message("c", "不明", undefined),
    ]);
    assert.ok(output.includes(JSON.stringify({ name: '名前\n"別の行"', id: "111" })));
    assert.match(output, /User \{"id":"222"\}.*IDのみ/);
    assert.match(output, /User: 不明/);
  });

  test(`${name}: preserves non-user signals and ordinary messages`, () => {
    const output = format([
      message("a", "通知", undefined, "reminder"),
      { id: "b", role: "user", content: "通常の入力" },
      { id: "c", role: "assistant", content: "了解" },
    ]);
    assert.match(output, /Signal.*通知/);
    assert.match(output, /User.*通常の入力/);
    assert.match(output, /Assistant.*了解/);
  });
}
