/**
 * sync:uttu-names — refresh only the exact-ID UTTU locale names.
 * This entry never touches supplement metadata, images, admission or release.
 */

import { withPipelineLock } from "./sync-lock";
import { refreshUttuNames } from "./uttu-names";

if (import.meta.url === "file://" + process.argv[1]) {
  void withPipelineLock(async () => {
    console.log("sync:uttu-names — exact-ID locale names\n");
    const refreshed = refreshUttuNames();
    for (const warning of refreshed.warnings) console.warn(`  warning: ${warning}`);
    console.log(
      `names: ${refreshed.characters} characters, ${refreshed.psychubes} psychubes`,
    );
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
