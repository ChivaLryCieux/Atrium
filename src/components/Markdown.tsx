import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

/**
 * Safe Markdown renderer for AI replies.
 *
 * - Full GFM: headings / bold / italic / lists / tables / task lists /
 *   blockquotes / code / links / strikethrough.
 * - Raw HTML is never parsed (react-markdown v10 drops it by default),
 *   so a malicious `content` string cannot inject scripts or iframes.
 * - Links open in a new tab; no node integration in renderers.
 */
const mdComponents: Components = {
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
