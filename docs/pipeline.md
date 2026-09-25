# 遊戲資料更新

網站執行時只讀 repo 內建好的 catalog 和圖片，不會從瀏覽器呼叫遊戲資料或 Wiki API。

## 最常用的指令

完整更新：

```bash
npm run sync
```

完整更新依序取得解包資料與 Global 翻譯、補名稱、更新角色順序，再建立 catalog 與圖片。Huiji 以 `curl_cffi` 直接請求；初次使用先執行 `python3 -m venv .venv && .venv/bin/pip install -r requirements-huiji.txt`。任一步失敗都會停止，Huiji 失敗不會覆寫排序快照。

從保存的資料重建：角色讀取 `scripts/data/catalog-source.json`；心相另外讀取 `scripts/data/psychube-image-inventory.json`。

```bash
npm run build:characters
npm run build:psychubes
```

其他指令：

- `npm run sync:cn` / `npm run sync:gl`：更新本機的原始資料 cache。
- `npm run sync:names`：補 Global 缺少的名稱。
- `npm run sync:order`：更新角色顯示順序。
- `npm run build:source`：把原始資料整理成可提交的精簡快照。
- `npm run test:release`：檢查實裝判定與人工 override。
- `npm run test:assets`：檢查 catalog 和 WebP 是否一一對應。

## 資料從哪裡來

- St-Pavlov [`re1999-data`](https://github.com/St-Pavlov-Foundation/re1999-data) 的 `character.json`、`skin.json`、`equip.json`：角色、衣著與心相解包資料。
- [`re1999-data-global`](https://github.com/St-Pavlov-Foundation/re1999-data-global)：Global 實裝狀態與各語系名稱。
- [`Reverse-1999-CN-Asset`](https://github.com/myssal/Reverse-1999-CN-Asset)：角色對照與圖片，包含心相圖示。
- Huiji：角色順序；最新清單排在 Huiji tier 前段，上次可信 Huiji 清單中目前缺席的角色保留在尾段，再由 Kornblume 與 CN-only tier 補齊。
- Kornblume、wikiru / Fandom：只有 Global 缺名稱或順序時才使用。

`scripts/data/cn/`、`scripts/data/gl/` 是不提交的原始資料 cache；心相已驗證的 PNG 與圖片清單則保存在 `scripts/data/psychube-image-cache/`、`scripts/data/psychube-image-inventory.json`，供下次增量更新與重建使用。

## 已實裝怎麼判

- 角色看 Global `character.json` 的 `isOnline`：`1` 立即視為已實裝，`0`／空值／缺席為未實裝；`YYYY-MM-DD HH:mm:ss` 是 English Global server-local timestamp，依 Fleet 追蹤的 UTC−05:00 offset 轉成 UTC，只有早於本次建置 clock 才視為已實裝。其他格式會讓流程失敗。
- 初始與洞悉立繪跟角色走，不套衣著規則。
- 真正的衣著看 Global `skin.json` 有沒有該 ID。
- 心相名稱與基本資料按 ID 從 `re1999-data` 及 `re1999-data-global` 的 `equip.json` 增量合併；來源缺席或欄位退化時保留最後可信值。CN Asset 的 `equip_defaulticon/<ID>.png` 獨立發現並驗證保存，沒有名稱也保留圖片。只有可信簡體名稱與有效圖片齊全才進入網站 catalog；Global `equip.json` 是否有該 ID 獨立決定實裝狀態。

有些內容會提早出現在上游資料，或只屬於特定地區。這些例外放在 `scripts/data/released-overrides.json`；人工設定永遠蓋過自動判定。例如 `302306`「詩的禮讚」是中國服設定集專屬衣著，Global 不提供，因此固定為未實裝。

override 只放人工確認的例外。重複 ID、格式錯誤或已不存在的 ID 都會讓 build 失敗，更新流程不會自行改寫這個檔案。

Future Sight 只是顯示與選擇開關。關閉時不會刪除已保存的未實裝角色、衣著、心相或隊伍引用。

## 角色順序

直接請求 Huiji 並重試一次；若取得的已知角色少於 100 個，就停止且不寫入新排序。成功後依序排列 CN-only、Kornblume、Huiji 角色；Huiji 層內先用最新清單，再接上次清單中缺席的角色。Kornblume 只補 Huiji 未涵蓋的角色，不能取代失敗的 Huiji 更新。

## 衣著對照差異提醒

build:source 會比對 CN `skin.json` 與 `ArcanistMap.json`：CN 包體有、但對照表沒有的衣著 ID 會以提醒輸出（僅提醒，不警告也不中斷更新），清單暫存在 `/tmp/r1999-team-list-sync/`，由 `npm run sync` 結尾彙整呈現。已知例外記錄在 `catalog-policy.json` 的 `ignoredCnSkinStubs`——CN 包體預留的空殼佔位 ID，沒有實際衣著內容；這些 ID 若從包體消失或變成真實衣著，build 會失敗並要求人工重新審視。

## 圖片

角色與心相的 production 圖片是 lossless WebP：

- 角色：`public/assets/characters/`
- 心相：`public/assets/psychubes/`

`312503`「野樹莓／踏影歌」是人工圖片特例。CN 解包包的 `headicon_small/312503.png` 是 3.1 劇情表情，3.4 衣著沿用同一 ID 後也沒有替換該方形圖；因此網站使用人工確認的 `public/assets/characters/312503.webp`；這個 ID 記錄在 validated `scripts/data/catalog-policy.json`，`sync-assets.ts` 讀取 policy 後保留並跳過它。下次野樹莓新增衣著時，重新檢查 CN 與 Global 包體；只有確認上游提供正確方形衣著圖後才移除此特例。

角色圖片依 catalog 的精確 ID 取得；心相圖示則獨立列舉 CN Asset 中的數字 ID，驗證後保存 PNG 與圖片清單，未有名稱的圖片也保留。網站只使用名稱與圖片齊全的心相 WebP；未變更圖片由 hash cache 重用，新圖轉換後檢查格式、尺寸與像素。

整套 sync 共用 `/tmp/r1999-team-list-sync.lock`，避免同時更新。各來源與圖片快取獨立保存；失敗時停止，已保存的單邊資料仍可供下次更新使用。

早期素材路徑研究已移到 [`archive/reverse1999_asset_notes.md`](archive/reverse1999_asset_notes.md)；那不是目前的更新方式。
