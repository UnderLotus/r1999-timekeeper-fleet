# 遊戲資料更新

網站執行期只讀 repo 內建的 catalog 與圖片，不從瀏覽器呼叫外部遊戲資料或 Wiki API。

## 指令入口

完整同步角色、心相、名稱、排序、實裝狀態與圖片：

```bash
npm run sync
```

流程依序執行：Global／CN 解包同步 → 第三方名稱與排序 → UTTU 補給 → 合成 `catalog-source.json` → 安裝圖片 → 重建 runtime catalog。

- Huiji 抓取使用 `curl_cffi`，首次執行前先建立環境：`python3 -m venv .venv && .venv/bin/pip install -r requirements-huiji.txt`。
- 離線重建網站資料：`npm run build:characters`、`npm run build:psychubes`（不連網，以本機資料與已安裝圖片重建）。

個別入口：

| 指令 | 用途 |
| --- | --- |
| `npm run build:names` | 刷新第三方與 UTTU 譯名並重建角色／心相 catalog（不處理圖片與補給收錄） |
| `npm run sync:uttu-names` | 僅刷新 UTTU 譯名快照 |
| `npm run sync:uttu` | 刷新譯名、準備補給 metadata 並驗圖（單獨執行不提交收錄） |
| `npm run sync:cn` / `sync:gl` | 刷新 CN／Global 原始解包資料 |
| `npm run sync:names` / `sync:order` | 刷新第三方名稱／角色排序 |
| `npm run build:source` | 離線合成 `catalog-source.json`（單獨執行只讀已收錄的補給快照，不讀殘留 candidate） |

## 資料來源與檔案

