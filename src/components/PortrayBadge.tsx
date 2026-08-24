import { cx } from "../utils/design";

export function PortrayBadge({
  portray,
  onChange,
  className,
}: {
  portray: number;
  onChange?: (value: number) => void;
  className?: string;
}): React.JSX.Element | null {
  if (!onChange && portray <= 0) return null;
  return (
    <span
      className={cx(
        "portray-badge",
        onChange && "portray-badge--interactive",
        className,
      )}
      role={onChange ? "radiogroup" : "img"}
      aria-label={`P${portray}`}
    >
      {[1, 2, 3, 4, 5].map((value) =>
        onChange ? (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={value <= portray}
            aria-label={`P${value}`}
            className={cx(
              "portray-badge__segment",
              value <= portray && "is-lit",
            )}
            onClick={(event) => {
              event.stopPropagation();
              onChange(value === portray ? Math.max(0, value - 1) : value);
            }}
          />
        ) : (
          <span
            key={value}
            className={cx(
              "portray-badge__segment",
              value <= portray && "is-lit",
            )}
          />
        ),
      )}
    </span>
  );
}
