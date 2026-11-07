# 遊戲資料更新

網站執行時只讀 repo 內建好的 catalog 和圖片，不會從瀏覽器呼叫遊戲資料或 Wiki API。

## 更新與重建

完整更新角色、心相、名稱、排序、實裝狀態與圖片：

```bash
npm run sync
```

流程依序更新 Global／CN、第三方名稱與排序、UTTU 補給，再合成 source、安裝圖片並重建 runtime catalog。Huiji 使用 `curl_cffi`；首次使用先執行 `python3 -m venv .venv && .venv/bin/pip install -r requirements-huiji.txt`。可恢復的上游失敗沿用可信快照，其餘錯誤會停止流程，詳見「失敗與復原」。

個別入口：

- `npm run build:names`：刷新第三方與 UTTU 名稱，重建角色與心相 runtime catalog，不觸發圖片或補給收錄。
- `npm run sync:uttu-names`：只刷新 UTTU 譯名快照。
- `npm run sync:uttu`：刷新譯名、準備補給 metadata 並驗圖；單獨執行不完成角色／衣著收錄。
- `npm run sync:cn`／`sync:gl`、`sync:names`、`sync:order`：分別刷新解包資料、第三方名稱與角色排序。
- `npm run build:source`：從已保存的來源整理可提交的精簡快照，不連網；獨立執行只讀已收錄補給，不讀殘留 candidate。

從保存的 source 與心相圖片 inventory 離線重建網站資料：

```bash
npm run build:characters
npm run build:psychubes
```

## 資料來源與保存

