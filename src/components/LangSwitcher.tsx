import { LANGS, getUiText } from "../i18n/ui";
import type { LangCode } from "../i18n/ui";
export function LangSwitcher({
  value,
  onChange,
}: {
  value: LangCode;
  onChange: (lang: LangCode) => void;
}): React.JSX.Element {
  return (
    <div
      className="lang-switcher"
      role="group"
      aria-label={getUiText(value, "langSwitcher")}
    >
      {LANGS.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          data-active={value === code}
          aria-pressed={value === code}
          onClick={() => onChange(code)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
