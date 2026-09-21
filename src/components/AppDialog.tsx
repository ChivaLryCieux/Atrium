import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export type AppDialogRequest = {
  kind: "confirm" | "alert";
  title: string;
  message: string;
  tone?: "default" | "danger";
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
};

type AppDialogProps = {
  request: AppDialogRequest;
  onClose: () => void;
};

export function AppDialog({ request, onClose }: AppDialogProps) {
  const { t } = useTranslation();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const action = request.onConfirm;
        onClose();
        action?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [request, onClose]);

  const danger = request.tone === "danger";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog dialog-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{request.title}</span>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="dialog-message">{request.message}</div>
        </div>
        <div className="modal-footer">
          {request.kind === "confirm" && (
            <button type="button" className="btn-secondary" onClick={onClose}>
              {request.cancelText ?? t("dialog.cancel")}
            </button>
          )}
          <button
            type="button"
            className={danger ? "btn-danger" : "btn-primary"}
            onClick={() => {
              const action = request.onConfirm;
              onClose();
              action?.();
            }}
          >
            {request.confirmText ?? (request.kind === "confirm" ? t("dialog.confirm") : t("dialog.gotIt"))}
          </button>
        </div>
      </div>
    </div>
  );
}
