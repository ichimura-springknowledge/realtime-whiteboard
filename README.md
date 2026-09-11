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

## 実装状況

- [x] 1. Canvas へのフリーハンド描画（色・太さのツールバー）
- [x] 2. socket.io によるルーム単位のリアルタイム同期
- [ ] 3. undo / redo、消しゴム、図形描画（四角・丸・矢印）
- [ ] 4. 参加者カーソルのリアルタイム共有
- [ ] 5. PNG / SVG エクスポート

## 通信イベント

| イベント | 方向 | 内容 |
|---|---|---|
| `board:init` | server → client | 入室時にルームの描画履歴を配信 |
| `room:peers` | server → client | ルームの参加人数 |
| `stroke:start` | 双方向 | 描き始め（線の色・太さ・始点） |
| `stroke:points` | 双方向 | 描画中の点を逐次追加（フレームごと） |
| `stroke:end` | 双方向 | 描き終わり。履歴に確定される |
| `stroke:cancel` | server → client | 描画途中で切断した参加者の線を破棄 |
| `board:clear` | 双方向 | ルームの全消去 |
