# Reverse: 1999 素材路徑研究（封存）

> Historical research only。這不是目前的資料更新規格；請以 [`../pipeline.md`](../pipeline.md) 為準。

早期調查確認了中國服素材 repo 中兩種 production 來源：

- 角色小頭像：`singlebg/headicon_small/{ID}.png`，正方形 RGBA。
- 心相小圖：`singlebg/equip_defaulticon/{ID}.png`，原圖為 276×228。

`headicon_small` 同時包含可玩角色、衣著、NPC 與劇情角色，不能整個目錄直接當 catalog。可玩的角色與衣著 ID 必須來自整理後的角色資料；心相也必須先排除經驗素材、測試資料與升階素材。

目前 `scripts/sync-assets.ts` 會從生成後的 catalog 建立精確檔案 allowlist，只抓需要的 ID，轉成 lossless WebP，驗證尺寸與像素後才替換 `public/assets/characters/` 和 `public/assets/psychubes/`。

本文件不保留當時的 snapshot 數量、一次性下載指令或 `/tmp` 樣本路徑，避免被誤認成現行流程。
