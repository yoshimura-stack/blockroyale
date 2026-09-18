# 今回の反映状況（2026-09-18）

- Supabaseの追加SQLは適用済みです。再実行は不要です。
- BLOCK-TEST-039は既存の部屋を維持し、依頼されたテスト用入室コードへ変更済みです。コード実値はこのファイルには記載しません。
- 実DBで2人JOIN→START→VIEW→勝者確定→NEXT→RESETを検証済み。検証用データはトランザクションをロールバックしたため残っていません。
- ローカル自動テスト27件成功。実HOSTアカウントによるログイン、公開URLでの2人対戦、50人実機負荷テストは未完了です。
- GitHub連携の書き込みが403（Resource not accessible by integration）となったため、GitHubとCloudflareへRC2を反映できていません。mainも変更していません。

## 残りの反映手順

1. ZIPを展開し、GitHubの **v039-free50-test** に `public/`、`wrangler.jsonc`、更新済みの説明書・SQL・テストを配置してコミットします。mainは対象外です。
2. `wrangler.jsonc` の `assets.directory` が `./public` であることを確認します。既存のルートHTML/JS等が残っていてもこの設定では配信されません。ZIPは整理済みの完全な構成です。
3. Cloudflareの自動デプロイ成功後、/host を再読み込みし `v0.39 RC2` 表示を確認します。
4. /.git/HEAD、/README.md、/supabase/SETUP_HOST.sql、/tests/package.json が404になることを確認します。
5. HOSTへログインします。既存部屋のため「部屋作成済み」が正しく、新規作成は不要です。そのままPLAYER 2人でREADY→STARTへ進めます。

## セキュリティ確認

変更した関数は固定search_path、実行権限、主催者allowlist、入室コード・参加者トークンの照合を維持しています。br39のテーブルは直接公開せず、検査付きAPIからアクセスします。

Supabase Advisorには、この設計によるRLSポリシー未設定（直接アクセスを拒否する意図）と公開SECURITY DEFINER APIの警告が残ります。認証・コード検査が必要なAPIなので実行権限の無条件削除は行っていません。
[APIの警告の説明](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)

旧版由来のset_updated_atのsearch_path警告、旧版関数の実行権限警告、Authの漏えいパスワード保護未有効も残っています。今回の修正範囲外として変更していません。
[search_pathの説明](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) / [パスワード保護の説明](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
