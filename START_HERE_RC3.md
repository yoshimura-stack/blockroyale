# v0.39 RC3 — 入室コード入力の修正

根本原因は、HOSTの2秒polling開始時に共通renderが入室コード欄をdisabledにしていたことです。disabledになるとブラウザがfocusを解除するため、約2秒ごとにカーソルが外れていました。RC3ではDB同期領域と操作フォームを分離し、pollingは入力欄のDOM・value・disabled・focus・selectionを一切更新しません。

全角ASCII英数字・記号はHOST/PLAYER/PROJECTORで半角へ統一し、送信時に前後の空白を除去します。大文字・小文字は区別します。IME変換中は文字を書き換えません。

PLAYERにもコード表示チェック欄を追加しました。HOSTで12文字未満のコードを保存しようとした場合は「保存していません」「現在の文字数」「以前のコードが有効」を明示します。入力だけではコードは変更されません。

## 反映と確認

1. v039-free50-testのpublic/をこのZIPのpublic/で更新します。mainは対象外です。wrangler.jsoncはassets.directoryが./publicのままです。
2. Cloudflareの公開完了後、HOSTとPLAYERを再読み込み。HOSTでv0.39 RC3を確認します。
3. HOSTへログインし、LOBBY・参加者0人で12〜160文字の入室コードを入力します。「入室コードを変更」を押し、確認後に「入室コードを変更しました」が出ることを確認します。
4. 同じコードをPLAYERへ入力してREADY。表示チェック欄で入力内容を確認できます。HOSTのREADY=1 / ALIVE=1を確認してBATTLE STARTします。

1人の正常系テストを可能にする追加SQL `supabase/migrations/20260929065814_single_player_smoke_start.sql` を含みます。検証用Supabaseには適用済みです。新しい環境だけRC1→RC2→RC3の順に適用してください。既存の保存済みコードは変更していません。短い4桁コードへの仕様変更はしていません。

自動テスト30件成功。実ブラウザでも入力欄を11秒間フォーカス後、再クリックなしで入力を継続できることを確認しました。ROOM作成→PLAYER 1名JOIN→HOST READY=1 / ALIVE=1→8秒COUNTDOWN→BATTLEを通過しています。実Supabaseでも同じ1人フローをトランザクション内で確認し、テストデータはロールバックしました。

ZIPは完成していますが、この作業ではGitHub・Cloudflareへ反映していません。RC2で確認されたGitHub連携の書き込み権限不足があるため、テスト用ブランチへ配置してください。
