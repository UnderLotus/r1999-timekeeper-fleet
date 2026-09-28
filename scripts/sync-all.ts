import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { withPipelineLock } from "./sync-lock";
await withPipelineLock(async () => {
  // Per-run diff file: the end-of-run summary only ever reads the file this
  // run generated, so a failed persistence write cannot leak a stale diff
  // from an earlier run into the final reminder.
  const diffFile = path.join(
    "/tmp/r1999-team-list-sync",
    `skin-mapping-diff-${randomUUID()}.json`,
  );
  const env = {
    ...process.env,
    R1999_SYNC_LOCK_HELD: "1",
    R1999_MAPPING_DIFF_FILE: diffFile,
  };
  for (const script of [
    "sync:gl",
    "sync:cn",
    "sync:names",
    "sync:order",
    "build:source",
  ]) {
    execFileSync("npm", ["run", script], { stdio: "inherit", env });
  }
  execFileSync("npx", ["tsx", "scripts/sync-assets.ts"], {
    stdio: "inherit",
    env,
  });
  execFileSync("npm", ["run", "build:characters"], {
    stdio: "inherit",
    env,
  });
  execFileSync("npm", ["run", "build:psychubes"], {
    stdio: "inherit",
    env,
  });
  const file = existsSync(diffFile) ? diffFile : null;
  if (file) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf-8")) as {
        diff?: Array<{ id: string; baseId: string; name: string }>;
      };
      if (parsed.diff?.length) {
        console.log(
          `\n最終提醒：${parsed.diff.length} 個 CN 衣著未出現在 ArcanistMap（catalog 未收錄）`,
        );
        for (const entry of parsed.diff)
          console.log(`  - ${entry.id}（${entry.name}）`);
        console.log(`  清單：${file}`);
        console.log("  請人工確認；此提醒不會中斷更新流程。");
      }
    } catch {
      console.log("最終提醒：讀取本輪差異清單失敗，略過彙整。");
    }
  } else if (existsSync(path.dirname(diffFile))) {
    // 本輪 build:source 沒有產出差異檔（或持久化失敗）；中段提醒已是唯一來源。
    console.log(
      "最終提醒：本輪無法確認差異清單暫存；請回看 build:source 步驟的提醒輸出。",
    );
  }
});