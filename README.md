# BLOCK ROYALE — Phase 1 Starter V0.9 SUPABASE ONLINE

## 今回盛り込んだ仕様
- 王道7テトリミノ: I / O / T / S / Z / J / L
- 7-bag
- NEXT 1個 / HOLDなし
- A/D 左右移動
- ←/→ 左右回転
- ↓ Soft Drop（押している間だけ高速下降）
- S Soft Drop（↓と同じ）
- Lock Delay 500ms / move reset上限15
- Hard Drop即固定
- SCORE: Single 100 / Double 300 / Triple 500 / 4-Line 800 × LEVEL + Hard Drop距離×2
- 60秒ごと全員一律LEVEL UP
- 15秒 OPENING PHASE（攻撃ロック）
- 攻撃: 1LINE=0 / 2=1 / 3=2 / 4=3
- COMBO: 2=+1 / 3=+2 / 4=+3 / 5+=+4
- Incomingは受信中のミノを1ターン目として2ターン
- 攻撃力で古いIncomingから相殺
- 余剰攻撃は新規攻撃
- Garbageは1攻撃内で穴固定、別攻撃で穴再抽選
- Garbage天井超過のみ LAST CHANCE 1 TURN
- 通常Top Outは即K.O.
- DOUBLE / TRIPLE / 4-LINE / COMBO / ATTACK / BLOCK / PERFECT DEFENSE / LAST CHANCE演出
- HOST / PLAYER / PROJECTOR
- RESULT向け統計: SCORE / MAX COMBO / MAX ATTACK
- NEXT BATTLE / EMERGENCY RESET

## 重要: 現在の通信
このZIPは **Phase 1のローカル対戦スターター** です。
BroadcastChannelを使っているため、HOST/PLAYER/PROJECTORを同じPC・同じブラウザ系で複数タブ起動すると対戦確認できます。

Cloudflare Pagesに公開してPLAYER単体を触ることはできますが、
**別PC間の通信はまだSupabase未接続なので動きません。**

次工程で以下を入れます:
1. Supabase DB = source of truth
2. Supabase Realtime = fast delivery
3. server-authoritative attackId / random target
4. reconnect recovery / self-heal
5. server clock
6. 2–4人 → 10人 → 30–50人負荷テスト

## ローカル起動
ES Modulesを使うので、ファイルを直接ダブルクリックせずローカルサーバー推奨。

Pythonがある場合:
```bash
python -m http.server 8080
```

開く:
- http://localhost:8080/player.html
- http://localhost:8080/host.html
- http://localhost:8080/projector.html

## GitHub → Cloudflare Pages
このフォルダの中身をリポジトリ直下へ置く。
静的HTML/CSS/JSなのでビルド不要。

Cloudflare Pages:
- Framework preset: None
- Build command: 空欄
- Build output directory: `/`

## 今日の最初のSmoke Test
1. HOST 1タブ
2. PLAYER 2〜4タブ
3. 各PLAYERで名前入力 → READY
4. HOSTでBATTLE START
5. 3,2,1 → GO
6. 15秒後 ATTACK UNLOCKED
7. 2ライン以上を消してランダム攻撃
8. Incoming 2TURN / 相殺 / Garbage確認
9. 60秒後 LEVEL 2
10. KO / NEXT BATTLE / RESET確認

## 注意
Three.jsによる本格3Dレンダラーは、まずこの2Dロジックを安定させた後に差し替える設計です。
ゲームロジックと描画を分離しているので、次工程で `render.js` をThree.js rendererへ置換できます。

## V0.5 HUD
- 左RIVALS: 自分より順位が近い上位1人 / 下位1人
- 右BATTLE: 最後に攻撃した相手 / 最後に自分を攻撃した相手
- 名前 / 順位 / SCORE / 軽量MINI BOARD
- snapshot 500ms（ローカル版）

## V0.5 update
- S / ↓ を両方 Soft Drop に統一
- RIVALS / BATTLE の4枚MINI BOARDを大型化
- 左右サイドレールを広げ、ワイド画面の余白を活用

## V0.6 HUD Rebalance
- 左上を MAX COMBO / MAX ATTACK / 操作 / NEXT のコンパクトな2カラムに再構成
- NEXTのCanvas比率を固定し、横伸びを防止
- RIVALS / BATTLE は横に引き伸ばさず、縦スペースを使ってカード自体を大型化
- MINI BOARDは常に1:2比率を維持
- S / ↓ は両方 Soft Drop

