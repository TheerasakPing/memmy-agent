/** Language toggle button module. */
import { Globe2 } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { ResolvedLanguage } from "../i18n/messages.js";
import { PAGE_CORNER_ACTION_CONTAINER_STYLE } from "../theme/window-controls-overlay.js";

export { PAGE_CORNER_ACTION_CONTAINER_STYLE } from "../theme/window-controls-overlay.js";

/** The compact language button cycles through every supported UI locale. */
export function nextDisplayLanguage(language: ResolvedLanguage): ResolvedLanguage {
  return language === "zh-CN" ? "en-US" : language === "en-US" ? "th-TH" : "zh-CN";
}

const PAGE_CORNER_ACTION_CLASS =
  "flex items-center justify-center gap-1.5 px-2 py-1 text-sm font-normal text-text-ink/55 hover:text-text-ink/75 transition-colors cursor-pointer";

const PAGE_CORNER_ACTION_STYLE = {
  minHeight: "2.75rem",
  WebkitAppRegion: "no-drag"
} as CSSProperties;

export interface PageCornerActionButtonProps {
  label: string;
  ariaLabel?: string;
  icon: ReactNode;
  onClick: () => void;
  minWidth?: string;
  className?: string;
}

export function PageCornerActionButton(props: PageCornerActionButtonProps) {
  return (
    <button
      type="button"
      aria-label={props.ariaLabel ?? props.label}
      onClick={props.onClick}
      className={[PAGE_CORNER_ACTION_CLASS, props.className].filter(Boolean).join(" ")}
      style={{
        ...PAGE_CORNER_ACTION_STYLE,
        minWidth: props.minWidth
      }}
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

export interface LanguageToggleButtonProps {
  language: ResolvedLanguage;
  onClick: () => void;
  embedded?: boolean;
}

export function LanguageToggleButton(props: LanguageToggleButtonProps) {
  const nextLanguage = nextDisplayLanguage(props.language);
  const label = nextLanguage === "zh-CN" ? "中文" : nextLanguage === "th-TH" ? "ไทย" : "EN";
  const ariaLabel = nextLanguage === "zh-CN" ? "Switch to Chinese" : nextLanguage === "th-TH" ? "เปลี่ยนเป็นภาษาไทย" : "Switch to English";
  const embeddedStyle = { minWidth: "4.5rem", minHeight: "2.75rem", WebkitAppRegion: "no-drag" } as CSSProperties;
  const cornerStyle = {
    ...PAGE_CORNER_ACTION_CONTAINER_STYLE,
    ...embeddedStyle
  } as CSSProperties;

  if (props.embedded) {
    return (
      <PageCornerActionButton
        label={label}
        ariaLabel={ariaLabel}
        onClick={props.onClick}
        minWidth="4.5rem"
        icon={<Globe2 aria-hidden="true" size={16} className="shrink-0" />}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={props.onClick}
      className={PAGE_CORNER_ACTION_CLASS}
      style={cornerStyle}
    >
      <Globe2 aria-hidden="true" size={16} className="shrink-0" />
      <span>{label}</span>
    </button>
  );
}
