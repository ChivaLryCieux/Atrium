import { useState } from "react";
import { useTranslation } from "react-i18next";

type AboutTab = "about" | "charter";

type AboutDialogProps = {
  onClose: () => void;
};

export function AboutDialog({ onClose }: AboutDialogProps) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<AboutTab>("about");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            {tab === "about" ? t("about.aboutTitle") : t("about.charterTitle")}
          </span>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Tab switch: 关于 Atrium / 智役宪章 */}
        <div className="tab-switch">
          <button
            className={`tab-btn ${tab === "about" ? "active" : ""}`}
            onClick={() => setTab("about")}
          >
            {t("about.aboutTab")}
          </button>
          <button
            className={`tab-btn ${tab === "charter" ? "active" : ""}`}
            onClick={() => setTab("charter")}
          >
            {t("about.charterTab")}
          </button>
        </div>

        <div className="modal-body">
          {tab === "about" ? (
            <>
              <div className="about-meta">
                <span>{i18n.language === "zh-CN" ? `Atrium ${t("common.brandName")}` : t("common.brandName")} — AI Agent Harness Terminal</span>
                <span>{t("about.version", { version: "v0.2.0" })}</span>
                <span>{t("about.kernelLine")}</span>
              </div>
              <div className="about-placeholder">
                {t("about.introPlaceholder")}
              </div>
              <div className="about-placeholder">
                {t("about.designPlaceholder")}
              </div>
              <div className="about-placeholder">
                {t("about.creditsPlaceholder")}
              </div>
            </>
          ) : (
            <>
              <div className="about-placeholder charter">
                {t("about.charterPreamble")}
              </div>
              <div className="about-placeholder charter">
                {t("about.charterCh1")}
              </div>
              <div className="about-placeholder charter">
                {t("about.charterCh2")}
              </div>
              <div className="about-placeholder charter">
                {t("about.charterAppendix")}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-primary" onClick={onClose}>
            {t("dialog.gotIt")}
          </button>
        </div>
      </div>
    </div>
  );
}
