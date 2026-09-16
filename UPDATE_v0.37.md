# BLOCK ROYALE v0.37 — CLEAN ARENA

背景に二重表示されていた情報パネル・NEXTミノ・盤面・文字を、背景素材から除去しました。実際のPLAYERのUIだけが表示されます。

## 導入

v0.36のリセット修正が動作している環境では追加SQLは不要です。このZIPを解凍し、中身をリポジトリ直下へ上書きしてCloudflareに反映してください。新しい `assets/arena-clean-v037.png` も含めてアップロードしてください。

反映後にPLAYERを再読み込みしてください。古い見た目が残る場合はPLAYERでCtrl+F5を実行してください。HOSTのF5はv0.36同様に部屋のリセットを実行します。

## 内容

- 元背景の青・金のスタジアム、観客席、星空、床リングを残した背景専用画像へ変更。
- 旧パネルを隠すための132%拡大をやめ、画面を覆う通常の背景表示へ変更。
- デスクトップの左右パネルを中央寄りに配置し、高さを抑えて背景の見える範囲を確保。
- ミニ盤面をカード内へ収め、中央のタイトルの折り返しを調整。
- v0.36のJavaScript・SQL・ゲームルールはすべて変更なし。

1453×692、1366×768、1920×1080のブラウザ表示で、背景参照・横はみ出し・中央盤面の下端・ミニ盤面の収まりを確認しました。オンライン参加や本番DB更新は実行していません。

旧 `arena-reference.png` は履歴素材として同梱していますが、現在のCSSからは参照していません。

## 背景素材の制作記録

内蔵image_genの画像編集機能で元背景を編集しました。保存先：`assets/arena-clean-v037.png`。

使用プロンプト：

> Use case: precise-object-edit. Edit target: supplied image. Asset type: actual background texture for a playable videogame, NOT a UI screenshot. Remove ALL foreground user interface from this image: remove both huge glass side panels and every card, all HUD statistics at upper right, entire central black Tetris board and its frame, falling blocks, entry form and buttons. Remove ALL writing, logos, numbers, lettering on banners, header, footer, pedestal and central overhead cylinder. Inpaint these areas as uninterrupted futuristic stadium environment. Preserve the original blue/cyan and gold luminous stadium architecture, overhead curved mechanical rings, space sky and planet, audience stands, side lighting towers, reflective dark floor, and concentric low circular floor platform at center bottom. Keep the same wide landscape composition, camera viewpoint, rich bright blue/gold contrast and realistic cinematic style. Center should be open air above the floor platform, showing distant arena stands; no vertical rectangular structures resembling a game board or screen. Left and right must be exposed arena architecture and crowd, never panels or empty glass rectangles. Absolutely no interface, no Tetris blocks, no grids resembling game board, no text anywhere. Produce one clean background-only image with the original wide landscape aspect ratio.
