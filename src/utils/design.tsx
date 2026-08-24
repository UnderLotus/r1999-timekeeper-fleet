import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
export type BtnVariant = "primary" | "neutral" | "danger" | "teal" | "ghost";
export type BtnSize = "sm" | "md";
export interface BtnProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: BtnVariant;
  size?: BtnSize;
}
export function Btn({
  variant = "neutral",
  size = "md",
  className,
  children,
  ...rest
}: BtnProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={cx(
        "ds-btn",
        `ds-btn--${variant}`,
        `ds-btn--${size}`,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
export function Field({
  label,
  tone = "default",
  className,
  children,
}: {
  label: string;
  tone?: "default" | "danger" | "gold" | "teal";
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <label
      className={cx(
        "ds-field",
        tone !== "default" && `ds-field--${tone}`,
        className,
      )}
    >
      <span className="ds-field__label">{label}</span>
      <span className="ds-field__value">{children}</span>
    </label>
  );
}
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  decreaseLabel,
  increaseLabel,
  format,
  disabled,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  decreaseLabel: string;
  increaseLabel: string;
  format?: (v: number) => string;
  disabled?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <span className={cx("ds-stepper", className)}>
      <span className="ds-stepper__label">{label}</span>
      <button
        type="button"
        className="ds-stepper__btn"
        aria-label={decreaseLabel}
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span className="ds-stepper__value" aria-live="polite">
        {format ? format(value) : value}
      </span>
      <button
        type="button"
        className="ds-stepper__btn"
        aria-label={increaseLabel}
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </span>
  );
}
export function SegButtons({
  options,
  selected,
  onSelect,
  className,
}: {
  options: Array<{
    key: string;
    label: ReactNode;
    ariaLabel?: string;
    disabled?: boolean;
  }>;
  selected?: string;
  onSelect: (key: string) => void;
  className?: string;
}): React.JSX.Element {
  return (
    <span className={cx("ds-seg", className)}>
      {options.map((item) => (
        <button
          key={item.key}
          type="button"
          className={cx("ds-seg__item", selected === item.key && "is-selected")}
          aria-pressed={selected === item.key}
          aria-label={item.ariaLabel}
          disabled={item.disabled}
          onClick={() => onSelect(item.key)}
        >
          {item.label}
        </button>
      ))}
    </span>
  );
}
export interface AnchorRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
  element?: HTMLElement;
}
export function rectFromElement(element: HTMLElement): AnchorRect {
  const r = element.getBoundingClientRect();
  return {
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    left: r.left,
    width: r.width,
    height: r.height,
    element,
  };
}
export function Overlay({
  title,
  closeLabel,
  onClose,
  children,
  className,
  anchor,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  anchor?: AnchorRect;
}): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null),
    close = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<React.CSSProperties>();
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const focusable = Array.from(
        panel.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", key);
    close.current?.focus();
    return () => {
      document.removeEventListener("keydown", key);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose]);
  useIsomorphicLayoutEffect(() => {
    if (!anchor || window.innerWidth <= 640 || !panel.current) {
      setPosition(undefined);
      return;
    }
    const box = panel.current.getBoundingClientRect(),
      gap = 8;
    let left = Math.min(
      window.innerWidth - box.width - gap,
      Math.max(gap, anchor.left),
    );
    let top = anchor.bottom + gap;
    if (top + box.height > window.innerHeight - gap)
      top = Math.max(gap, anchor.top - box.height - gap);
    setPosition({ left, top });
  }, [anchor]);
  return (
    <div
      className={cx("ds-overlay", anchor && "ds-overlay--anchored")}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        className="ds-overlay__backdrop"
        aria-label={closeLabel}
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={panel}
        className={cx("ds-overlay__panel", className)}
        style={position}
      >
        <header className="ds-overlay__head">
          <span className="ds-overlay__title">{title}</span>
          <button
            ref={close}
            type="button"
            className="ds-overlay__close"
            aria-label={closeLabel}
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        <div className="ds-overlay__body">{children}</div>
      </div>
    </div>
  );
}
export function Badge({
  tone,
  children,
  className,
}: {
  tone: "gold" | "teal" | "danger" | "neutral";
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <span className={cx("ds-badge", `ds-badge--${tone}`, className)}>
      {children}
    </span>
  );
}
