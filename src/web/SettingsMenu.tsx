import {
  IconCheck,
  IconChevronSm,
  IconCodeStyleBars,
  IconColorAuto,
  IconColorDark,
  IconColorLight,
  IconEyeSlash,
  IconGearFill,
  IconSymbolDiffstat,
} from "@pierre/icons";
import type { ColorMode, ColorScheme } from "@pierre/theming";
import { useLayoutEffect, useRef, useState } from "react";
import { Popover } from "./Popover.tsx";
import type { AppTheme } from "./theme.ts";
import type { SettingsApi } from "./useSettings.ts";

const MODES: { value: ColorMode; label: string; Icon: typeof IconColorAuto }[] = [
  { value: "system", label: "自動", Icon: IconColorAuto },
  { value: "light", label: "ライト", Icon: IconColorLight },
  { value: "dark", label: "ダーク", Icon: IconColorDark },
];

const INDICATORS = [
  { value: "bars", label: "バー", Icon: IconCodeStyleBars },
  { value: "classic", label: "+ −", Icon: IconSymbolDiffstat },
  { value: "none", label: "なし", Icon: IconEyeSlash },
] as const;

function modeIcon(mode: ColorMode) {
  return MODES.find((entry) => entry.value === mode)?.Icon ?? IconColorAuto;
}

interface Props {
  theme: AppTheme;
  settings: SettingsApi;
}

/** トップバーの歯車。テーマと表示のオプションをまとめて置く。 */
export function SettingsMenu({ theme, settings }: Props) {
  return (
    <>
      <ThemeMenu theme={theme} />
      <Popover label="表示設定" trigger={<IconGearFill size={14} />}>
        <>
          <Switch
            label="背景を塗る"
            checked={settings.backgrounds}
            onChange={(value) => settings.set("backgrounds", value)}
          />
          <Switch
            label="行番号"
            checked={settings.lineNumbers}
            onChange={(value) => settings.set("lineNumbers", value)}
          />
          <Switch
            label="折り返し"
            checked={settings.wordWrap}
            onChange={(value) => settings.set("wordWrap", value)}
          />
          <div className="menu__row">
            <span>差分の印</span>
            <div className="segmented segmented--icons" role="group" aria-label="差分の印">
              {INDICATORS.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  className={settings.diffIndicators === value ? "is-active" : ""}
                  aria-pressed={settings.diffIndicators === value}
                  title={label}
                  onClick={() => settings.set("diffIndicators", value)}
                >
                  <Icon size={13} />
                </button>
              ))}
            </div>
          </div>
        </>
      </Popover>
    </>
  );
}

/**
 * テーマのピッカー。
 *
 * 横に伸びるサブメニューは狭い画面で溢れるので、同じパネルの中で「トップ →
 * ライト一覧／ダーク一覧」と表示を差し替える。
 */
function ThemeMenu({ theme }: { theme: AppTheme }) {
  const TriggerIcon = modeIcon(theme.mode);
  return (
    <Popover label="テーマ" trigger={<TriggerIcon size={14} />}>
      {/* パネルは閉じるとアンマウントされるので、次に開いたときは必ずトップから始まる */}
      <ThemePanel theme={theme} />
    </Popover>
  );
}

function ThemePanel({ theme }: { theme: AppTheme }) {
  const [view, setView] = useState<"main" | ColorScheme>("main");

  if (view !== "main") {
    return <ThemeList scheme={view} theme={theme} onBack={() => setView("main")} />;
  }

  return (
    <>
      <div className="segmented segmented--wide" role="group" aria-label="配色">
        {MODES.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            className={theme.mode === value ? "is-active" : ""}
            aria-pressed={theme.mode === value}
            onClick={() => theme.setMode(value)}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>
      <button type="button" className="menu__item" onClick={() => setView("light")}>
        <IconColorLight size={14} />
        <span className="menu__value">{theme.lightThemeName}</span>
        <IconChevronSm size={14} className="menu__chevron" />
      </button>
      <button type="button" className="menu__item" onClick={() => setView("dark")}>
        <IconColorDark size={14} />
        <span className="menu__value">{theme.darkThemeName}</span>
        <IconChevronSm size={14} className="menu__chevron" />
      </button>
    </>
  );
}

interface ThemeListProps {
  scheme: ColorScheme;
  theme: AppTheme;
  onBack(): void;
}

function ThemeList({ scheme, theme, onBack }: ThemeListProps) {
  const current = scheme === "light" ? theme.lightThemeName : theme.darkThemeName;
  const names = theme.themeNames(scheme);
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  // 選択中のテーマを上から 2 番目に置く。カーソルのすぐ下に現在値が来て、
  // 1 つ上のテーマにもすぐ届く
  useLayoutEffect(() => {
    const list = listRef.current;
    const selected = selectedRef.current;
    if (list === null || selected === null) return;
    const offset = selected.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTop = Math.max(0, list.scrollTop + offset - selected.offsetHeight);
  }, [scheme]);

  return (
    <>
      <button type="button" className="menu__item" onClick={onBack}>
        <IconChevronSm size={14} className="menu__chevron menu__chevron--back" />
        <span className="menu__value">{scheme === "light" ? "ライトテーマ" : "ダークテーマ"}</span>
      </button>
      <div className="menu__list" ref={listRef}>
        {names.map((name) => (
          <button
            key={name}
            ref={name === current ? selectedRef : undefined}
            type="button"
            className={`menu__item${name === current ? " is-active" : ""}`}
            onClick={() => {
              theme.setThemeName(scheme, name);
              // 選んだテーマがすぐ見えるようにモードも合わせる
              theme.setMode(scheme);
            }}
          >
            <span className="menu__value">{name}</span>
            {name === current && <IconCheck size={14} />}
          </button>
        ))}
      </div>
    </>
  );
}

interface SwitchProps {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
}

function Switch({ label, checked, onChange }: SwitchProps) {
  return (
    <label className="menu__row menu__row--clickable">
      <span>{label}</span>
      <input
        type="checkbox"
        className="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
