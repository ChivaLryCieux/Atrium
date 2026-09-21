import React from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./locales";
import "./styles.css";

function LocalizedRoot() {
  const { t } = useTranslation();
  return (
    <ErrorBoundary fallback={<div className="error-boundary">{t("app.errorFallback")}</div>}>
      <App />
    </ErrorBoundary>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocalizedRoot />
  </React.StrictMode>,
);