## V0.7 Start Countdown
- HOSTのBATTLE START後、PLAYER盤面全面に 3 → 2 → 1 → START! を大きく表示
- START表示後にゲーム開始、約0.85秒でオーバーレイ消去
- S / ↓ のSoft DropはV0.6仕様を維持

## V0.8 Mini Board Fit Fix
- RIVALS / BATTLE のMINI BOARDがカード枠をはみ出す問題を修正
- 1:2比率は維持しつつ、カードの高さに自動フィット
- 低い画面ではMINI BOARDを段階的に縮小
- 極端に低い画面ではサイドパネル内スクロールへ退避
- V0.7の 3 → 2 → 1 → START! と S / ↓ Soft Drop は維持

## V0.9 Supabase Online
- BLOCK ROYALE専用Supabase projectへ接続
- ROOM: BLOCK-001
- HOST / PLAYER / PROJECTOR を別PC・別ブラウザで同期
- 500msごとに軽量盤面snapshotをDBへupsert
- RealtimeでPLAYER / SCORE / BOARD / ATTACK / MATCH状態を反映
- Publishable keyのみフロントに使用
- service_role / secret key / DB password は未使用

### Online Smoke Test
1. GitHubへV0.9を上書き
2. Cloudflareデプロイ完了
3. PC AでHOST
4. PLAYER Aを開いてREADY
5. 別PC/別ブラウザでPLAYER Bを開いてREADY
6. HOSTに2人出る
7. BATTLE START
8. 両PLAYERで3→2→1→START!
9. RIVALS MINI BOARDが相互更新
10. 2LINE以上消して相手INCOMING確認

## V0.9a Auth Fix
- Supabase接続キーを Legacy anon/public key に切替
- 401認証エラーの切り分け用
- service_role / secret key は未使用
- HOST画面の旧BroadcastChannel注記をSUPABASE ONLINE表示へ更新

## V0.9b Player Syntax Fix
- player.js の READY ボタンを止めていた SyntaxError: Unexpected token ')' を修正
- Supabase Legacy anon/public key 接続とGRANT前提は維持

## V0.9c READY / Syntax Hard Fix
- callbacks() を丸ごと再構築し、V0.9系の文字列置換由来の構文崩れを除去
- READY処理も丸ごと再構築
- READY中は CONNECTING、成功後 READY、失敗時 ERROR を表示
- jsフォルダ内の全JavaScriptを Node --check で構文検証

## V0.10 Auto Match End
- HOSTがBATTLE中のALIVE人数を監視
- 2人以上で開始した試合でALIVEが1人以下になった瞬間、matches.phaseをRESULTへ変更
- 最後の1人をWINNERとして停止
- PLAYERの生存者は `👑 WINNER` 表示で操作停止
- K.O.済みPLAYERはそのままK.O.表示
- PROJECTORはRESULTでWINNERを大表示
- NEXT BATTLEで再びLOBBYへ戻せる

## V0.11 Rival Rank Fix
- RIVALSの順位計算を「生存者だけ」から「試合参加者全体」に修正
- 生存者はK.O.済みプレイヤーより上位として扱う
- 1位ならRIVAL ↑は空白のまま
- 1位でも直下のRIVAL ↓は必ず表示可能
- K.O.後も直近順位のライバル盤面を表示できる
- BATTLEのATTACK TARGET / ATTACKER仕様は変更なし

## V0.12 Emergency Reset Hard Fix
- RESET後に過去プレイが復活する原因を修正
- 原因は、削除直後に開いているPLAYERが500ms周期upsertで自分と盤面を再作成していたため
- RESET時にbattle_noを先に更新し、PLAYER側のjoinedをfalseにして自動upsert停止
- その後attacks / player_states / playersを削除
- PLAYERはENTRY画面へ戻り、RIVALS / BATTLEキャッシュも消去
- HOST / PROJECTORもDELETEイベントで参加者をローカル表示から除去
- EMERGENCY RESET後は全員再READYが必要

## V0.13 Attack Direction Toast
- 攻撃が発生した瞬間、PLAYER盤面中央に大きな方向通知を表示
- 自分が攻撃: `ATTACK TO / 相手名 / GARBAGE ×N`
- 自分が攻撃を受けた: `ATTACK FROM / 相手名 / INCOMING ×N`
- OUTGOINGはゴールド、INCOMINGは赤系で視認性を分離
- 約1.45秒で自動消去し、プレイを止めない
- 右側BATTLEカードのATTACK TARGET / ATTACKER表示も従来どおり維持

