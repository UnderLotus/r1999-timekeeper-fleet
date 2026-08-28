# 遊戲資料更新

網站執行時只讀 repo 內建好的 catalog 和圖片，不會從瀏覽器呼叫遊戲資料或 Wiki API。

## 最常用的指令

完整更新：

```bash
npm run sync
```

這會依序更新中國服與 Global 資料、名稱 fallback、角色順序、catalog 和圖片。任何一步失敗都會停止，不會把半套結果當成成功資料。

只從目前保存的 `scripts/data/catalog-source.json` 重建：

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

- 中國服 `character.json`、`skin.json`、`equip.json`：完整角色、衣著與心相集合。
- Global 對應檔案：外服實裝狀態與五語系名稱。
- Huiji：角色順序。
- Kornblume、wikiru / Fandom：只有 Global 缺名稱或順序時才使用。

原始 cache 放在 `scripts/data/cn/` 和 `scripts/data/gl/`，不提交到 Git。repo 只保存建置所需的精簡快照。

## 已實裝怎麼判

- 角色看 Global `character.json` 的 `isOnline`：`1` 立即視為已實裝，`0`／空值／缺席為未實裝；`YYYY-MM-DD HH:mm:ss` 是 English Global server-local timestamp，依 Fleet 追蹤的 UTC−05:00 offset 轉成 UTC，只有早於本次建置 clock 才視為已實裝。其他格式會讓流程失敗。
- 初始與洞悉立繪跟角色走，不套衣著規則。
- 真正的衣著看 Global `skin.json` 有沒有該 ID。
- 心相必須同時存在於中國服集合與 Global `equip.json`。

有些內容會提早出現在上游資料，或只屬於特定地區。這些例外放在 `scripts/data/released-overrides.json`；人工設定永遠蓋過自動判定。例如 `302306`「詩的禮讚」是中國服設定集專屬衣著，Global 不提供，因此固定為未實裝。

override 只放人工確認的例外。重複 ID、格式錯誤或已不存在的 ID 都會讓 build 失敗，更新流程不會自行改寫這個檔案。

Future Sight 只是顯示與選擇開關。關閉時不會刪除已保存的未實裝角色、衣著、心相或隊伍引用。

## 角色順序

排序先抓 Huiji；失敗後使用 Kornblume，最後才使用中國服順序。Huiji 會重試一次；如果解析不到至少 100 個 catalog 內的角色，就直接失敗且不寫入新 snapshot。

## 圖片

角色與心相的 production 圖片是 lossless WebP：

- 角色：`public/assets/characters/`
- 心相：`public/assets/psychubes/`

`312503`「野樹莓／踏影歌」是人工圖片特例。CN 解包包的 `headicon_small/312503.png` 是 3.1 劇情表情，3.4 衣著沿用同一 ID 後也沒有替換該方形圖；因此網站使用人工確認的 `public/assets/characters/312503.webp`；這個 ID 記錄在 validated `scripts/data/catalog-policy.json`，`sync-assets.ts` 讀取 policy 後保留並跳過它。下次野樹莓新增衣著時，重新檢查 CN 與 Global 包體；只有確認上游提供正確方形衣著圖後才移除此特例。

`sync-assets.ts` 只從 catalog 列出的精確 ID 下載檔案，不 checkout 整個素材目錄。沒有變更的圖片會由 hash cache 重用；新檔轉換後會檢查格式、尺寸、像素與完整覆蓋，再取代 production 目錄。

整套 sync 共用 `/tmp/r1999-team-list-sync.lock`，避免兩個更新程序同時發布不同世代的資料。可預期的下載、解析或轉檔錯誤會保留上一份完整 cache。

早期素材路徑研究已移到 [`archive/reverse1999_asset_notes.md`](archive/reverse1999_asset_notes.md)；那不是目前的更新方式。
