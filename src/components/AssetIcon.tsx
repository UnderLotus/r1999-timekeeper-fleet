import { useMemo, useState } from "react";
import {
  assetSrc,
  characterAssetPath,
  psychubeAssetPath,
} from "../utils/assets";

/** 角色（正方形）或心相（裁切）圖；統一 AssetIcon frame（LOC-39） */
export function AssetIcon(props: {
  kind: "character" | "psychube";
  id: string;
  alt: string;
  className?: string;
  rounded?: boolean;
  loading?: "eager" | "lazy";
}): React.JSX.Element {
  const { kind, id, alt, className, rounded, loading = "lazy" } = props;
  const [failed, setFailed] = useState(false);
  const src = useMemo(
    () =>
      assetSrc(
        kind === "character" ? characterAssetPath(id) : psychubeAssetPath(id),
      ),
    [kind, id],
  );
  if (failed) {
    return (
      <span
        className={className}
        role="img"
        aria-label={alt}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "var(--surface-dark)",
          color: "var(--ink-muted)",
          fontSize: 10,
          borderRadius: rounded ? 2 : 0,
        }}
      >
        {alt.slice(0, 2)}
      </span>
    );
  }
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading={loading}
      decoding="async"
      onError={() => setFailed(true)}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
}
