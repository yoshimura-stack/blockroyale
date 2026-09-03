# BLOCK ROYALE — Phase 1 Starter

## 今回盛り込んだ仕様
- 王道7テトリミノ: I / O / T / S / Z / J / L
- 7-bag
- NEXT 1個 / HOLDなし
- A/D 左右移動
- ←/→ 左右回転
- S/↓ Hard Drop
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
