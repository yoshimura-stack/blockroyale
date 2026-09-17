# 任意：模擬クライアントによる通信負荷テスト

実機参加の前に、主催者自身が実行するための補助ツールです。Node.js 22以上が必要です。追加のnpmライブラリは不要です。

**同じSupabaseの本番試合が動いていない時間に実行してください。** 毎回 `BR39-LOAD-時刻` という新しい部屋を作り、指定人数を入室させて通信を発生させます。終了時にはその部屋だけをRESETします。既存のゲーム部屋は操作しませんが、CPU・通信・無料枠は共用です。最低30秒、最大900秒。強制終了するとテスト参加者が残るため、その場合はレポートの部屋名を確認して後で整理してください。

ZIP展開先でPowerShellを開きます。HOSTメールを設定し、パスワードはプロンプトで入力します。パスワードをチャット・ファイル・スクリーンショットへ載せないでください。

```powershell
$env:BR_HOST_EMAIL = '自分のHOSTメール'
$testCredential = Get-Credential -UserName $env:BR_HOST_EMAIL -Message '検証用HOSTログイン'
$env:BR_HOST_PASSWORD = $testCredential.GetNetworkCredential().Password
$env:BR_RUN_LOAD = 'YES'
$env:BR_LOAD_COUNT = '5'
$env:BR_LOAD_SECONDS = '120'
try { node tools/load-test.mjs }
finally {
  Remove-Item Env:BR_HOST_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:BR_RUN_LOAD -ErrorAction SilentlyContinue
  $testCredential = $null
}
```

5人で成功後、20人、50人に変更して段階的に実行します。再試行やAPIエラーが続く場合は増やさず停止。出力される `load-report-BR39-LOAD-*.json` に成功/失敗、応答時間p95、再試行回数、受信量が入ります。目安としてp95が500ms以内、再試行0、順位整合性成功を確認します（イベントの許容遅延に応じて判断）。

このツールの攻撃は20回の通信ごとに発生し、受信側は即座に確認します。実際のテトリス、2ターンの投下、端末描画、Wi-Fi、多数ブラウザの同期を検証するものではありません。`--local` は開発者用のローカルDBアダプター専用で、本番テストでは指定しません。
