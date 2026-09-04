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
5. （選用）建立幾個初始商店品項（造型、主題、小遊戲解鎖）：
   ```bash
   npm run seed
   ```

## 目前進度

- [x] Phase 1：專案骨架、資料庫連線、暱稱+PIN 登入系統、運動風主題 CSS 基礎
- [x] Phase 2：單字庫（100 字競賽單字庫，寫死在程式碼中，唯讀）
- [x] Phase 3：美術與音效素材
- [x] Phase 4：聽寫練習核心流程（Phaser 整合）
- [x] Phase 5：真人錄音（GridFS）
- [x] Phase 6：金幣、商店、造型
- [x] Phase 7：遊戲感官打磨
- [ ] Phase 8：部署到 Render + MongoDB Atlas（程式碼已就緒，需要你自己的帳號才能實際部署，見下方步驟）

## 單字庫說明

競賽用的 100 個單字（Spelling Bee Grade 3A，Part 1~4 各 25 字）寫死在
`server/data/word-bank.js`，不存資料庫、也沒有網頁新增介面。要增修單字就直接改那個檔案
再重新部署。

- 每個單字包含英文、中文翻譯、適合小學生的英文例句，以及所屬 Part
- `id` 欄位一旦定下就不要更動：使用者的答題進度是靠它對應的，改了會讓進度對不上
- 資料庫只保存會變動的部分：每個單字的真人錄音，以及每位使用者的作答進度

練習時選擇一個 Part（25 字），並可選擇「照順序」或「隨機」出題。

## 帳號系統說明

暱稱 + 4 位數 PIN 登入，家長與小孩使用同一種登入方式，沒有角色權限分層。這是刻意的簡化設計，適合不對外公開的家庭內部使用。

## 美術與音效素材說明

開發這個專案的 sandbox 環境無法連上外部網站（Kenney.nl、Mixkit 等免費素材站、圖片生成服務都連不到），所以美術與音效改用完全自主生成的替代方案，不影響功能也沒有授權問題：

- **美術**：吉祥物「拼字蜂」與所有圖示、造型配件都是手繪的 SVG（`/public/assets`），可直接編輯或替換成你喜歡的圖片
- **音效與背景音樂**：全部用 Web Audio API 即時合成（`/public/js/sound-manager.js`），不需要任何音檔
- **遊戲引擎**：練習畫面與小遊戲用 Phaser 4（vendored 在 `/public/vendor/phaser.min.js`，MIT 授權）

之後如果想換成正式外包的美術或錄製的音樂，只要把檔案放進 `/public/assets` 對應資料夾，並更新程式碼裡的路徑即可，架構上不需要大改。

## 部署到 Render + MongoDB Atlas

### 1. 建立 MongoDB Atlas 免費叢集
1. 到 [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) 註冊帳號，建立一個免費的 M0 叢集
2. 「Database Access」新增一組資料庫使用者帳密
3. 「Network Access」新增 `0.0.0.0/0`（允許所有 IP）——因為 Render 免費方案沒有固定對外 IP
4. 「Connect」取得連線字串（`mongodb+srv://...`），記得把 `<password>` 換成實際密碼，並在資料庫名稱處填 `spellingbee`

### 2. 部署到 Render
1. 到 [Render](https://render.com) 用你的 GitHub 帳號登入，新增一個 Web Service，選這個 repo
2. Render 會讀到 repo 裡的 `render.yaml` 自動帶入設定（免費方案、`npm install` / `npm start`）
3. 在 Render 的環境變數頁面設定：
   - `MONGODB_URI`：上面拿到的 Atlas 連線字串
   - `SESSION_SECRET`：隨便一組夠長的隨機字串（例如用 `openssl rand -hex 32` 產生）
4. 部署完成後，第一次連線可能要等約 1 分鐘喚醒（免費方案閒置會休眠），之後就正常
5. 部署成功後，記得執行一次 `npm run seed`（在你的本機，指向同一組 `MONGODB_URI`）建立商店的初始品項

### 出問題時怎麼查

直接用瀏覽器打開 `你的網址/api/health`，會看到一段文字說明伺服器與資料庫狀態，例如：

```json
{ "server": "ok", "database": "connected", "userCount": 2 }
```

- `database` 是 `connected` → 資料庫正常
- `database` 是 `disconnected` → 看 `databaseError` 欄位的訊息（例如帳密錯誤、IP 沒開放）
- `hasMongoUri` / `hasSessionSecret` 是 `false` → Render 的環境變數沒設好
- `buildId` → 目前線上跑的版本（Render 會帶入 commit SHA）。畫面看起來沒更新時，
  先比對這個值與 GitHub 上最新的 commit，就能分辨是「還沒部署完」還是「真的有 bug」
- `startedAt` → 這次部署的啟動時間

網頁本身若載入失敗，畫面最上方會直接顯示紅色錯誤橫幅說明原因，不會再變成一片空白。

## 資料同步方式（本地優先）

為了讓操作即時反應，畫面一律先用本地資料（localStorage）呈現，變更寫入待同步佇列後由背景送到伺服器：

- **讀取**：單字庫、商店品項都有本地快取，重複造訪時立刻顯示，再到背景更新
- **搜尋與 Part 篩選**：完全在本地進行，打字即時反應，不會發任何請求
- **練習作答**：在本地判定對錯並立刻顯示答案與金幣，作答紀錄由背景補送
- **同步狀態**：導覽列右上角顯示 ✅（已全部同步）或 📤／⏳（尚有幾筆待送出）

安全性設計：

- 每筆同步操作都帶唯一的 `opId`，伺服器據此去重。背景同步一定會重試，沒有這層保護金幣會被重複計算
- 伺服器是最終權威：對錯、金幣、統計都由伺服器重新計算，本地只是先行預測。若不一致（例如同一帳號在兩台裝置上練習），以伺服器為準
- 購買若被伺服器拒絕（金幣不足），本地的樂觀扣款會自動退回並顯示原因
- 錄音檔是二進位且體積大，不走佇列，需要連線才能上傳

### 已知限制
- Render 免費方案閒置一段時間會進入休眠，重新喚醒約需 1 分鐘；期間網頁會顯示「正在喚醒伺服器…」並自動重試，不會靜默卡住
- 為了避免資料庫短暫斷線就讓整個服務掛掉（會造成沒有樣式的空白頁），伺服器會攔截未處理的例外並繼續運作。代價是嚴重錯誤不會讓 process 重啟，需要自己看 Render 的 Logs
- MongoDB Atlas M0 總容量只有 512MB，真人錄音檔案與作答紀錄都會佔用空間，錄音已限制在約 5 秒/500KB 內
- 4 位數 PIN 沒有忘記密碼救援機制，也沒有登入失敗鎖定介面提示（後端有速率限制），適合家庭內部使用，不建議公開對外
