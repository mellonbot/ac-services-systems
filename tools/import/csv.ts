/**
 * RFC 4180 CSV, as a spreadsheet exports it: comma-separated, a field in
 * double quotes may hold commas, line breaks and doubled quotes; CRLF or LF;
 * a UTF-8 byte-order mark is dropped. Every row carries the physical line it
 * started on, so a reject can be found in the file by the person who made it.
 *
 * The first row is the header. Header names are trimmed and lower-cased;
 * values are trimmed. A row whose fields are all empty is skipped.
 */
export type CsvRow = { readonly line: number; readonly values: Readonly<Record<string, string>> };
export type CsvFile = { readonly headers: readonly string[]; readonly rows: readonly CsvRow[] };

export class CsvError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(message);
    this.name = "CsvError";
    this.line = line;
  }
}

const records = (text: string): { line: number; fields: string[] }[] => {
  const out: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  let i = 0;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  while (i < s.length) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      if (c === "\n") line++;
      field += c; i++; continue;
    }
    if (c === '"') {
      if (field.trim() !== "") throw new CsvError(line, "a quote in the middle of a field — quote the whole field, and double any quote inside it");
      field = ""; quoted = true; i++; continue;
    }
    if (c === ",") { fields.push(field); field = ""; i++; continue; }
    if (c === "\r" || c === "\n") {
      fields.push(field); field = "";
      out.push({ line: start, fields });
      fields = [];
      i += c === "\r" && s[i + 1] === "\n" ? 2 : 1;
      line++; start = line;
      continue;
    }
    field += c; i++;
  }
  if (quoted) throw new CsvError(start, "a quoted field is never closed");
  if (field !== "" || fields.length > 0) { fields.push(field); out.push({ line: start, fields }); }
  return out;
};

export const parseCsv = (text: string): CsvFile => {
  const all = records(text).filter((r) => r.fields.some((f) => f.trim() !== ""));
  const head = all[0];
  if (!head) throw new CsvError(1, "the file is empty — the first row is the header");
  const headers = head.fields.map((h) => h.trim().toLowerCase());
  const seen = new Set<string>();
  for (const h of headers) {
    if (!h) throw new CsvError(head.line, "a header column is blank");
    if (seen.has(h)) throw new CsvError(head.line, `the header names "${h}" twice`);
    seen.add(h);
  }
  const rows = all.slice(1).map((r) => {
    if (r.fields.length > headers.length) throw new CsvError(r.line, `${r.fields.length} fields, but the header has ${headers.length}`);
    return { line: r.line, values: Object.fromEntries(headers.map((h, i) => [h, (r.fields[i] ?? "").trim()])) };
  });
  return { headers, rows };
};
