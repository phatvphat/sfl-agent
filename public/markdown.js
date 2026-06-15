export function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFormat(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

function isTableRow(line) {
  return /^\s*\|.+\|\s*$/.test(line);
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isTableSeparator(line) {
  return /^\s*\|?[\s\-:|]+\|?\s*$/.test(line) && line.includes("-");
}

function renderTable(lines) {
  if (lines.length < 2) return `<p>${inlineFormat(lines.join("\n"))}</p>`;

  const headers = parseTableRow(lines[0]);
  const bodyStart = isTableSeparator(lines[1]) ? 2 : 1;
  const rows = lines.slice(bodyStart).map(parseTableRow);

  let html = '<div class="table-wrap"><table><thead><tr>';
  for (const h of headers) html += `<th>${inlineFormat(h)}</th>`;
  html += "</tr></thead><tbody>";
  for (const row of rows) {
    html += "<tr>";
    for (let i = 0; i < headers.length; i++) {
      html += `<td>${inlineFormat(row[i] ?? "")}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table></div>";
  return html;
}

function renderList(lines, ordered) {
  const tag = ordered ? "ol" : "ul";
  let html = `<${tag}>`;
  for (const line of lines) {
    const content = ordered
      ? line.replace(/^\s*\d+\.\s+/, "")
      : line.replace(/^\s*[-*+]\s+/, "");
    html += `<li>${inlineFormat(content)}</li>`;
  }
  html += `</${tag}>`;
  return html;
}

/**
 * Render common Markdown (headings, tables, lists, code, links) to HTML.
 */
export function renderMarkdown(source) {
  if (!source?.trim()) return "";

  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const parts = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      const code = escapeHtml(codeLines.join("\n"));
      parts.push(`<pre><code${lang ? ` class="lang-${lang}"` : ""}>${code}</code></pre>`);
      continue;
    }

    if (/^#{1,3}\s+/.test(line)) {
      const level = line.match(/^#+/)[0].length;
      const text = line.replace(/^#+\s+/, "");
      parts.push(`<h${level}>${inlineFormat(text)}</h${level}>`);
      i++;
      continue;
    }

    if (isTableRow(line)) {
      const tableLines = [];
      while (i < lines.length && (isTableRow(lines[i]) || isTableSeparator(lines[i]))) {
        tableLines.push(lines[i]);
        i++;
      }
      parts.push(renderTable(tableLines));
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const listLines = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        listLines.push(lines[i]);
        i++;
      }
      parts.push(renderList(listLines, false));
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const listLines = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        listLines.push(lines[i]);
        i++;
      }
      parts.push(renderList(listLines, true));
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      parts.push("<hr>");
      i++;
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !/^#{1,3}\s/.test(lines[i]) && !isTableRow(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i]) && !lines[i].trim().startsWith("```")) {
      para.push(lines[i]);
      i++;
    }
    parts.push(`<p>${inlineFormat(para.join(" "))}</p>`);
  }

  return parts.join("\n");
}
