import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AnchorRect } from "../utils/design";
import { cx } from "../utils/design";
export function ResponsivePopover({
  title,
  closeLabel,
  anchor,
  onClose,
  children,
  className,
}: {
  title: string;
  closeLabel: string;
  anchor?: AnchorRect;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const [mobile, setMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 640px)").matches,
  );
  const [position, setPosition] = useState<React.CSSProperties>();
  useLayoutEffect(() => {
    const reposition = () => {
      const isMobile = window.matchMedia("(max-width: 640px)").matches;
      setMobile(isMobile);
      if (isMobile || !panel.current) {
        setPosition(undefined);
        return;
      }
      const target = anchor?.element?.isConnected
        ? anchor.element.getBoundingClientRect()
        : (anchor ?? {
            top: window.innerHeight / 2,
            right: window.innerWidth / 2,
            bottom: window.innerHeight / 2,
            left: window.innerWidth / 2,
            width: 0,
            height: 0,
          });
      const box = panel.current.getBoundingClientRect(),
        gap = 8;
      const left = Math.min(
        window.innerWidth - box.width - gap,
        Math.max(gap, target.left),
      );
      const below = target.bottom + gap;
      const top =
        below + box.height <= window.innerHeight - gap
          ? below
          : Math.max(gap, target.top - box.height - gap);
      setPosition({ left, top });
    };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [anchor]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const outside = (event: PointerEvent) => {
      if (
        !mobile &&
        panel.current &&
        !panel.current.contains(event.target as Node) &&
        event.target !== anchor?.element
      )
        onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    const selected =
      panel.current?.querySelector<HTMLElement>('[aria-pressed="true"]') ??
      panel.current?.querySelector<HTMLElement>("button");
    selected?.focus();
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus();
    };
  }, [anchor?.element, mobile, onClose]);
  return (
    <div
      className={cx(
        "responsive-popover",
        mobile && "responsive-popover--mobile",
      )}
    >
      <button
        type="button"
        className="responsive-popover__backdrop"
        aria-label={closeLabel}
        tabIndex={mobile ? 0 : -1}
        onClick={onClose}
      />
      <div
        ref={panel}
        className={cx("responsive-popover__panel", className)}
        style={position}
        role="dialog"
        aria-modal={mobile || undefined}
        aria-label={title}
      >
        <header className="responsive-popover__head">
          <span>{title}</span>
          <button type="button" aria-label={closeLabel} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="responsive-popover__body">{children}</div>
      </div>
    </div>
  );
}
