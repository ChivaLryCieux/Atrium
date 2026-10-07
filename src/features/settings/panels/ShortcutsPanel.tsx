import { useTranslation } from "react-i18next";
import { COMMANDS, formatShortcut, type CommandGroup } from "../../../commands/registry";

export function ShortcutsPanel() {
  const { t } = useTranslation();

  const shortcutGroups: { id: CommandGroup; label: string }[] = [
    { id: "session", label: t("settings.shortcutsGroupSession") },
    { id: "view", label: t("settings.shortcutsGroupView") },
    { id: "app", label: t("settings.shortcutsGroupApp") },
  ];

  return (
    <div className="settings-tab-pane">
      <div className="pane-header">
        <h2 className="pane-title">{t("settings.shortcutsTitle")}</h2>
        <p className="pane-subtitle">{t("settings.shortcutsSubtitle")}</p>
      </div>

      <div className="settings-card">
        <div className="setting-row">
          <div className="setting-label-col">
            <span className="setting-title">{t("settings.shortcutsPaletteTitle")}</span>
            <span className="setting-desc">{t("settings.shortcutsPaletteDesc")}</span>
          </div>
          <div className="setting-control-col">
            <kbd className="shortcut-kbd">Ctrl+K</kbd>
            <span className="shortcut-or">/</span>
            <kbd className="shortcut-kbd">Ctrl+Shift+P</kbd>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-label-col">
            <span className="setting-title">{t("settings.shortcutsComposerTitle")}</span>
            <span className="setting-desc">{t("settings.shortcutsComposerDesc")}</span>
          </div>
          <div className="setting-control-col">
            <kbd className="shortcut-kbd">Enter</kbd>
            <span className="shortcut-or">/</span>
            <kbd className="shortcut-kbd">Shift+Enter</kbd>
          </div>
        </div>
      </div>

      {shortcutGroups.map((group) => {
        const entries = COMMANDS.filter((cmd) => cmd.group === group.id);
        if (entries.length === 0) return null;
        return (
          <div className="settings-card" key={group.id} style={{ marginTop: "20px" }}>
            <div className="list-section-header" style={{ marginBottom: "8px" }}>
              {group.label}
            </div>
            {entries.map((cmd) => (
              <div className="setting-row" key={cmd.id}>
                <div className="setting-label-col">
                  <span className="setting-title">{t(cmd.titleKey)}</span>
                </div>
                <div className="setting-control-col">
                  {cmd.shortcut ? (
                    <kbd className="shortcut-kbd">{formatShortcut(cmd.shortcut)}</kbd>
                  ) : (
                    <span className="setting-desc">{t("settings.shortcutsNoBinding")}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