## V0.14 Winner Splash / Result Flow
- MATCH END時にPLAYER中央へ大きなRESULTオーバーレイを表示
- 勝者本人: `WINNER / 名前 / SCORE / #1`
- 敗者側: 勝者名を大きく表示し、自分の順位も表示
- 自動で次ラウンドには進まず、HOSTが実況・結果確認後にNEXT BATTLEを押す設計
- 全員K.O.になった場合もrank=1を決定してWINNER表示
- K.O.時に順位をDBへ保存
- PROJECTORもRESULTでWINNER名とSCOREを大表示

## V0.15 Japanese-first Battle HUD
- 「ランキングが近い上位プレイヤー / 下位プレイヤー」に変更
- 「攻撃したプレイヤー / 攻撃してきたプレイヤー」に変更
- 攻撃送信時に相手名と邪魔ブロック列数を中央表示
- 攻撃受信時に相手名と接近中の邪魔ブロック列数を中央表示
- 邪魔ブロックが実際にせり上がる瞬間に「攻撃してきたプレイヤー / 名前 / 邪魔ブロックN列投下」を中央表示

## V0.16 Emergency Reset Self-Heal
- EMERGENCY RESET後にPLAYER画面が旧試合のまま残る問題を修正
- PLAYER復帰をRealtime UPDATEだけに依存しないよう変更
- 1秒ごとにmatchesをDB確認し、battle_no世代変更 + LOBBYを検知したら強制的にENTRY画面へ復帰
- RESET時はゲーム停止、名前/盤面/RIVALS/BATTLE/攻撃元/RESULT/COUNTDOWN/TOASTを全クリア
- joined=falseで500ms周期upsertを停止し、削除済みPLAYERがDBへ復活しないようにする
- HOSTは世代更新 → 900ms待機 → attacks/player_states/players削除 → LOBBY再確定
- Realtime = 速報 / DB = 真実 / polling = Self Heal の構成

## V0.17 Responsive Player HUD
- PCウィンドウを小さくしても3カラムを維持
- 左RIVALS / 中央盤面 / 右攻撃情報を1画面に収める
- 盤面は10:20比率を維持し、20行全体が見える高さへ自動縮小
- 1536x864 / 1366x768クラスでは左右カード・文字・NEXTを段階的に縮小
- 狭いPCウィンドウではNEXT表示を省略してでもRIVALSと攻撃情報を維持
- 760px未満のみ縦レイアウトへ切替
- 通常PCプレイ中はページ全体の縦スクロールを禁止

## V0.18 Outgoing Target Emphasis
- 攻撃した側の中央通知を、相手プレイヤー名が最優先で目に入る表示へ変更
- `攻撃成功！ / ○○ へ攻撃 / 邪魔ブロック N列を送信`
- 右側の攻撃履歴も `○○ へ攻撃 / 邪魔ブロック N列` に統一
- 通知表示時間を1.65秒へ少し延長

## V0.19 Emergency Reset Definitive Fix
- 原因を特定: playersのRealtime handlerが `row.id===自分` を先にreturnしていたため、自分自身のDELETEイベントを無視していた
- EMERGENCY RESETで自分のplayers rowがDELETEされたら、その瞬間にPLAYER ENTRYへ強制復帰
- さらに1秒ごとに「自分のplayers rowがDBに存在するか」を確認するSelf Healを追加
- NEXT BATTLEはplayers rowを残すため復帰しない
- EMERGENCY RESETだけ確実にENTRYへ戻る

## V0.20 Server Clock / Background Catch-up
- 最小化・バックグラウンド中もゲーム時間を停止しない
- Tetris tickを1フレーム1段方式から、経過時間分を追いつくCatch-up方式へ変更
- 復帰時に最小化中に本来起きていた落下・接地・ロック・次ミノまでまとめて現在時刻へ追いつく
- 数分最小化していた場合、盤面状況によっては復帰時点ですでにK.O.になる
- HOST / PLAYER / PROJECTORの時刻基準をSupabase `server_now_ms()` に統一
- 30秒ごと・復帰時にServer Clockを再同期
- visibilitychange / focus / pageshowで復帰を検知
- 復帰時にDBからPENDING攻撃を再取得し、Realtime取りこぼしをSelf Heal
- 邪魔ブロックの残量・残りターンをattacksテーブルへ同期
- 完全相殺はCANCELLED、着弾はLANDEDとしてDBに記録
- Realtime = 速報 / DB = 真実 / Server Clock = 時間の真実

### V0.20で追加SQL
GitHub反映前後どちらでもよいので、Supabase SQL Editorで
`supabase_v020_server_clock.sql`
を1回だけ実行してください。
