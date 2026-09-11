# realtime-whiteboard

複数人でリアルタイムに共有できるお絵描きホワイトボード。

- `client/` — React + Vite のフロントエンド（Canvas 描画 / perfect-freehand）
- `server/` — Node.js + Express + socket.io のリアルタイム配信サーバー

## 起動方法

ターミナルを 2 つ開いて、それぞれで実行します。

```bash
# 1) サーバー (http://localhost:3001)
cd server
npm install
npm run dev

# 2) クライアント (http://localhost:5173)
cd client
npm install
npm run dev
```

ブラウザで http://localhost:5173 を開きます。`?room=` が無い場合はルーム ID が
自動生成され、URL に書き戻されます。同じ URL を別のタブ / 別のブラウザで開くと、
描画がリアルタイムに同期します。

- ルームを指定する: `http://localhost:5173/?room=team-a`
- サーバーの接続先を変える: `client/.env` に `VITE_SERVER_URL=http://<host>:3001`
  （`client/.env.example` を参照）
- サーバーの状態確認: `http://localhost:3001/health`

## 使える機能

| ツール | 操作 |
|---|---|
| ペン | ドラッグで描画。色と太さを変更できます |
| 消しゴム | ドラッグでなぞった部分を消します（誰が描いた線でも消えます） |
| 文字 | クリックした位置に入力欄が出ます。Enter で確定、Esc で取り消し |
| 文字の移動 | 文字ツールのまま、置いた文字をドラッグすると好きな位置へ動かせます（カーソルが ✥ に変わります） |
| 戻る / やり直す | `Ctrl+Z` / `Ctrl+Shift+Z`。**自分が行った操作**（追加・移動）だけを 1 つずつ取り消します |
| 全消去 | ルーム全員の描画をすべて消します |

戻る操作が自分の分だけを対象にするのは、共同編集中に他の人の描いたものが
勝手に消えないようにするためです。

## 実装状況

- [x] 1. Canvas へのフリーハンド描画（色・太さのツールバー）
- [x] 2. socket.io によるルーム単位のリアルタイム同期
- [x] 3a. undo / redo、消しゴム、文字入力
- [ ] 3b. 図形描画（四角・丸・矢印）
- [ ] 4. 参加者カーソルのリアルタイム共有
- [ ] 5. PNG / SVG エクスポート

## 通信イベント

| イベント | 方向 | 内容 |
|---|---|---|
| `board:init` | server → client | 入室時にルームの描画履歴を配信 |
| `room:peers` | server → client | ルームの参加人数 |
| `stroke:start` | client → server → client | 描き始め（線の色・太さ・始点） |
| `stroke:points` | client → server → client | 描画中の点を逐次追加（フレームごと） |
| `stroke:end` | client → server | 描き終わり。`item:add` として配信される |
| `stroke:cancel` | server → client | 描画途中で切断した参加者の線を破棄 |
| `item:add` | 双方向 | 確定した要素（線 / 文字）を履歴に追加 |
| `item:move` | 双方向 | 文字の位置を更新（ドラッグ中もフレームごとに配信） |
| `item:remove` | 双方向 | 要素を 1 つ取り消す（戻る操作） |
| `board:clear` | 双方向 | ルームの全消去 |

履歴は「線」と「文字」を同じ 1 本の配列（`items`）として順番どおりに保持します。
消しゴムは `erase: true` の線として同じ配列に入り、描画時に
`globalCompositeOperation = 'destination-out'` で下の描画を削ります。
これにより、消しゴム自体も「戻る」で取り消せます。

「戻る」は自分の操作を並べたアクション列（`{type: 'add'}` / `{type: 'move'}`）を
さかのぼる方式なので、文字の移動も 1 手として取り消せます。