- St-Pavlov [`re1999-data`](https://github.com/St-Pavlov-Foundation/re1999-data)：CN 角色、衣著與心相解包資料。
- [`re1999-data-global`](https://github.com/St-Pavlov-Foundation/re1999-data-global)：Global 實裝狀態與各語系名稱。
- [`Reverse-1999-CN-Asset`](https://github.com/myssal/Reverse-1999-CN-Asset)：原始 `ArcanistMap` 角色對照與圖片。
- [UTTU](https://uttu.merui.net)：對照落後時的角色／衣著補給、缺圖，以及已收錄角色／心相的譯名。它是非官方社群資料庫，部分翻譯為暫譯；遊戲素材版權仍屬 Bluepoch Co., Ltd.（深藍互動）。
- Huiji：角色順序；Kornblume、wikiru／Fandom 補 Global 缺少的名稱或排序。

`scripts/data/cn/`、`scripts/data/gl/` 是不提交的原始 cache。可重建的輸入另行提交：

- `catalog-source.json`：精簡角色與心相資料。
- `uttu-supplement.json`／`uttu-image-cache/`：已收錄的 UTTU 補給與驗證圖片。
- `uttu-names.json`：獨立的 UTTU 譯名快照。
- `psychube-image-cache/`／`psychube-image-inventory.json`：已驗證心相 PNG 與來源／hash 清單；有圖無名稱時也保留。

以上路徑皆位於 `scripts/data/`。

## Catalog 收錄

Variant ID 是完整且不透明的識別碼，擁有者來自 `ArcanistMap.live2d` 或已收錄 Supplement，不從位數或前綴猜測。primary Variant 類型先看初始／進階 `des`，再相容精確的 `${baseId}01`／`${baseId}02`，其餘視為衣著。每個角色必須恰有一個 default，且 `defaultVariant` 指向它。

CN `skin.json` 與有效對照中未匹配的衣著只會輸出提醒，清單暫存於 `/tmp/r1999-team-list-sync/` 並由完整 sync 彙整。CN 擁有者診斷使用 `characterId`，不切 ID。`catalog-policy.json` 的 `ignoredCnSkinStubs` 保存已確認的空殼佔位；它們消失或變成真實衣著時，build 會要求人工重新審視。

心相以 CN／Global `equip.json` 合法 ID 為範圍，排除素材與測試資料。只有可信簡中名稱與有效圖片齊全才進網站 catalog；名稱與圖片各自保存，來源缺席或欄位退化不會清空另一邊。

### UTTU 補給

- 保留 myssal 原始 `ArcanistMap`；補給另存，不改寫 raw mapping。只解析 `profiles/`、`garments/` 的字面量資料，不執行站方 JavaScript。
- 既有角色只加真正的 `skin`，不加 default／insight 佔位。新角色須有完整 metadata、唯一 default 及全部預計圖片才收錄；已收錄補給角色的後續衣著併入同一角色。
- primary 已擁有、同擁有者且本輪開始不屬於補給的 exact ID 直接去重，不重分類。補給在本輪交還 primary 時仍核對 refreshed type；跨擁有者、補給 owner／type 或 default／insight 矛盾、UTTU 內部重複列矛盾都會中止。
- UTTU 角色星級只在可信 CN／Global 值缺席時補上，換成 catalog `rare = 星級 − 1`；心相不套此換算。UTTU 的 `global`／版本欄位不參與實裝判定。
- 完整 sync 在既有 lock 內建立同目錄的本輪專屬 candidate。安裝前核對其 bytes hash 與 source 記錄一致，且所有預計 Variant 都在實際 staged 安裝集合、未被跳過；install 成功後才更名保存為 `uttu-supplement.json`。
- install 失敗不保存補給；補給更名失敗仍讓命令失敗並保留舊快照，多出的已驗證圖片留待下輪收斂。獨立 `sync-assets` 不會替其他命令留下的 candidate 完成收錄。

## 角色與心相譯名

`uttu-names.json` 依角色 `baseId`／心相 `id` 分兩區，只供應 `zh-TW`、`ja-JP`、`ko-KR`。它只供已決定的 catalog 查表，不建立、移除或改分類；未收錄 ID 不會因有譯名而出現。

- 角色取 `profiles/` 的 `LocaleName`，不要求星數、簡中名稱、衣著或圖片 metadata 完整。
- 心相取 `psychubes/` 的五語 `name` 陣列（`en, CN, TW, JP, KR`），按 `id` 配對，不用 `iconImageId` 或 slug。
- 兩區獨立刷新、保留 last known good；單區抓取／解析失敗不阻止另一區更新。空值或 `N/A` 不清掉已存譯名，衣著與圖片收錄成敗也不阻擋刷新。
- 整檔 atomic rename、按 ID 穩定排序，不記每輪時間戳，相同輸入重跑不產生差異。

各層先 trim 並排除空白與佔位值，再依序選取：

1. 當前 raw Global 語系名稱，沒有有效值才用手動設定；有效值即使與英文／簡中同名也保留。
2. 既有第三方有效譯名。
3. previous row 自己的有效在地譯名。
4. UTTU 譯名。
5. 仍可用的既有補給、弱 fallback／previous 值，最後才用英文／簡中補齊。

第三方與 previous 值若等於該列自己的英文／簡中，就視為弱 placeholder；比較歷史列時不用本輪已改名的英文。簡中與英文仍沿用 Global、手動及可信 CN 欄位的既有責任。

若只剩舊 completed snapshot、raw 已消失，而合法語系值恰與該列英文／簡中同名，就無法與 placeholder 分辨，會按弱 fallback 處理；UTTU 也缺譯時保留原值。catalog 沒有保存逐語系來源歷史。

## 已實裝怎麼判

- 角色看 Global `character.json` 的 `isOnline`：`1` 已實裝；`0`／空值／缺席未實裝。`YYYY-MM-DD HH:mm:ss` 是 English Global server-local timestamp，依追蹤的 UTC−05:00 offset 轉 UTC，早於建置 clock 才算已實裝；其他格式失敗。
- 初始與洞悉跟角色走；真正衣著看 Global `skin.json` 是否有該 ID。
- 心相看 Global `equip.json` 是否有該 ID，與圖片是否已保存獨立判定。
- `released-overrides.json` 只放人工確認的例外，永遠蓋過自動判定；重複、格式錯誤或不存在 ID 會讓 build 失敗。同步不自行改寫 override。

Future Sight 只控制顯示與選擇，不刪已保存的未實裝內容或隊伍引用。

## 角色順序

依序排列 CN-only、Kornblume、Huiji tier。Huiji 直接請求並重試一次，少於 100 個已知角色視為上游失敗，保留原排序；有效更新先排最新 Huiji 清單，再接上次清單中目前缺席的角色。Kornblume 只補 Huiji 未涵蓋的角色，不替代失敗的 Huiji 更新。

## 圖片

production 圖片為 lossless WebP，分別放在 `public/assets/characters/` 與 `public/assets/psychubes/`。

- primary 角色來源：`singlebg/headicon_small/{variantId}.png`，按 catalog 精確 ID 取圖，不能掃目錄就把 NPC／劇情圖當角色。PNG 缺席時優先保留已安裝可信 WebP，再讀已驗證 UTTU cache；新補給取 `https://assets.merui.net/headicon_small/{variantId}.webp`，須完整解碼、136–144 正方形、lossless 且非全透明，允許不帶 alpha 的不透明圖。
- primary 心相來源：`singlebg/equip_defaulticon/{id}.png`，尺寸 276×228，獨立發現與驗證保存；合法 catalog ID 仍缺圖時取 `https://assets.merui.net/equip_defaulticon/{id}.webp`，不是不同尺寸的 `equipment/icon`。無損解碼回 PNG 接既有 inventory，記錄實際來源。
- 遠端候選圖回傳 HTML、lossy、錯尺寸或全透明時只視為 unavailable，保留既有資料；本機讀寫／搬移失敗仍中止。既有可信圖不被次來源覆蓋；未變更圖重用 hash cache，新產圖檢查格式、尺寸與可見像素。

`312503`「野樹莓／踏影歌」保留 `catalog-policy.json` 指定的人工圖：CN 來源仍是舊劇情表情，後續衣著沿用 ID 卻未換圖。下次野樹莓新增衣著時重新核對 CN／Global，只有確認上游提供正確方形圖才移除此例外。

## 失敗與復原

- 整套 sync 共用 `/tmp/r1999-team-list-sync.lock`，同一輪只有一個 writer。
- 上游抓取、格式或完整度檢查失敗時使用已驗證快照；沒有依賴所需的可用快照，該操作才失敗。已獨立保存的來源與圖片仍可供下次更新使用。
- 角色個別 candidate 結構或 default 無效時保留上一版完整列（含名稱、實裝狀態）；新角色無舊列就略過，其他角色與心相繼續更新。明確 policy 排除不會被保留邏輯復活。
- 本機 cache 損毀、讀寫、人工設定、domain conflict 與程式／build 錯誤直接失敗，不以全管線 catch-and-continue 掩蓋。修正後重跑原入口，不手動把失敗資料覆寫成空快照。
