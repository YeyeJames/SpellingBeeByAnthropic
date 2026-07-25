# 🐝 拼字蜂 Spelling Bee

給小學生的英語聽寫練習遊戲網頁。聽音檔、輸入拼字，答對賺金幣、解鎖造型與小遊戲！

## 技術架構

- 前端：純 static HTML + vanilla JS（`/public`），無 build 工具
- 後端：Node.js + Express（`/server`）
- 資料庫：MongoDB（建議 MongoDB Atlas 免費 M0）
- 部署：Render（免費方案）

詳細架構規劃請見 `/root/.claude/plans/spellingbee-repo-git-render-mongodb-async-wave.md`（開發階段用）。

## 本機開發設定

1. 安裝相依套件：
   ```bash
   npm install
   ```
2. 複製環境變數範例並填入你的 MongoDB 連線字串：
   ```bash
   cp .env.example .env
   # 編輯 .env，填入 MONGODB_URI（MongoDB Atlas 連線字串）與一組 SESSION_SECRET
   ```
3. 啟動伺服器：
   ```bash
   npm start
   # 或開發時自動重啟：npm run dev
   ```
4. 瀏覽器開啟 http://localhost:3000

## 目前進度

- [x] Phase 1：專案骨架、資料庫連線、暱稱+PIN 登入系統、運動風主題 CSS 基礎
- [ ] Phase 2：單字庫 CRUD
- [ ] Phase 3：美術與音效素材
- [ ] Phase 4：聽寫練習核心流程（Phaser 整合）
- [ ] Phase 5：真人錄音（GridFS）
- [ ] Phase 6：金幣、商店、造型
- [ ] Phase 7：遊戲感官打磨
- [ ] Phase 8：部署到 Render + MongoDB Atlas

## 帳號系統說明

暱稱 + 4 位數 PIN 登入，家長與小孩使用同一種登入方式，沒有角色權限分層——任何登入的玩家都能新增/編輯單字庫。這是刻意的簡化設計，適合不對外公開的家庭內部使用。
