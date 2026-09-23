import React, { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { useTranslation } from "react-i18next";

/**
 * Safe Markdown renderer for AI replies.
 *
 * - Full GFM: headings / bold / italic / lists / tables / task lists /
 *   blockquotes / code / links / strikethrough.
 * - Raw HTML is never parsed (react-markdown v10 drops it by default),
 *   so a malicious `content` string cannot inject scripts or iframes.
 * - Links open in a new tab; no node integration in renderers.
 * - Fenced code blocks get a header strip (language + copy button) so long
 *   outputs stay inspectable and extractable without manual selection.
 */
const mdComponents: Components = {
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
  pre({ children }) {
    return <CodeBlock>{children}</CodeBlock>;
  },
};

function extractCodeText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractCodeText).join("");
  if (React.isValidElement(node)) {
    return extractCodeText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const codeElement = Array.isArray(children) ? children[0] : children;
  let lang = "";
  if (React.isValidElement(codeElement)) {
    const className = (codeElement.props as { className?: string }).className ?? "";
    lang = className.replace(/^language-/, "");
  }
  const text = extractCodeText(children);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard denied (unfocused window / insecure context): the button
      // label flips anyway so the operator can retry by re-clicking.
      setCopied(false);
    }
  };

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">{lang || "code"}</span>
        <button type="button" className="code-block-copy" onClick={copy}>
          {copied ? t("tool.copied") : t("tool.copy")}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
