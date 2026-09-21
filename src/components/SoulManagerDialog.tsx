import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Soul } from "../types/chat";
import { AppDialog, AppDialogRequest } from "./AppDialog";

type SoulManagerDialogProps = {
  souls: Soul[];
  activeSoul: string | null;
  onActivate: (folder: string) => void;
  onChanged: () => void;
  onDeleted: (folder: string) => void;
  onClose: () => void;
};

export function SoulManagerDialog({
  souls,
  activeSoul,
  onActivate,
  onChanged,
  onDeleted,
  onClose,
}: SoulManagerDialogProps) {
  const [selectedFolder, setSelectedFolder] = useState<string>(
    () => souls.find((s) => s.folder === activeSoul)?.folder ?? souls[0]?.folder ?? "Default"
  );
  const [creating, setCreating] = useState(souls.length === 0);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<AppDialogRequest | null>(null);
  const { t } = useTranslation();

  const selected = souls.find((s) => s.folder === selectedFolder) ?? null;

  useEffect(() => {
    if (selected) {
      setDraftName(selected.name);
      setDraftDescription(selected.description);
      setDraftContent(selected.content);
      setDirty(false);
    }
  }, [selected?.folder]);

  const handleCreate = async () => {
    if (!newName.trim()) {
      setDialog({ kind: "alert", title: t("common.hint"), message: t("souls.enterNameFirst"), tone: "danger" });
      return;
    }
    try {
      const soul = await invoke<Soul>("create_soul", {
        name: newName.trim(),
        description: newDescription.trim(),
      });
      setCreating(false);
      setNewName("");
      setNewDescription("");
      onChanged();
      setSelectedFolder(soul.folder);
    } catch (err) {
      setDialog({ kind: "alert", title: t("souls.createFailed"), message: String(err), tone: "danger" });
    }
  };

  const handleSave = async () => {
    if (!selected || !draftName.trim()) return;
    setSaving(true);
    try {
      await invoke<Soul>("save_soul", {
        folder: selected.folder,
        name: draftName.trim(),
        description: draftDescription.trim(),
        content: draftContent,
      });
      setDirty(false);
      onChanged();
      setDialog({ kind: "alert", title: t("common.hint"), message: t("souls.saved", { name: draftName.trim() }) });
    } catch (err) {
      setDialog({ kind: "alert", title: t("souls.saveFailed"), message: String(err), tone: "danger" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!selected || selected.isDefault) return;
    const label = selected.name;
    setDialog({
      kind: "confirm",
      title: t("common.dangerAction"),
      tone: "danger",
      message: t("souls.confirmDelete", { label, folder: selected.folder }),
      onConfirm: async () => {
        try {
          await invoke("delete_soul", { folder: selected.folder });
          onChanged();
          onDeleted(selected.folder);
          setSelectedFolder("Default");
        } catch (err) {
          setDialog({ kind: "alert", title: t("souls.deleteFailed"), message: String(err), tone: "danger" });
        }
      },
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog soul-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{t("souls.title")}</span>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="soul-split">
          {/* Left: souls list */}
          <div className="soul-list">
            {souls.map((soul) => (
              <div
                key={soul.folder}
                className={`soul-list-item ${soul.folder === selectedFolder ? "active" : ""}`}
                onClick={() => {
                  setSelectedFolder(soul.folder);
                  setCreating(false);
                }}
              >
                <span className="soul-item-name">{soul.name}</span>
                <span className="soul-item-badges">
                  {soul.folder === activeSoul && <span className="soul-badge active-badge">{t("souls.activating")}</span>}
                  {soul.isDefault && <span className="soul-badge">{t("souls.factory")}</span>}
                </span>
              </div>
            ))}
            <button
              type="button"
              className={`soul-new-btn ${creating ? "active" : ""}`}
              onClick={() => setCreating(true)}
            >
              {t("souls.newSoul")}
            </button>
          </div>

          {/* Right: editor / create form */}
          <div className="soul-editor">
            {creating ? (
              <>
                <div className="form-item">
                  <label>{t("souls.soulName")}</label>
                  <input
                    type="text"
                    className="zcode-input"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={t("souls.namePlaceholder")}
                    autoFocus
                  />
                </div>
                <div className="form-item">
                  <label>{t("souls.description")}</label>
                  <input
                    type="text"
                    className="zcode-input"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder={t("souls.descriptionPlaceholder")}
                  />
                </div>
                <p className="soul-hint">
                  {t("souls.createdHint")}
                </p>
                <div className="soul-editor-actions">
                  <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>
                    {t("souls.cancel")}
                  </button>
                  <button type="button" className="btn-primary" disabled={!newName.trim()} onClick={handleCreate}>
                    {t("souls.createSoul")}
                  </button>
                </div>
              </>
            ) : selected ? (
              <>
                <div className="form-item">
                  <label>{t("souls.soulName")}</label>
                  <input
                    type="text"
                    className="zcode-input"
                    value={draftName}
                    onChange={(e) => {
                      setDraftName(e.target.value);
                      setDirty(true);
                    }}
                  />
                </div>
                <div className="form-item">
                  <label>{t("souls.description")}</label>
                  <input
                    type="text"
                    className="zcode-input"
                    value={draftDescription}
                    onChange={(e) => {
                      setDraftDescription(e.target.value);
                      setDirty(true);
                    }}
                  />
                </div>
                <div className="form-item">
                  <div className="directory-header">
                    <label>SOUL.md（Souls/{selected.folder}/）</label>
                    {dirty && <span className="soul-dirty">{t("souls.unsaved")}</span>}
                  </div>
                  <textarea
                    className="soul-textarea"
                    value={draftContent}
                    onChange={(e) => {
                      setDraftContent(e.target.value);
                      setDirty(true);
                    }}
                    spellCheck={false}
                  />
                </div>
                <div className="soul-editor-actions">
                  <button
                    type="button"
                    className="zcode-btn-danger small"
                    onClick={handleDelete}
                    disabled={selected.isDefault}
                    title={selected.isDefault ? t("souls.cannotDeleteDefault") : t("souls.deleteThisSoul")}
                  >
                    {t("souls.deleteSoul")}
                  </button>
                  <div style={{ flex: 1 }} />
                  <button
                    type="button"
                    className={`btn-secondary ${selected.folder === activeSoul ? "active" : ""}`}
                    disabled={selected.folder === activeSoul}
                    onClick={() => onActivate(selected.folder)}
                    title={t("souls.activateHint")}
                  >
                    {selected.folder === activeSoul ? t("souls.activating") : t("souls.activate")}
                  </button>
                  <button type="button" className="btn-primary" disabled={saving || !dirty} onClick={handleSave}>
                    {saving ? t("souls.saving") : t("souls.save")}
                  </button>
                </div>
              </>
            ) : (
              <div className="list-empty-item">{t("souls.noSouls")}</div>
            )}
          </div>
        </div>
      </div>

      {/* Nested dialogs must not bubble clicks to the outer backdrop */}
      {dialog && (
        <div onClick={(e) => e.stopPropagation()}>
          <AppDialog request={dialog} onClose={() => setDialog(null)} />
        </div>
      )}
    </div>
  );
}
