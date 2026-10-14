/**
 * S3's LAYOUT. Roles and density variables only, same discipline as S2_CSS —
 * the guard fails a colour literal here as it does in packages/ui. Component
 * styling lives in packages/ui UI_CSS; this is the arrangement of the board
 * and the dispatch screen around it.
 */
export const S3_CSS = `
.s3-app{display:flex;flex-direction:column;gap:var(--space-3)}
.s3-notice{display:flex;gap:var(--space-3);align-items:baseline;padding:var(--space-2) var(--space-3);background:var(--color-surface-sunken);border:1px solid var(--color-status-at-risk);border-radius:var(--radius-control)}
.s3-notice p{margin:0}
.s3-notice__dismiss{appearance:none;background:none;border:0;margin-inline-start:auto;cursor:pointer;color:var(--color-text-muted);padding:0 var(--space-2)}
.s3-h1{margin:0 0 var(--space-4);font-size:var(--text-xl)}
.s3-h2{margin:var(--space-4) 0 var(--space-2);font-size:var(--text-lg)}
.s3-loading,.s3-empty,.s3-muted{color:var(--color-text-muted)}
.s3-row-actions{display:inline-flex;gap:var(--space-3);white-space:nowrap}
.s3-login{max-width:40ch;margin:10vh auto 0}
.s3-job-facts{display:grid;grid-template-columns:auto 1fr;gap:var(--space-2) var(--space-4);margin:0 0 var(--space-4);align-items:baseline}
.s3-job-facts dt{color:var(--color-text-muted);font-size:var(--text-sm)}
.s3-job-facts dd{margin:0}
.s3-candidates{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-2)}
.s3-candidate{display:flex;align-items:center;gap:var(--space-4);padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-card)}
.s3-candidate__label{flex:1}
@media (max-width:760px){.s3-candidate{flex-wrap:wrap}}

/* ---- Rev A (Bulletin No. 2 Rev A): the reference layout's shape — radii and elevation from tokens, colours unchanged ---- */
.s3-h1{font-family:var(--font-display);font-size:var(--text-display);font-weight:800;letter-spacing:var(--track-tight);text-transform:none;line-height:1.15}
.s3-h2{font-family:var(--font-display);font-weight:700;letter-spacing:var(--track-tight);text-transform:none}

.s3-map-layout{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(20rem,1fr);gap:var(--space-4);align-items:stretch}
.s3-map-scene,.s3-map-jobs{min-width:0;border:1px solid var(--color-border);border-radius:var(--radius-card);background:var(--color-surface);box-shadow:var(--elevation-card)}
.s3-map-scene{overflow:hidden}
.s3-map-scene__top,.s3-map-jobs__head{display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--color-border)}
.s3-map-scene__top .s3-h2,.s3-map-jobs__head .s3-h2{margin:0}
.s3-map-scene__top p,.s3-map-jobs__head span{margin:var(--space-1) 0 0;color:var(--color-text-muted);font-size:var(--text-sm)}
.s3-map-scene__badge{padding:var(--space-1) var(--space-2);border:1px solid var(--color-status-blocked);border-radius:var(--radius-pill);color:var(--color-status-blocked);font-size:var(--text-xs);font-weight:700;white-space:nowrap}
.s3-map-scene__art{position:relative;min-height:34rem;overflow:hidden;background:var(--color-page)}
.s3-map-lines{position:absolute;inset:0;width:100%;height:100%}
.s3-map-lines path:first-child{fill:none;stroke:var(--color-border-hard);stroke-width:15;stroke-linecap:round}
.s3-map-lines path:nth-child(2){fill:none;stroke:var(--color-surface);stroke-width:11;stroke-linecap:round}
.s3-map-lines path:last-child{fill:none;stroke:var(--color-border);stroke-width:1}
.s3-map-scene__blocks{position:absolute;inset:0}
.s3-map-scene__blocks span{position:absolute;display:block;width:11%;height:11%;border:1px solid var(--color-border);border-radius:var(--radius-control);background:var(--color-surface)}
.s3-map-scene__blocks span:nth-child(1){left:10%;top:12%;width:13%;height:14%}
.s3-map-scene__blocks span:nth-child(2){right:12%;top:11%;width:15%;height:13%}
.s3-map-scene__blocks span:nth-child(3){left:17%;bottom:19%;width:14%;height:12%}
.s3-map-scene__blocks span:nth-child(4){right:18%;bottom:17%;width:12%;height:14%}
.s3-map-scene__blocks span:nth-child(5){left:3%;top:51%;width:9%;height:12%}
.s3-map-scene__blocks span:nth-child(6){right:4%;top:45%;width:10%;height:13%}
.s3-map-scene__blocks span:nth-child(7){left:48%;top:4%;width:9%;height:8%}
.s3-shop{position:absolute;left:50%;top:44%;width:min(58%,24rem);margin:0;transform:translate(-50%,-50%);text-align:center}
.s3-shop-model{display:block;width:100%;height:auto;overflow:visible}
.s3-shop-model__sign{fill:var(--color-text);font-family:var(--font-label);font-size:var(--text-xs);font-weight:700;letter-spacing:var(--track-wide)}
.s3-shop figcaption{display:flex;flex-direction:column;gap:var(--space-1);color:var(--color-text)}
.s3-shop figcaption span{color:var(--color-text-muted);font-size:var(--text-xs)}
.s3-map-notice{position:absolute;left:var(--space-3);bottom:var(--space-3);display:flex;flex-direction:column;gap:var(--space-1);width:min(27rem,calc(100% - var(--space-6)));padding:var(--space-3);border:1px solid var(--color-border-hard);border-radius:var(--radius-control);background:var(--color-surface)}
.s3-map-notice strong{font-size:var(--text-sm)}
.s3-map-notice span{color:var(--color-text-muted);font-size:var(--text-sm);line-height:1.45}
.s3-map-scale{position:absolute;right:var(--space-3);bottom:var(--space-3);display:flex;align-items:center;gap:var(--space-1);color:var(--color-text-muted);font-size:var(--text-xs)}
.s3-map-scale span{width:1rem;border-top:1px solid var(--color-text-muted)}
.s3-map-jobs{display:flex;flex-direction:column;min-height:34rem;overflow:hidden}
.s3-map-jobs__head{align-items:flex-start}
.s3-map-jobs__head>div:first-child{display:flex;flex-direction:column;min-width:0}
.s3-map-filters{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:var(--space-1)}
.s3-map-filters button{appearance:none;min-height:var(--control-height);padding-inline:var(--space-2);border:1px solid var(--color-border);border-radius:var(--radius-control);background:var(--color-surface);color:var(--color-action-text);font:inherit;font-size:var(--text-xs);font-weight:600;cursor:pointer}
.s3-map-filters button[data-current="true"]{border-color:var(--color-action-text);background:var(--color-surface-sunken);color:var(--color-text)}
.s3-map-filters button:focus-visible{outline:2px solid var(--color-focus-ring);outline-offset:2px}
.dispatch-dashboard{background:var(--color-page);color:var(--color-text);padding:0 0 var(--space-4)}
.dispatch-dashboard__shell{max-width:1400px;margin:0 auto;padding:0 0 32px}
.dispatch-header{display:flex;align-items:center;gap:16px;padding:10px 16px;border:1px solid color-mix(in srgb,var(--color-brand) 70%,var(--color-border));border-radius:var(--radius-card);background:linear-gradient(180deg,#0f1114 0%,#080b0d 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,0.08)}
.dispatch-header__nav{display:flex;align-items:center;gap:8px;flex:1;flex-wrap:wrap}
.dispatch-header__tab{appearance:none;border:0;background:transparent;color:rgba(255,255,255,0.8);padding:8px 12px;border-radius:var(--radius-control);font-family:var(--font-label);font-size:12px;cursor:pointer}
.dispatch-header__tab.is-active{background:rgba(255,255,255,0.08);color:var(--color-brand-ink);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.14)}
.dispatch-header__tools{display:flex;align-items:center;gap:8px;margin-left:auto}
.dispatch-header__logout{appearance:none;border:1px solid rgba(255,255,255,0.18);border-radius:var(--radius-control);background:var(--color-brand-ink);color:var(--color-text);padding:8px 10px;font-family:var(--font-label);font-size:12px;cursor:pointer;border-color:rgba(255,255,255,0.12)}
.dispatch-dashboard__title-row{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin:8px 0 18px}
.dispatch-dashboard__title-row h1{margin:0;color:var(--color-text);font-family:var(--font-display);font-size:42px;line-height:1.05;letter-spacing:-0.03em}
.dispatch-dashboard__title-row p{margin:6px 0 0;color:var(--color-text-muted);max-width:720px;font-size:14px}
.dispatch-dashboard__date-controls{display:flex;gap:8px;align-items:center}
.dispatch-dashboard__date{appearance:none;border:1px solid var(--color-border);border-radius:var(--radius-control);background:var(--color-surface);color:var(--color-text-muted);padding:7px 12px;font-family:var(--font-label);font-size:12px;cursor:pointer}
.dispatch-dashboard__date.is-active{background:var(--color-surface-sunken);color:var(--color-text);border-color:var(--color-border-hard)}
.dispatch-dashboard__stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:18px}
.dispatch-stat{display:flex;flex-direction:column;justify-content:center;min-height:84px;padding:10px 18px;border:1px solid var(--color-border);border-radius:var(--radius-card);background:var(--color-surface-sunken);color:var(--color-text)}
.dispatch-stat__value{font-family:var(--font-display);font-size:16px;font-weight:700;line-height:1.1}
.dispatch-stat__label{margin-top:6px;font-family:var(--font-label);font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:var(--color-text-muted)}
.dispatch-stat[data-tone="warn"]{background:rgba(122,42,46,0.16)}
.dispatch-stat[data-tone="success"]{background:rgba(14,106,70,0.12)}
.dispatch-dashboard__board{border:1px solid var(--color-border);border-radius:var(--radius-card);background:var(--color-surface);box-shadow:var(--elevation-card);overflow:hidden}
.dispatch-board__header{display:grid;grid-template-columns:220px 1fr;align-items:center;padding:10px 16px;border-bottom:1px solid var(--color-border);background:var(--color-surface-sunken)}
.dispatch-board__label{font-family:var(--font-label);font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:var(--color-text-muted)}
.dispatch-board__hours{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:0;font-family:var(--font-label);font-size:11px;color:var(--color-text-muted);text-transform:uppercase}
.dispatch-board__hours span{padding:0 4px;text-align:center}
.dispatch-board__row{display:grid;grid-template-columns:220px 1fr;border-bottom:1px solid var(--color-border);min-height:64px;background:rgba(8,13,17,0.06)}
.dispatch-board__tech{display:flex;align-items:center;gap:10px;padding:14px 12px;border-right:1px solid var(--color-border);background:rgba(17,26,32,0.08)}
.dispatch-board__avatar{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:var(--color-brand);color:var(--color-brand-ink);font-family:var(--font-label);font-size:10px;font-weight:700}
.dispatch-board__meta{display:flex;flex-direction:column;min-width:0}
.dispatch-board__meta strong{font-family:var(--font-label);font-size:14px;color:var(--color-text)}
.dispatch-board__meta small{font-family:var(--font-label);font-size:11px;color:var(--color-text-muted)}
.dispatch-board__calendar{position:relative;min-height:64px;background-image:linear-gradient(to right, rgba(255,255,255,0.02) 1px, transparent 1px);background-size:10% 100%;}
.dispatch-board__segment{position:absolute;top:12px;bottom:12px;display:flex;align-items:center;justify-content:space-between;padding:4px 8px;border-radius:6px;overflow:hidden;border:1px solid transparent;color:var(--color-text);font-family:var(--font-label);font-size:12px;font-weight:700;background:rgba(255,255,255,0.04)}
.dispatch-board__segment span{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:500;color:var(--color-text-muted)}
.dispatch-board__segment[data-tone="breached"]{background:rgba(122,42,46,0.42);border-color:rgba(228,236,242,0.7)}
.dispatch-board__segment[data-tone="idle"]{background:rgba(136,147,157,0.08)}
.dispatch-dashboard__legend{display:flex;flex-wrap:wrap;gap:10px 18px;padding:14px 14px 0;margin-top:18px;border-top:1px solid var(--color-border);font-family:var(--font-label);font-size:11px;color:var(--color-text-muted)}
.dispatch-legend__item{display:inline-flex;align-items:center;gap:8px;padding:2px 0}
.dispatch-legend__item::before{content:"";display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--color-status-blocked);opacity:0.9}
.dispatch-legend__item[data-tone="scheduled"]::before{background:var(--color-status-ok)}
.dispatch-legend__item[data-tone="completed"]::before{background:var(--color-status-blocked)}
.dispatch-legend__item[data-tone="warn"]::before{background:var(--color-status-breached)}
.dispatch-legend__item[data-tone="waiting"]::before{background:var(--color-status-at-risk)}
.dispatch-legend__item[data-tone="neutral"]::before{background:var(--color-border-hard)}

.s3-map-job-list{display:flex;flex-direction:column;gap:0;overflow:auto;list-style:none;margin:0;padding:0}.s3-map-job{display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--color-border)}
.s3-map-job__main{display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-2)}
.s3-map-job__site{font-weight:700}
.s3-map-job__service,.s3-map-job__state{color:var(--color-text-muted);font-size:var(--text-sm);text-transform:capitalize}
.s3-map-job__assignment{display:flex;justify-content:space-between;align-items:center;gap:var(--space-2);min-height:var(--row-height)}
.s3-map-job__crew{display:flex;align-items:center;gap:var(--space-2);font-weight:600}
.s3-truck-model{display:block;width:4.75rem;height:auto;flex:none}
.s3-truck-model__mark{fill:var(--color-text);font-family:var(--font-label);font-size:var(--text-xs);font-weight:700}
.s3-map-job__unassigned{color:var(--color-status-at-risk);font-weight:600}
.s3-map-job__location{color:var(--color-text-muted);font-size:var(--text-xs);text-align:end}
.s3-map-job__footer{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap}
.s3-map-job__footer .s3-row-actions{margin-inline-start:auto}
.s3-map-job__footer .ac-action,.s3-map-job__footer .ac-action-wrap{min-height:var(--control-height)}
.s3-map-empty{display:flex;flex:1;flex-direction:column;justify-content:center;gap:var(--space-2);padding:var(--space-6);color:var(--color-text-muted);text-align:center}
.s3-map-empty strong{color:var(--color-text)}
@media(max-width:980px){.s3-map-layout{grid-template-columns:minmax(0,1fr)}.s3-map-jobs{min-height:0;max-height:40rem}}
@media(max-width:600px){
  .s3-map-scene__top,.s3-map-jobs__head{align-items:flex-start;flex-direction:column}
  .s3-map-scene__art{min-height:30rem}
  .s3-map-scene__blocks span{opacity:.65}
  .s3-shop{top:40%;width:76%}
  .s3-map-notice{bottom:var(--space-2);left:var(--space-2);width:calc(100% - var(--space-4))}
  .s3-map-scale{display:none}
  .s3-map-filters{justify-content:flex-start}
  .s3-map-job__main,.s3-map-job__assignment{align-items:flex-start;flex-direction:column}
  .s3-map-job__location{text-align:start}
}
`;
