# BLOCK ROYALE v0.36 — SESSION RESET FIX

v0.35 HUD CLARITY FIX の実ファイルをベースに修正しました。

## 導入手順（追加SQLが必須です）

1. 旧バージョンのHOST / PLAYER / PROJECTORタブを閉じます。
2. Supabase SQL Editorで `supabase_v036_session_reset.sql` の全文を1回実行します。再実行も可能です。
3. このZIPの中身をGitHubのリポジトリ直下へ上書きし、Cloudflare Pagesへ反映します。ビルドは不要です。
4. 新しいHOSTを開き、初回はEMERGENCY RESETを押して以前の参加者を消します。以降はHOSTのF5でも同じリセットが動きます。
5. PLAYER / PROJECTORを開き直し、PLAYERで名前を入力してREADYします。

v0.20 / v0.21のSQLが導入済みであることを前提にしています。追加SQLは既存のphase制約・RLSポリシーを削除したり、権限を広げたりしません。既存の公開クライアントに必要なSELECT / UPDATE / DELETE権限が不足している環境ではエラー内容を表示します。

## 変更後の挙動

- HOSTをF5・ブラウザの更新ボタンで再読み込みすると、その部屋の全参加者・盤面・スコア・攻撃履歴をリセットします。対戦中も対象です。
- HOSTのURLを通常開く操作や、別のHOSTタブを新しく開く操作では自動リセットしません。
- EMERGENCY RESETはF5と同じDB処理を使います。
- PLAYERはゲームを停止して自動再読み込みし、名前入力から再参加します。参加者IDも新しくします。
- PROJECTOR / HOSTはLOBBY・参加者0へ戻ります。Realtimeを取りこぼしてもDBの定期確認で復帰します。通信断中の画面は通信復旧後に同期します。
- NEXT BATTLEは参加者を維持して次の対戦を準備します。EMERGENCY RESETとは別です。
- 他の部屋のデータは削除しません。

## 調査結果

### ① HOSTリロード後の残留

HOSTの初期化は同じroom_codeのmatchesと、同じmatch_idのplayersをSELECTするだけでした。オンライン参加者一覧はPresenceではなくDBの永続レコードです。F5で消える処理はありません。

さらにPLAYERはsessionStorageのIDを使い、定期的にplayers / player_statesへupsertしていました。旧RESETは通知後に1.1秒待ってから削除する方式なので、通知の取りこぼしやバックグラウンドタブの遅延で再作成される余地がありました。

修正版はreset_epochを部屋・参加者・盤面・攻撃へ付け、DBトリガーで旧世代のINSERT / UPDATEを拒否します。リセットのロックと書き込みのロックを競合させ、削除後に遅着した保存が通らないようにしています。

### ② 「RESET通知に失敗しました。」

この文言はHOSTがmatchesを `phase: RESET` にUPDATEして失敗した場合のものです。Broadcast / Edge Functionへの送信エラーではありません。オンラインの経路はSupabaseのDB更新とPostgres Changesです。js/bus.jsのBroadcastChannelはこの処理には使われていません。

旧ZIPはRESET phaseを使いながら、それを許可する制約変更SQLを同梱していませんでした。4種類のphaseだけを許可する検証用CHECK制約では旧UPDATEが23514エラーになることを再現しました。ただし本番DBの定義・詳細エラーログは未取得のため、本番の直接原因がCHECK / enum / RLS / GRANTのどれかは未確定です。

新処理は既存のLOBBYを使用し、RPC `br_reset_room` の1トランザクションで世代更新と3テーブルの削除を行います。途中でエラーが出れば全体を取り消します。削除がRLSで無視された場合も、呼び出し元が参照できる対象行の残留を検査します。呼び出し元から不可視のデータまで含めた本番ポリシーの保証には実環境の確認が必要です。

RPCはSECURITY INVOKERで既存の権限を使います。RESET専用の権限昇格やservice_roleキーは追加していません。同じ世代への再送は再削除せず、ロック競合時は同じ世代で最大3回まで試行します。

## 維持したファイル

CSS、背景画像、PLAYER / PRACTICEのHTML、tetris.js、render.js、practice.js、ambient.js、config.js、supabase.jsはv0.35とバイト単位で同一です。viewport / Arena Reveal / Line Impact FX / HUD Clarity、操作・スコア・攻撃ルールの実装を維持しています。

## 検証

- JavaScript全ファイルの構文確認。
- ローカルPostgreSQL互換エンジン（PGlite）で11項目：旧phaseエラー再現、SQL再実行、anon RPC、全削除、他室の保全、旧世代の参加者・盤面・攻撃拒否、再送時の新規参加者保全、NEXT BATTLE、RLS失敗時のロールバック、既存v0.21勝者判定。
- モックDOM / 通信によるクライアント10項目：HOST F5、通常起動、RESET、権限エラー、SQL未適用、PLAYERのpolling復帰、NEXT BATTLE、古いカウントダウン停止、PROJECTORのpolling復帰、古いRealtime参加者イベント拒否。
- 本番Supabase・実ブラウザの複数端末Realtime・実際の同時接続負荷テストは未実施です。検証用DBは既存コードから組み立てたスキーマです。

再実行する場合はNode.js環境で `tests` フォルダに移動し、`npm ci` → `npm test` を実行してください。

## デプロイ後の確認

1. 2人READY → HOST F5 → HOST / PROJECTORがLOBBY・0人、PLAYERがENTRYへ戻る。
2. 2人再READY → BATTLE START → COUNTDOWN中にRESET。4秒以上待ってもBATTLEへ戻らない。
3. 対戦中・RESULTでもRESETする。全画面で旧スコア・盤面・勝者表示が消える。
4. PLAYERを一時的にオフラインにしてRESET → 復帰後ENTRYへ戻り、旧参加者が復活しない。
5. NEXT BATTLEでは参加者を維持し、スコア0から再開できる。

参考：
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://www.postgresql.org/docs/17/explicit-locking.html
