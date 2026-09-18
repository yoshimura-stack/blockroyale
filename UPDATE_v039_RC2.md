# v0.39 RC2 — 入室コード管理と公開範囲の修正

対象は `v039-free50-test` / `blockroyale-v039-test`。mainは更新しません。

## 修正内容

- CREATEは新規作成専用。既存部屋なら明示エラーとなり、コードを変更しません。
- HOSTログイン、部屋の存在、操作結果を別々に表示。自動更新で操作結果を消しません。
- 「入室コードを変更」を追加。主催者認証済み・LOBBY・参加者0人の場合のみ利用できます。RESETとは別操作です。
- コード変更とJOINは部屋単位で順序を確定し、変更前のコードが競合時に通らないようにしました。
- PLAYERの入室エラーを中央のENTRYカードにも表示。コード修正後、READYで再試行できます。
- Cloudflareの公開対象を `public/` に限定。.git・SQL・説明書・テストは公開対象外です。
- ゲームエンジン、背景、HUD、攻撃ルール、通信間隔は維持しています。

## RC1からの更新

1. Supabaseに追加SQL `supabase/migrations/20260917063330_room_entry_management.sql` を適用します。RC1のSQLを後から再実行しないでください。
2. このフォルダ構成でテスト用ブランチを更新します。`npx wrangler deploy` は `wrangler.jsonc` が指定する `public/` だけを公開します。
3. HOSTを再読み込みしてログイン。「ROOM接続済み・部屋作成済み」が出る既存部屋では新規作成不要です。
4. 必要なときだけ、参加者0人のLOBBYで入室コードを変更して参加者に伝えます。保存済みコードは表示できません。

新規環境はRC1→RC2の順でSQLを適用し、SETUP_HOST.sqlで主催者を登録してください。設定ファイルの場所は `public/js/config.js` です。コードやHOSTのパスワードをGitHubへ保存しないでください。

## 確認手順

1. HOSTログイン後、認証済み表示とROOM状態を確認。
2. PLAYER 1、2が同じコードでREADY。HOSTのREADYが2になることを確認。
3. BATTLE START。8秒後に開始。HOSTのF5で参加者・試合状態が維持されることを確認。
4. 決着後NEXT BATTLE。2人が再入力なしでREADYへ戻ることを確認。
5. EMERGENCY RESET。HOST一覧0、PLAYERはENTRY、PROJECTORはLOBBYへ戻ることを確認。
6. その後5人→20人→50人。実機50人の同時対戦性能・無料枠の実測は別途必要です。

## 自動検証

`tests/` で `npm ci`、`npm test`。既存DB9件、クライアント11件、コード管理6件、公開範囲1件の計27件。
コード変更条件、旧コード拒否、重複CREATE、2人JOIN/READY/START、HOST再取得、NEXT/RESET、古い操作の拒否を検証します。DB検証はPGlite上であり、実際のHOSTアカウント認証や50人の回線性能を保証するものではありません。

Cloudflare公開範囲の仕様: https://developers.cloudflare.com/workers/static-assets/binding/
