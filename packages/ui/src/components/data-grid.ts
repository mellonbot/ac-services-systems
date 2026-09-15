import { DataGridSpec } from "../component.ts";
import { html, admits, type ComponentChildren, type ViewProps, type VNode } from "../render.ts";

export type SortDir = "asc" | "desc";
export type Sort = { readonly key: string; readonly dir: SortDir };

export type Column<Row> = {
  readonly key: string;
  readonly header: string;
  /** Defaults to `String(row[key])`. */
  readonly cell?: (row: Row) => ComponentChildren;
  readonly align?: "start" | "end";
  readonly sortable?: boolean;
};

export type DataGridProps<Row> = {
  readonly columns: readonly Column<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  readonly sort?: Sort;
  /** Called with the next sort when a sortable header is activated; the caller owns the order. */
  readonly onSort?: (next: Sort) => void;
  readonly onSelect?: (row: Row) => void;
  readonly selectedKey?: string;
  readonly emptyText?: string;
  readonly caption?: string;
};

/**
 * Forty rows, scanned with a mouse or a keyboard. Sorting is the caller's:
 * the grid announces the wish and renders whatever rows it is handed, so the
 * order on screen is the order the caller (and its tests) decided. Rows are
 * real `<tr>`s in a real `<table>` — a dispatcher's screen reader and a
 * contract administrator's Ctrl+F both work on it without our help.
 *
 * No field variant. The spec says why.
 */
const view = <Row,>(p: ViewProps<typeof DataGridSpec, DataGridProps<Row>>): VNode => {
  if (!admits(DataGridSpec, p.density)) throw new Error(`DataGrid has no ${String(p.density)} variant — admitted: ${DataGridSpec.densities.join(", ")}.`);
  const cell = (row: Row, c: Column<Row>): ComponentChildren =>
    c.cell ? c.cell(row) : String((row as Record<string, unknown>)[c.key] ?? "");
  const nextSort = (c: Column<Row>): Sort =>
    p.sort?.key === c.key ? { key: c.key, dir: p.sort.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: "asc" };
  const ariaSort = (c: Column<Row>) => (p.sort?.key === c.key ? (p.sort.dir === "asc" ? "ascending" : "descending") : "none");

  return html`<table class="ac-grid" data-density=${p.density}>
    ${p.caption ? html`<caption class="ac-grid__caption">${p.caption}</caption>` : null}
    <thead><tr>
      ${p.columns.map((c) => html`<th scope="col" class="ac-grid__th" data-align=${c.align ?? "start"} aria-sort=${ariaSort(c)}>
        ${c.sortable && p.onSort
          ? html`<button type="button" class="ac-grid__sort" onClick=${() => p.onSort?.(nextSort(c))}>${c.header}<span aria-hidden="true" class="ac-grid__sortmark">${p.sort?.key === c.key ? (p.sort.dir === "asc" ? " ▲" : " ▼") : ""}</span></button>`
          : c.header}
      </th>`)}
    </tr></thead>
    <tbody>
      ${p.rows.length === 0
        ? html`<tr class="ac-grid__empty"><td colspan=${p.columns.length}>${p.emptyText ?? "Nothing to show."}</td></tr>`
        : p.rows.map((row) => {
            const k = p.rowKey(row);
            const selected = p.selectedKey !== undefined && p.selectedKey === k;
            return html`<tr key=${k} class="ac-grid__row" data-selected=${selected ? "true" : "false"}
              tabindex=${p.onSelect ? 0 : undefined}
              onClick=${p.onSelect ? () => p.onSelect?.(row) : undefined}
              onKeyDown=${p.onSelect ? (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); p.onSelect?.(row); } } : undefined}>
              ${p.columns.map((c) => html`<td class="ac-grid__td" data-align=${c.align ?? "start"}>${cell(row, c)}</td>`)}
            </tr>`;
          })}
    </tbody>
  </table>`;
};

/**
 * Generic, so it is not built through `component()`; the spec is attached the
 * same way and the `density` prop is typed the same way (ViewProps). A tagged
 * template cannot carry a type argument, so `Row` is inferred from `rows`.
 */
export const DataGrid = Object.assign(view, { spec: DataGridSpec });
