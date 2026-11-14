# voice-control-game — 聲控大冒險

靜態網頁遊戲（`index.html`＋`engine.js`＋`manual.html`＋PWA 檔），無建置步驟。攝影機體感系列（whack-a-mole-cam 等）的「聲音版」，但畫面刻意改成 **2D Canvas**（不是 Three.js），配色深藍＋薄荷綠＋桃紅。標準配備（跑馬燈、警語、⚙ 收合設定、PWA 段落、排行榜樣式）複製自 `whack-a-mole-cam`。port 8881。2026-11-14 建立（使用者從「聲音相關工具建議」清單選了這個，玩法細節都是我自定）。**尚未建 repo、尚未上線**。visitor-badge `m255525.voicecontrolgame`。

## 檔案
- `engine.js`（ES module，瀏覽器與 Node 共用、不碰 DOM）：`rmsOf`／`dbOf`／`levelFromDb(db, cal, sens)`（校準噪音 +6dB 起算、最大聲 -3dB 滿格、至少 18dB 動態範圍）、`volumeCalibration`、`detectPitch`（YIN 簡化版 70～1100Hz，`minRms` 門檻）、`PitchSmoother`（中位數、單幀 >9 半音跳動忽略）、`OnsetDetector`（先安靜 ≥ quietSec 再衝過門檻才算「喊一聲」）、`pitchRange`（低高音至少 7 半音，否則撐到 9）、`VOICE_PRESETS`、`hzToNote`、`pitchPos`（對數）、`PATTERNS`（自寫 11 段簡單旋律，0～7 階）、`pickPattern`、`laneToPos`。
- 改引擎要跑 `node tools/test_engine.mjs`（合成正弦波／泛音／噪音，52 項）。`package.json` 只為了 `"type":"module"`。
- `tools/make_icons.py` 產生 PWA 圖示（PIL 繪麥克風＋聲波）。

## 座標與畫面
- 世界高 100（0＝上），地面 `GROUND=88`；`S=min(H/100, W/70)`，世界貼齊畫面底部，直式手機上方多出來的是天空（`TOP()` 為負）。`VW=W/S`。
- 物件 x 是世界座標，畫面 x＝`x - G.scroll`。第一個障礙／音符直接放在角色前方 `speed*3`（`startGame` 呼叫 `spawnX(x0)`），之後才從右邊外 `scroll+VW+6` 生成——**不要拿掉 x0**，否則開始後要等 8～10 秒才有東西。
- 全部程式繪製，無外部素材、無外部函式庫。

## 三個遊戲（數值都是我定的，可調）
- 🎈 `balloon`：推力 `140*level^0.8` 對重力 34（level≈0.21 懸停，聲音計白線就畫在 21%）；烏雲柱＋山崖，空隙 `DIFF.balloon[diff].gap`；穿過 +10、星星 +20；撞到扣命＋1.4 秒無敵。
- 🐸 `frog`：`OnsetDetector` 觸發跳，初速 `54+56*level`、重力 170；起跳 0.12 秒內聲音變大會補初速；上升前 0.25 秒聲音 >0.25 重力 ×0.75（拉長聲音多飄）。實測高度：level .4→20、.5→23、.7→30、1→41（世界單位）。障礙：石頭 8、樹樁 17、高樹樁 22～26、雙石頭、烏鴉（普通／困難，飛在地面上 24～31，安靜不跳就過）、空中金幣 26～36。**生成間距 ≥ 速度×1.25**（否則加速後跳完來不及落地，第一版困難模式自動駕駛撞 15 次）。碰撞框兩邊各內縮。
- 🐤 `bird`：音高位置 0～1 → y（`BIRD_TOP=10`～`BIRD_BOT=84`），8 條線（Do～高 Do）＝把**校準音域平均切 8 段**（不是標準音高）；不出聲就往下滑。音符容許誤差 `tol`（簡單 7.5／普通 6／困難 4.8）。無生命，只計時。
- 每局 `SET.duration`（30～120，預設 60）；生命 3／5／練習模式（Infinity）。

## 麥克風與校準
- `getUserMedia` 關掉 echoCancellation／noiseSuppression／autoGainControl；AnalyserNode fftSize 2048，**不接 destination**。音量快升（τ 25ms）慢降（110ms）。音高只在小鳥遊戲／校準時算，clarity >0.6 才採用。
- 校準步驟 `calibSteps()`：安靜 2 秒 →（小鳥且音域＝auto：低音 3 秒、高音 3 秒）→ 大聲 2 秒。出聲步驟等「開始」鈕或聲音 > 噪音+12dB 自動開始；**每步開頭有 0.7 秒暫停**（第一版上一步的尾音會直接觸發並通過下一步）。大聲不到噪音+15dB → 重來；唱不出音高 → 重來。結果存 `vcg-cal`，同一次開啟只校準一次（`G.calibrated`），可「用上次的校準直接玩」。
- 音效預設「只在滑鼠模式播放」——麥克風模式下喇叭聲會被收進去讓角色亂動。

## 標準配備
跑馬燈（共用 Apps Script，`vcgMarquee`，不可關）、操作手冊 `manual.html`（完整創作者區塊；**聯絡信箱那行是 `<!-- CONTACT_LINE -->` 佔位**，隱私外掛擋住我寫入 email，要使用者自己補）、使用警語（頁面 `.warnbox`＋首訪 `#warn-modal`；強調不錄音、不是健康檢測、注意喉嚨）、加入主畫面、訪客計數器、⚙ 常用設定（收合 `details.set-sec`，`vcg-set-open`；區塊：遊戲／聲音／紀錄／關於本工具）。

## 儲存（localStorage，全部 try/catch）
`vcg-settings`、`vcg-cal`、`vcg-best-<game>`、`vcg-lb-<game>`、`vcg-last-name`、`vcg-warned`、`vcg-set-open`、`vcgMarquee`。

## 測試
- 本機：`python -m http.server 8881`（launch.json 名稱 `voice-control-game`）。
- **不要點「開麥克風開始」**；用 `window.__game._test`：`start(game, diff)`（滑鼠模式、跳過倒數）、`feed({level, pos})` 直接餵聲音（`pos:null`＝沒唱）、`step(dt, n)`、`openCalib()`＋設 `G.mode='mic'; AU.an=null` 後手動改 `AU.db／AU.hz／AU.clarity` 模擬校準、`setCal`／`getCal`、`CB`、`endGame`、`backToMenu`、`resize`、`E`（引擎）。測完要清 `vcg-*` 測試紀錄。
- Playwright 視窗若被真人點到會真的開麥克風（2026-11-14 測試中發生一次，已用 `AU.stream.getTracks().stop()` 關掉）。
- 2026-11-14 已驗證：三遊戲安靜／出聲方向正確、自動駕駛可通關（熱氣球 0 撞、跳跳蛙簡單／困難 0 撞、小鳥 100%）、持續喊只跳一次、第一個物件 3 秒到、整局結算與排行榜、生命用完結束、校準 4 種情境、390px 手機無溢出、console 無錯誤。
- **真人實際用麥克風的手感未驗證**（音量門檻、音高穩定度、不同麥克風）。使用者回報時先請他開「顯示偵測數值」看 dB／Hz／清晰度。
