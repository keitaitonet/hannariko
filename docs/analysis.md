# Bot の利用分析

「利用状況を分析して」と依頼されたときに、エージェントが実施する手順。
指定がなければ直近7日を対象にし、前回のレポートがあれば比較する。
分析だけではプロンプト・本番設定を変更しない。

## データ取得

1. 対象期間を `[開始, 終了)` で固定し、取得日時と本番イメージを記録する。表示は JST。
2. `AWS_PROFILE=poc`、東京リージョンを使用。対象 EC2 は Terraform の `github_actions_variables.INSTANCE_ID` から確認する。
3. SSM の読み取りコマンドでコンテナの内部 IP とイメージを取得する。

   ```sh
   docker inspect hannariko-bot-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}} {{.Config.Image}}'
   ```

4. `AWS-StartPortForwardingSessionToRemoteHost` で内部 IP の `4111` をローカル `14111` に転送する。IP は固定しない。

   ```sh
   AWS_PROFILE=poc aws ssm start-session --region ap-northeast-1 \
     --target "$instance_id" --document-name AWS-StartPortForwardingSessionToRemoteHost \
     --parameters "{\"host\":[\"$container_ip\"],\"portNumber\":[\"4111\"],\"localPortNumber\":[\"14111\"]}"
   ```

5. `http://127.0.0.1:14111/api` 以下の GET API で取得する。仕様は `/system/api-schema` を確認する。

   | 対象 | パス・パラメータ |
   |---|---|
   | スレッド | `/memory/threads?agentId=discord-agent&page=0&perPage=100` |
   | 発言 | `/memory/threads/{id}/messages` に `agentId=discord-agent`、`page`、`perPage=100` |
   | 実行一覧 | `/observability/traces/light?page=0&perPage=5` |
   | 個別実行 | `/observability/traces/{traceId}` |

   発言は `orderBy={"field":"createdAt","direction":"ASC"}` と
   `filter={"dateRange":{"start":"開始ISO日時","end":"終了ISO日時","endExclusive":true}}` を URL エンコードして渡す。
   スレッドは `hasMore`、発言は返却件数が `perPage` 未満になるまでページを進める。
   実行一覧は `pagination.hasMore` を使う。返却件数だけで終了しない。
6. 応答 JSON と集計に使ったコード・コマンドを `.analysis/<取得日時>/` に保存する。分析は保存データに対して行い、ID で重複除去する。取得エラーや欠落は記録する。
7. 読み取り終了後に SSM トンネルを閉じる。

## 集計と読み方

- **受信発言数**：`role=signal` かつ `content.metadata.signal.type=user`。Discord の `messageId` があればそれで重複除去し、なければ保存 ID を使う。旧形式の `role=user` は実データを確認して扱う。
- **参加者数**：signal の `attributes.authorId`、または `content.providerMetadata.mastra.channels.discord.author.userId`。スレッドの `resourceId` を参加者と数えない。
- **本文付き応答数**：`role=assistant` で `content.parts` の `type=text` に空でない本文があるレコード。Discord への送信成功数とは区別する。
- **場所別・日別・時間帯別**に上記を集計。スレッドは `channel_externalThreadId`、親チャンネルは `channel_externalChannelId` で区別する。
- 初回発言に付く `[Thread context …]` は過去の会話。そこに含まれる引用を新しい発言・参加者に数えない。
- ツールは `tool-invocation` の `toolCallId` を重複除去して数える。リアクション、添付、空本文を通常の返信と混ぜない。
- 実行確認は発言の `content.metadata.traceId` から個別トレースへ進む。トークンは `model_generation.attributes.usage` をモデル別に集計し、子の `model_step` / `model_inference` と二重計上しない。空本文でもモデル利用はある。
- 履歴は Bot が保存した範囲。Discord 全体の発言数や、長期の完全な監査ログとは扱わない。

## 会話の評価と報告

少量なら全件、多ければ場所・時間帯ごとの会話例と問題例を読む。抜き出した発言の前後も確認する。
大学の仲間の雑なサーバーなので、いじりや Bot で遊ぶこと自体を失敗と扱わない。
雑談・実用依頼・遊びを分け、ノリに乗れているか、相手や話題が変わったときに切り替えられるかを見る。

レポートには対象期間、取得範囲、集計、良かった例、改善候補を記載する。
改善候補は最大3件を優先順にし、発言 ID / trace ID、観測した挙動、変更案を添える。
実行の成功と応答の質、観測事実と推測を分ける。サンプルから全体費用を外挿しない。
会話・個人情報を含むレポートも `.analysis/` に保存し、repo には汎用の手順だけ残す。

## 取得時の注意

DuckDB のメモリ上限は 256 MB。トレース100件の取得で OOM が発生したため、一覧は5件ずつ、詳細は必要な実行だけ取得する。
一覧で `pagination.total` と返却データに不整合・重複が見られた場合、総実行数として報告せず、履歴の trace ID と照合する。

## 改善の進め方

出力の問題から禁止事項を足す前に、個別トレースの `model_step.input` を確認する。
`model_generation.input` は記憶・channel 指示の追加前の場合がある。トレース自体の切り詰めも確認する。
Mastra は公開チャンネルでの沈黙を促す指示を自動追加するため、自作プロンプトだけで判断しない。

OpenAI 公式の [Reasoning best practices](https://developers.openai.com/api/docs/guides/reasoning-best-practices) と
[Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering) に沿い、目的と必要な文脈を簡潔に伝える。
合成会話で遊びへの参加・別の参加者への切り替え・人間同士の会話を変更前後で比較する。
語尾や一つの正解文に固定せず、実際の応答を読む。少数例の成功は品質保証とは扱わない。

`@mastra/memory` のパッチは、Observer に渡す `signal.type=user` の発言へ名前と ID を残すもの。
依存更新時は `pnpm test` で ESM/CJS の両方を確認し、上流で直っていればパッチを外す。
過去に発言者を失って生成された要約は、この修正だけでは復元されない。
