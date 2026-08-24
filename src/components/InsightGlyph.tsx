import { assetSrc } from "../utils/assets";
import { cx } from "../utils/design";

/** 官方洞悉階級圖示；I0 保留空盒位，避免等級文字跳動。 */
export function InsightGlyph({
  insight,
  className,
  tone = "default",
}: {
  insight: number;
  className?: string;
  tone?: "default" | "ink";
}): React.JSX.Element {
  const level = Math.max(0, Math.min(3, Math.trunc(insight)));
  return (
    <span
      className={cx(
        "insight-glyph",
        level === 0 && "insight-glyph--zero",
        level > 0 && `insight-glyph--level-${level}`,
        tone === "ink" && "insight-glyph--ink",
        className,
      )}
      role="img"
      aria-label={`I${level}`}
    >
      {level > 0 && (
        <img
          src={assetSrc(
            `/assets/ui/insight-${level}${tone === "ink" ? "-ink" : ""}.webp`,
          )}
          alt=""
          aria-hidden="true"
        />
      )}
    </span>
  );
}
