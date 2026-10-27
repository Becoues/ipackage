import type { ReactNode } from "react";

/**
 * 极简 Markdown → React 渲染，覆盖 release notes 常见语法：
 * 标题、列表、代码块、引用、行内代码/粗体/链接。不走 innerHTML，天然防 XSS。
 */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  let i = 0;

  const flushList = () => {
    if (list.length) out.push(<ul key={`ul${out.length}`}>{list}</ul>);
    list = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      flushList();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      out.push(<pre key={`c${i}`} className="md-code">{code.join("\n")}</pre>);
      i++;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const li = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
    if (h) {
      flushList();
      const level = Math.min(h[1].length + 2, 6); // 降两级，避免抢抽屉标题
      const Tag = `h${level}` as "h3";
      out.push(<Tag key={i}>{inline(h[2])}</Tag>);
    } else if (li) {
      list.push(<li key={i}>{inline(li[1])}</li>);
    } else if (line.startsWith(">")) {
      flushList();
      out.push(<blockquote key={i}>{inline(line.replace(/^>\s?/, ""))}</blockquote>);
    } else if (line.trim()) {
      flushList();
      out.push(<p key={i}>{inline(line)}</p>);
    } else {
      flushList();
    }
    i++;
  }
  flushList();
  return <div className="md">{out}</div>;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s)]+)/g;

function inline(s: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const t = m[0];
    const k = m.index;
    if (m[1]) parts.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (m[2]) parts.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (m[3]) {
      const [, label, href] = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
      parts.push(link(k, href, label));
    } else parts.push(link(k, t, t.replace(/^https?:\/\/(www\.)?github\.com\//, "")));
    last = k + t.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}

function link(key: number, href: string, label: string) {
  // 只放行 http(s)，挡掉 javascript: 之类
  if (!/^https?:\/\//.test(href)) return <span key={key}>{label}</span>;
  return (
    <a key={key} href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}
