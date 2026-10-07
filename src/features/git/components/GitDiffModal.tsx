import React from "react";
import { DiffModalState } from "../types";

export type GitDiffModalProps = {
  diffModal: DiffModalState;
  onClose: () => void;
};

export const GitDiffModal: React.FC<GitDiffModalProps> = ({ diffModal, onClose }) => {
  return (
    <div className="git-diff-modal-backdrop" onClick={onClose}>
      <div className="git-diff-modal" onClick={(e) => e.stopPropagation()}>
        <div className="git-diff-header">
          <div className="git-diff-title truncate">
            <span className="git-diff-type">{diffModal.staged ? "STAGED" : "CHANGES"}</span>
            <span>{diffModal.filePath}</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <pre className="git-diff-content">
          {diffModal.diff.split("\n").map((line, idx) => {
            const isAdd = line.startsWith("+") && !line.startsWith("+++");
            const isDel = line.startsWith("-") && !line.startsWith("---");
            const isHunk = line.startsWith("@@");
            return (
              <div
                key={idx}
                className={`git-diff-line ${isAdd ? "add" : isDel ? "del" : isHunk ? "hunk" : ""}`}
              >
                {line}
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
};