| 來源 | 提供內容 |
| --- | --- |
| St-Pavlov [`re1999-data`](https://github.com/St-Pavlov-Foundation/re1999-data) | CN 角色、衣著、心相解包資料 |
| [`re1999-data-global`](https://github.com/St-Pavlov-Foundation/re1999-data-global) | Global 實裝狀態與多語系名稱 |
| [`Reverse-1999-CN-Asset`](https://github.com/myssal/Reverse-1999-CN-Asset) | 原始 `ArcanistMap` 與角色／心相原始 PNG |
| [UTTU](https://uttu.merui.net) | 對照落後時的角色／衣著補給、缺圖與譯名（非官方社群資料庫，部分為暫譯；素材版權屬 Bluepoch Co., Ltd.／深藍互動） |
| Huiji / Kornblume / wikiru / Fandom | 角色順序（Huiji 為主、Kornblume 補缺）與缺漏名稱 fallback |

目錄結構（皆位於 `scripts/data/`）：

- **不提交的原始 cache**：`cn/`、`gl/`
- **可提交的可重建輸入**：
  - `catalog-source.json`：精簡角色與心相快照
  - `uttu-supplement.json`、`uttu-image-cache/`：已收錄 UTTU 補給與驗證圖片
  - `uttu-names.json`：獨立 UTTU 譯名快照
  - `psychube-image-cache/`、`psychube-image-inventory.json`：已驗證心相 PNG 與來源／hash 清單（有圖無名亦保留）

## Catalog 收錄規則

- **Variant 與類型**：Variant ID 為不透明識別碼，擁有者來自 `ArcanistMap.live2d` 或已收錄補給。primary Variant 類型優先看 `des`（初始／進階），其次比對 `${baseId}01`／`${baseId}02`，其餘為 `skin`。每個角色必有唯一 `default` 且 `defaultVariant` 指向它。
- **未映射 CN 衣著**：以 CN `skin.json` 的 `characterId` 歸屬，未出現在有效對照者輸出提醒並暫存於 `/tmp/r1999-team-list-sync/`，由 `npm run sync` 結尾彙整。`catalog-policy.json` 的 `ignoredCnSkinStubs` 記錄確認的空殼佔位；若佔位消失或轉為真實衣著，build 會中止以待人工檢視。
- **心相**：取 CN／Global `equip.json` 合法 ID，排除升階素材與測試資料。需同時具備可信簡中名稱與已驗證圖片才會進入網站 catalog；名稱與圖片各自獨立保存。

### UTTU 補給

- 原始 `ArcanistMap` 保持唯讀，補給另存。僅解析 `profiles/`、`garments/` 字面量，不執行站方 JavaScript。
- 既有角色僅收錄真實 `skin`；新角色須具備完整 metadata、唯一 `default` 及全部預計圖片。已收錄補給角色的後續衣著併入原角色條目。
- primary 已擁有的同擁有者 exact ID（且本輪開始非由補給管理）直接去重。補給在本輪交還 primary 時仍核對 refreshed type；跨擁有者、type／default／insight 衝突或 UTTU 內部重複列矛盾均直接中止。
- 角色星級僅在 CN／Global 缺席時由 UTTU 補上，換算為 `rare = 星級 − 1`（心相不套用）。UTTU 的 `global`／版本欄位不參與實裝判定。
- **暫存與提交**：`npm run sync` 在 lock 內於 `scripts/data/` 建立本輪專屬 candidate。安裝前核對其 hash 與 `catalog-source.json` 一致，且所有預計 Variant 皆在 staged 集合內；圖片安裝成功後才以 atomic rename 寫為 `uttu-supplement.json`。安裝或更名失敗皆保留舊快照，多出的已驗證圖片待下輪收斂；獨立執行 `sync-assets` 不會提交殘留 candidate。

## 多語系譯名

`uttu-names.json` 分為角色（`baseId`）與心相（`id`）兩區，僅供應 `zh-TW`、`ja-JP`、`ko-KR` 查表：

- 角色取 `profiles/` 的 `LocaleName`（不要求星數、簡中名、衣著或圖片完整）。
- 心相取 `psychubes/` 五語 `name` 陣列（`en, CN, TW, JP, KR`），嚴格以 `id` 配對。
- 兩區獨立刷新並保留 last known good（LKG）；空白或 `N/A` 不覆蓋既有譯名；衣著與圖片收錄成敗不阻擋譯名更新。
- 整檔 atomic rename、依 ID 穩定排序、不寫時間戳，相同輸入產出位元一致。

單一語系先 trim 並排除空白與佔位值（如 `N/A`），依序取第一個有效值：

1. 當前 raw Global 該語系名稱，無則用手動 override
2. 既有第三方有效譯名
3. previous row 的同語系 LKG
4. UTTU 譯名
5. 既有補給值

各語系僅取同語系來源；無可信值時省略 key，由前端顯示時依「目標語系 → 英文 → 簡中 → ID」回退。與同列英文／簡中同名仍視為有效值保留，正常 build 不以字面相似度批次刪除歷史譯名。

## 實裝狀態判定

- **角色**：依 Global `character.json` 的 `isOnline`：`1` 已實裝；`0`／空值／缺席未實裝；`YYYY-MM-DD HH:mm:ss` 以 English Global server time（UTC−05:00）轉 UTC，早於 build clock 為已實裝；其餘格式報錯。
- **衣著**：`default`／`insight` 隨角色判定；`skin` 依 Global `skin.json` 是否存在該 ID。
- **心相**：依 Global `equip.json` 是否存在該 ID，與圖片快取獨立。
- **手動例外**：`released-overrides.json` 永遠優先；重複、格式錯誤或指向不存在 ID 會使 build 失敗；sync 不自動改寫該檔。

## 角色順序

排序依序為 **CN-only → Kornblume → Huiji**。Huiji 直接請求並重試一次，回傳少於 100 名已知角色視為上游失敗並保留原快照；有效更新將最新 Huiji 名單置前，上次名單中暫時缺席者接於尾端。Kornblume 僅補 Huiji 未涵蓋的角色。

## 圖片管線

正式圖片為 lossless WebP，輸出於 `public/assets/characters/` 與 `public/assets/psychubes/`。

- **角色頭像**
  - primary：`singlebg/headicon_small/{variantId}.png`（依 catalog exact ID 取得）。
  - PNG 缺席時順序：保留既有的可信 WebP → 讀取已驗證 UTTU cache（來源 `https://assets.merui.net/headicon_small/{variantId}.webp`，須完整解碼、136–144px 正方形、lossless、非全透明，允許無 alpha 不透明圖）。
  - 缺圖處置：發出警告並繼續更新。衣著缺圖僅暫不進入 runtime；`default`／`insight` 缺圖則整名角色暫不進 runtime，保留 source 與已驗證圖片待補齊後自動收錄。若上游 Git tree 已有該檔但本機 checkout 缺失，視為錯誤中止。
- **心相圖示**
  - primary：`singlebg/equip_defaulticon/{id}.png`（276×228），獨立掃描並驗證快取。
  - 合法 catalog ID 缺圖時向 `https://assets.merui.net/equip_defaulticon/{id}.webp` 補齊，無損解碼為 PNG 納入 inventory 並記錄實際來源 URL。
- **驗證與快取**：遠端圖片若為 HTML、lossy、尺寸不符或全透明，視為 unavailable 並保留既有資產；本機 I/O 失敗直接中止。未變更來源重用 hash cache，新產出檢查格式、尺寸與可見像素。
- **人工保留例外**：`312503`「野樹莓／踏影歌」於 `catalog-policy.json` 指定保留人工圖（CN 上游仍為舊劇情表情）；下次新增野樹莓衣著時重檢，確認上游改為正確方形圖後再移除。

## 鎖定、失敗與復原

- 全流程共用 `/tmp/r1999-team-list-sync.lock`，維持單一 writer。
- 上游抓取、格式或完整度檢查失敗時沿用已驗證快照；僅在缺乏可用快照時中止。
- 單一角色 candidate 結構或 `default` 無效時，保留上一版完整列（新角色則略過），明確 policy 排除不會復活，其餘角色與心相繼續更新。
- 本機 cache 損毀、I/O 失敗、人工設定錯誤、domain 衝突或程式／build 錯誤一律直接中止，修正後重跑原入口。
