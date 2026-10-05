import React, { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Project } from "../types/chat";
import { Markdown } from "./Markdown";

export interface WorkspaceEntryItem {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
  children?: WorkspaceEntryItem[];
}

interface WorkspaceTreePanelProps {
  projectId: string;
  project?: Project | null;
  workspacePath: string;
  width?: number;
  onClose: () => void;
}

export const WorkspaceTreePanel: React.FC<WorkspaceTreePanelProps> = ({
  project,
  workspacePath,
  width = 280,
  onClose,
}) => {
  const { t } = useTranslation();
  const [treeData, setTreeData] = useState<WorkspaceEntryItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(false);
  const [copiedPath, setCopiedPath] = useState<boolean>(false);

  // Compute root project directory
  const rootDir = useMemo(() => {
    return (
      project?.defaultDirectory ||
      (project?.directories && project.directories[0]) ||
      workspacePath
    );
  }, [project, workspacePath]);

  // Load tree
  const fetchTree = async () => {
    if (!rootDir) return;
    setIsLoading(true);
    try {
      const result = await invoke<WorkspaceEntryItem[]>("read_workspace_tree", {
        root: rootDir,
        maxDepth: 4,
      });
      setTreeData(result || []);
      // Default expand root directories
      const initialExpanded = new Set<string>();
      for (const item of result || []) {
        if (item.isDir) {
          initialExpanded.add(item.path);
        }
      }
      setExpandedPaths(initialExpanded);
    } catch (err) {
      console.error("Failed to read workspace tree:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTree();
    setSelectedFilePath(null);
    setPreviewContent(null);
  }, [rootDir]);

  const toggleFolder = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleSelectFile = async (path: string) => {
    setSelectedFilePath(path);
    setIsLoadingPreview(true);
    try {
      const content = await invoke<string>("read_file_preview", {
        path,
        maxBytes: 150 * 1024, // 150KB
      });
      setPreviewContent(content);
    } catch (err) {
      setPreviewContent(`[无法读取文件预览: ${String(err)}]`);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleRevealInExplorer = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("open_path_in_explorer", { path });
    } catch (err) {
      console.warn("Could not reveal file:", err);
    }
  };

  const handleCopyPath = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(path).then(() => {
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 1800);
    });
  };

  // Helper to determine file type icon/badge
  const getFileBadge = (filename: string) => {
    const ext = filename.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "ts":
      case "tsx":
        return <span className="ext-badge ts">TS</span>;
      case "js":
      case "jsx":
        return <span className="ext-badge js">JS</span>;
      case "rs":
        return <span className="ext-badge rs">RS</span>;
      case "json":
        return <span className="ext-badge json">{}</span>;
      case "md":
        return <span className="ext-badge md">MD</span>;
      case "css":
        return <span className="ext-badge css">CSS</span>;
      case "html":
        return <span className="ext-badge html">&lt;&gt;</span>;
      case "yml":
      case "yaml":
        return <span className="ext-badge yml">YML</span>;
      default:
        return (
          <svg className="file-svg-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        );
    }
  };

  // Render tree node recursively
  const renderNode = (item: WorkspaceEntryItem, level = 0) => {
    const isExpanded = expandedPaths.has(item.path);
    const isSelected = selectedFilePath === item.path;

    if (item.isDir) {
      return (
        <div key={item.path} className="tree-node-group">
          <div
            className="tree-node-row dir-row"
            style={{ paddingLeft: `${level * 14 + 10}px` }}
            onClick={(e) => toggleFolder(item.path, e)}
          >
            <span className="tree-chevron">
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                style={{
                  transform: isExpanded ? "rotate(90deg)" : "none",
                  transition: "transform 0.15s ease",
                }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </span>
            <span className="tree-dir-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <span className="tree-node-name truncate">{item.name}</span>
          </div>

          {isExpanded && item.children && item.children.length > 0 && (
            <div className="tree-children-container">
              {item.children.map((child) => renderNode(child, level + 1))}
            </div>
          )}
        </div>
      );
    }

    // File row
    return (
      <div
        key={item.path}
        className={`tree-node-row file-row ${isSelected ? "selected" : ""}`}
        style={{ paddingLeft: `${level * 14 + 22}px` }}
        onClick={() => handleSelectFile(item.path)}
        title={item.name}
      >
        <span className="tree-file-badge">{getFileBadge(item.name)}</span>
        <span className="tree-node-name truncate">{item.name}</span>
      </div>
    );
  };

  return (
    <aside className="workspace-tree-panel" style={{ width: `${width}px` }}>
      {/* Panel Header */}
      <div className="workspace-tree-header">
        <div className="tree-header-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
          <span className="tree-panel-title">{t("workspace.filesTitle")}</span>
        </div>

        <div className="tree-header-right">
          <button
            type="button"
            className="icon-btn"
            title={t("workspace.refresh")}
            onClick={fetchTree}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t("common.close")}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Main tree list */}
      <div className="workspace-tree-body">
        {isLoading ? (
          <div className="tree-status-hint">{t("workspace.loading")}</div>
        ) : treeData.length === 0 ? (
          <div className="tree-status-hint">{t("workspace.empty")}</div>
        ) : (
          <div className="tree-content-list">
            {treeData.map((item) => renderNode(item))}
          </div>
        )}
      </div>

      {/* Quick floating Preview Drawer / Inspector if file is selected */}
      {selectedFilePath && (
        <div className="file-quick-preview-pane">
          <div className="preview-pane-header">
            <div className="preview-header-meta">
              <span className="preview-filename truncate">
                {selectedFilePath.split(/[\\/]/).pop()}
              </span>
            </div>
            <div className="preview-pane-actions">
              <button
                type="button"
                className="icon-btn"
                title={t("deliverable.copyPath")}
                onClick={(e) => handleCopyPath(selectedFilePath, e)}
              >
                {copiedPath ? (
                  <span style={{ fontSize: "10px" }}>✓</span>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                className="icon-btn"
                title={t("deliverable.openInExplorer")}
                onClick={(e) => handleRevealInExplorer(selectedFilePath, e)}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSelectedFilePath(null)}
              >
                ✕
              </button>
            </div>
          </div>
          <div className="preview-pane-content">
            {isLoadingPreview ? (
              <div className="preview-loading-hint">{t("workspace.loading")}</div>
            ) : selectedFilePath.endsWith(".md") && previewContent ? (
              <div className="preview-markdown-wrapper">
                <Markdown text={previewContent} />
              </div>
            ) : (
              <pre className="preview-code-pre">{previewContent}</pre>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
