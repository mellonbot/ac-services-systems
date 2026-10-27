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
.s3-notice__dismiss{min-height:var(--control-height);appearance:none;background:none;border:0;margin-inline-start:auto;cursor:pointer;color:var(--color-text-muted);padding:0 var(--space-2)}
.s3-loading,.s3-empty,.s3-muted{color:var(--color-text-muted)}
.s3-row-actions{display:inline-flex;gap:var(--space-3);white-space:nowrap}
.s3-detail-actions{margin:var(--space-2) 0 0;display:flex;gap:var(--space-3);align-items:center}
.s3-link-action{display:inline-flex;align-items:center;text-decoration:none}
.s3-confirm{display:flex;flex-direction:column;gap:var(--space-1);max-width:var(--measure-short);margin-top:var(--space-2);padding:var(--space-2) var(--space-3);border:1px solid var(--color-border-hard);border-radius:var(--radius-control);background:var(--color-surface)}
.s3-confirm p{margin:0;color:var(--color-text-muted)}
.s3-preview{margin:0;padding:var(--space-2) var(--space-3);border:1px dashed var(--color-status-at-risk);border-radius:var(--radius-control);background:var(--color-surface)}
.s3-confirm--cell{margin:0;max-width:var(--measure-narrow);white-space:normal}
.s3-login{max-width:var(--measure-narrow);margin:10vh auto 0}
.s3-job-facts{display:grid;grid-template-columns:auto 1fr;gap:var(--space-2) var(--space-4);margin:0 0 var(--space-4);align-items:baseline}
.s3-job-facts dt{color:var(--color-text-muted);font-size:var(--text-sm)}
.s3-job-facts dd{margin:0}
.s3-candidates{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-2)}
.s3-candidate{display:flex;align-items:center;gap:var(--space-4);padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-card)}
.s3-candidate__label{flex:1}
@media (max-width:760px){.s3-candidate{flex-wrap:wrap}}

/* ---- Rev A (Bulletin No. 2 Rev A): the reference layout's shape — radii and elevation from tokens, colours unchanged ---- */

.s3-map-layout{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(var(--column-side),1fr);gap:var(--space-4);align-items:stretch}
.s3-map-scene__badge{padding:var(--space-1) var(--space-2);border:1px solid var(--color-status-blocked);border-radius:var(--radius-pill);color:var(--color-status-blocked);font-size:var(--text-xs);font-weight:700;white-space:nowrap}
.s3-map-scene__art{position:relative;min-height:34rem;overflow:hidden;border-radius:var(--radius-control);background:var(--color-page)}
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
.s3-map-filters{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:var(--space-1)}
.s3-map-filters button{appearance:none;min-height:var(--control-height);padding-inline:var(--space-2);border:1px solid var(--color-border);border-radius:var(--radius-control);background:var(--color-surface);color:var(--color-action-text);font:inherit;font-size:var(--text-xs);font-weight:600;cursor:pointer}
.s3-map-filters button[data-current="true"]{border-color:var(--color-action-text);background:var(--color-surface-sunken);color:var(--color-text)}
.s3-map-filters button:focus-visible{outline:2px solid var(--color-focus-ring);outline-offset:2px}
.s3-num{font-family:var(--font-instrument);font-variant-numeric:tabular-nums}
.dispatch-header{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-4);padding:var(--space-2) var(--space-4);border:1px solid var(--color-border);border-radius:var(--radius-card);background:var(--color-surface);box-shadow:var(--elevation-card)}
.dispatch-actions{display:flex;flex-wrap:wrap;gap:var(--space-2);padding-inline:var(--space-4)}
.dispatch-header__tools{display:flex;align-items:center;gap:var(--space-2);margin-inline-start:auto}
.dispatch-header__who{color:var(--color-text-muted);font-family:var(--font-label);font-size:var(--text-sm)}
.dispatch-header__logout{min-height:var(--control-height);appearance:none;border:1px solid var(--color-border-hard);border-radius:var(--radius-control);background:var(--color-text);color:var(--color-surface);padding:var(--space-2) var(--space-3);font-family:var(--font-label);font-size:var(--text-sm);font-weight:600;cursor:pointer}
.dispatch-dashboard__date-controls{display:flex;gap:var(--space-2);align-items:center}
.dispatch-dashboard__date{min-height:var(--control-height);appearance:none;border:1px solid var(--color-border);border-radius:var(--radius-control);background:var(--color-surface);color:var(--color-text-muted);padding:var(--space-2) var(--space-3);font-family:var(--font-label);font-size:var(--text-sm);cursor:pointer}
.dispatch-dashboard__date.is-active{background:var(--color-surface-sunken);color:var(--color-text);border-color:var(--color-border-hard)}
.dispatch-dashboard__date:disabled{cursor:not-allowed;background:var(--color-surface-sunken)}
.dispatch-dashboard__board{position:relative;border:1px solid var(--color-border);border-radius:var(--radius-control);overflow:hidden}
.dispatch-board__now-track{position:absolute;top:0;bottom:0;left:var(--column-rail);right:0;z-index:1;pointer-events:none}
.dispatch-board__now{position:absolute;top:0;bottom:0;width:3px;margin-left:-1px;background:var(--color-action-text)}
.dispatch-board__now-tag{position:absolute;top:var(--space-1);left:50%;transform:translateX(-50%);padding:0 var(--space-1);border-radius:var(--radius-control);background:var(--color-action);color:var(--color-action-ink);font-family:var(--font-instrument);font-variant-numeric:tabular-nums;font-size:var(--text-xs);font-weight:700;white-space:nowrap}
.dispatch-board__header{display:grid;grid-template-columns:var(--column-rail) 1fr;align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border);background:var(--color-surface-sunken)}
.dispatch-board__label{padding-inline:var(--space-3);font-family:var(--font-label);font-size:var(--text-xs);letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.dispatch-board__hours{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:0;font-family:var(--font-instrument);font-variant-numeric:tabular-nums;font-size:var(--text-xs);color:var(--color-text-muted);text-transform:uppercase}
.dispatch-board__hours span{padding:0 var(--space-1);text-align:left}
.dispatch-board__group{padding:var(--space-1) var(--space-3);border-bottom:1px solid var(--color-border);background:var(--color-surface-sunken);font-family:var(--font-label);font-size:var(--text-xs);font-weight:700;letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.dispatch-board__group[data-kind="install"]{border-top:3px solid var(--color-text)}
.dispatch-board__row{display:grid;grid-template-columns:var(--column-rail) 1fr;border-bottom:1px solid var(--color-border);min-height:64px;background:color-mix(in srgb,var(--color-surface-sunken) 20%,var(--color-surface))}
.dispatch-board__tech{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-3);border-right:1px solid var(--color-border);background:color-mix(in srgb,var(--color-surface-sunken) 35%,var(--color-surface))}
.dispatch-board__avatar{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:var(--radius-control);background:var(--color-surface-sunken);color:var(--color-text);font-family:var(--font-label);font-size:var(--text-xs);font-weight:700}
.dispatch-board__meta{display:flex;flex-direction:column;min-width:0}
.dispatch-board__meta strong{font-family:var(--font-label);font-size:var(--text-md);color:var(--color-text)}
.dispatch-board__meta small{font-family:var(--font-label);font-size:var(--text-xs);color:var(--color-text-muted)}
.dispatch-board__calendar{position:relative;min-height:64px;background-image:linear-gradient(to right,var(--color-border) 1px,transparent 1px);background-size:10% 100%}
.dispatch-board__segment{position:absolute;top:var(--space-3);bottom:var(--space-3);display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);padding:var(--space-1) var(--space-2);border-radius:var(--radius-control);overflow:hidden;border:1px solid transparent;color:var(--color-text);font-family:var(--font-instrument);font-variant-numeric:tabular-nums;font-size:var(--text-sm);font-weight:700;background:color-mix(in srgb,var(--color-surface-sunken) 40%,transparent)}
.dispatch-board__segment span{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-label);font-size:var(--text-xs);font-weight:500;color:var(--color-text-muted)}
.dispatch-dashboard__legend{display:flex;flex-wrap:wrap;gap:var(--space-2) var(--space-4);padding:var(--space-3) 0 0;margin-top:var(--space-4);border-top:1px solid var(--color-border);font-family:var(--font-label);font-size:var(--text-xs);color:var(--color-text-muted)}
.dispatch-legend__item{display:inline-flex;align-items:center;gap:var(--space-2);padding:var(--space-1) 0}
.dispatch-legend__item::before{content:"";display:inline-block;width:10px;height:10px;box-sizing:border-box;border-radius:var(--radius-none);border:2px solid var(--color-text)}
.dispatch-legend__item[data-tone="waiting"]::before{border-style:dashed}
.dispatch-legend__item[data-tone="completed"]::before{border-style:dotted;border-color:var(--color-text-muted)}
.dispatch-legend__item[data-tone="neutral"]::before{border-color:var(--color-border-hard);background:var(--color-surface-sunken)}
.dispatch-legend__item[data-tone="at_risk"]::before,.dispatch-legend__item[data-tone="breached"]::before{content:none}
.dispatch-legend__mark{font-family:var(--font-instrument)}
.dispatch-legend__item[data-tone="at_risk"] .dispatch-legend__mark{color:var(--color-status-at-risk)}
.dispatch-legend__item[data-tone="breached"] .dispatch-legend__mark{color:var(--color-status-breached)}
.dispatch-board__segment{text-decoration:none}
.dispatch-board__segment[data-tone="scheduled"]{background:var(--color-surface);border-color:var(--color-text)}
.dispatch-board__segment[data-tone="waiting"]{background:var(--color-surface);border-color:var(--color-text);border-style:dashed}
.dispatch-board__segment[data-tone="completed"]{background:color-mix(in srgb,var(--color-surface-sunken) 40%,transparent);border-color:var(--color-text-muted);border-style:dotted;color:var(--color-text-muted)}
.dispatch-board__segment[data-tone="at_risk"]{background:color-mix(in srgb,var(--color-status-at-risk) 11%,var(--color-surface));border-color:var(--color-status-at-risk)}
.dispatch-board__segment[data-tone="breached"]{background:color-mix(in srgb,var(--color-status-breached) 15%,var(--color-surface));border:2px solid var(--color-status-breached)}
.dispatch-board__state{flex:none;font-family:var(--font-label);font-size:var(--text-xs);font-weight:700;white-space:nowrap}
.dispatch-board__segment[data-tone="at_risk"] .dispatch-board__state{color:var(--color-status-at-risk)}
.dispatch-board__segment[data-tone="breached"] .dispatch-board__state{color:var(--color-status-breached)}
.dispatch-board__empty{margin:0;padding:var(--space-4);color:var(--color-text-muted)}
.dispatch-board__off{display:flex;flex-direction:column;gap:var(--space-4);margin-top:var(--space-4)}

/* ---- Job Dashboard: four action buckets and the stalled-jobs table ---- */
.s3-buckets{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr));gap:var(--space-3);margin:0 0 var(--space-4)}
.s3-bucket{--bucket-ink:var(--color-text);display:flex}
.s3-bucket>section{flex:1;border-top:3px solid var(--bucket-ink)}
.s3-bucket__head{display:flex;flex-direction:column;gap:2px;padding-bottom:var(--space-3);margin-bottom:var(--space-2);border-bottom:1px solid var(--color-border)}
.s3-bucket__n{font-size:var(--text-display);font-weight:600;line-height:1.1;color:var(--bucket-ink)}
.s3-bucket__title{margin:0;font-family:var(--font-display);font-size:var(--text-lg);font-weight:700}
.s3-bucket__sub,.s3-bucket__none{margin:0;color:var(--color-text-muted);font-size:var(--text-sm)}
.s3-bucket__rows{margin:0}
.s3-bucket__row{display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-2);min-height:var(--row-height);padding-block:var(--space-1)}
.s3-bucket__row dt{color:var(--color-text)}
.s3-bucket__row dd{margin:0;font-weight:600}
.s3-chips{display:flex;flex-wrap:wrap;gap:var(--space-1)}
.s3-cust{display:flex;flex-direction:column}
.s3-cust .s3-flag,.s3-detail-head .s3-flag{align-self:flex-start;margin:var(--space-1) 0}
.s3-cust small{color:var(--color-text-muted);font-size:var(--text-xs)}
.s3-cust__svc{text-transform:capitalize}
.s3-tech{display:inline-flex;align-items:center;gap:var(--space-2);font-weight:600}
.s3-flags{display:inline-flex;flex-wrap:wrap;align-items:center;gap:var(--space-1)}
.s3-flag{display:inline-flex;align-items:center;padding:2px var(--space-2);border:1px solid var(--color-text-muted);border-radius:var(--radius-pill);color:var(--color-text);font-size:var(--text-xs);font-weight:600;white-space:nowrap}
.s3-grid-scroll{overflow-x:auto}
.s3-cust strong,.s3-tech{white-space:nowrap}
.s3-moves{display:flex;flex-direction:column;align-items:flex-start;gap:var(--space-1)}
.s3-act{min-height:var(--control-height);appearance:none;border:0;background:none;padding:0;color:var(--color-action-text);font:inherit;font-size:var(--text-sm);padding-block:2px;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:2px;white-space:nowrap}
.s3-act:disabled{color:var(--color-text-muted);cursor:not-allowed;text-decoration:none}
.s3-act:focus-visible{outline:2px solid var(--color-focus-ring);outline-offset:2px}
.s3-note{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0;max-width:var(--measure-cell)}
.s3-note__body{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.s3-note-edit{display:flex;flex-direction:column;gap:var(--space-1);min-width:24ch}

/* ---- Job Detail (0016): header card, visit timeline, customer communication ---- */
.s3-detail-grid{display:grid;grid-template-columns:minmax(18rem,1fr) minmax(0,2.4fr);gap:var(--space-4);align-items:start;margin:0 0 var(--space-4)}
.s3-eyebrow{margin:0 0 var(--space-1);font-family:var(--font-label);font-size:var(--text-xs);font-weight:600;letter-spacing:var(--track-wide);text-transform:uppercase;color:var(--color-text-muted)}
.s3-detail-head{display:flex;flex-direction:column;gap:var(--space-1);padding-bottom:var(--space-3);border-bottom:1px solid var(--color-border)}
.s3-detail-head__site{margin:0;font-family:var(--font-display);font-size:var(--text-xl);font-weight:700}
.s3-detail-head__where{margin:0;color:var(--color-text-muted);font-size:var(--text-sm)}
.s3-detail-head__crews{display:flex;flex-wrap:wrap;gap:var(--space-2) var(--space-3);margin:0 0 var(--space-3)}
.s3-jobfacts{margin:0 0 var(--space-3)}
.s3-jobfacts>div{display:flex;justify-content:space-between;gap:var(--space-3);padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)}
.s3-jobfacts dt{color:var(--color-text-muted)}
.s3-jobfacts dd{margin:0;font-weight:600}
.s3-standing{display:flex;flex-direction:column;align-items:flex-start;gap:var(--space-1);padding:var(--space-3);border:1px solid var(--color-border-hard);border-radius:var(--radius-control);background:var(--color-surface-sunken)}
.s3-standing__body{margin:0;color:var(--color-text)}
.s3-draftbox{width:100%;min-height:4.5rem;resize:vertical;font:inherit}
.s3-seg-btn{min-height:var(--control-height);appearance:none;border:0;background:none;font-family:inherit;cursor:pointer}
.s3-seg-btn:focus-visible{outline:2px solid var(--color-focus-ring);outline-offset:2px}
.s3-visits{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-3)}
.s3-visit{display:grid;grid-template-columns:5.5rem minmax(0,1fr);gap:var(--space-3)}
.s3-visit__date{display:flex;flex-direction:column;align-items:flex-end;padding-top:var(--space-2);color:var(--color-text-muted);font-size:var(--text-xs)}
.s3-visit__date strong{color:var(--color-text);font-size:var(--text-md)}
.s3-visit__card{display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-3);border:1px solid var(--color-border);border-top:3px solid var(--color-border-hard);border-radius:var(--radius-control);background:var(--color-surface);min-width:0}
.s3-visit[data-kind="office"] .s3-visit__card{border-top-color:var(--color-border)}
.s3-visit__card--next{border-style:dashed;border-top:3px solid var(--color-action-text);background:var(--color-page)}
.s3-visit__head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:var(--space-2)}
.s3-visit__crews{display:flex;flex-wrap:wrap;gap:var(--space-2) var(--space-3)}
.s3-visit__when{color:var(--color-text-muted);font-size:var(--text-sm)}
.s3-visit__sched{font-weight:700;color:var(--color-action-text)}
.s3-visit__note{margin:0;display:flex;flex-direction:column;gap:2px}
.s3-visit__by{color:var(--color-text-muted);font-size:var(--text-xs)}
.s3-visits__earlier{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:var(--space-2);padding:var(--space-3);border:1px dashed var(--color-border-hard);border-radius:var(--radius-control);color:var(--color-text-muted)}
.s3-photos{display:flex;flex-wrap:wrap;gap:var(--space-2)}
.s3-photo{display:flex;flex-direction:column;gap:2px;width:6.5rem;margin:0}
.s3-photo__well{display:block;height:3.5rem;border:1px solid var(--color-border);border-radius:var(--radius-control);background:var(--color-surface-sunken)}
.s3-photo figcaption{display:flex;flex-direction:column;font-size:var(--text-xs);min-width:0}
.s3-photo figcaption strong,.s3-photo figcaption span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.s3-photo figcaption span{color:var(--color-text-muted)}
.s3-photo--more{appearance:none;justify-content:center;align-items:center;height:3.5rem;border:1px dashed var(--color-border-hard);border-radius:var(--radius-control);background:var(--color-surface);color:var(--color-action-text);font:inherit;font-size:var(--text-sm);font-weight:600;cursor:pointer}
.s3-photo--more:focus-visible{outline:2px solid var(--color-focus-ring);outline-offset:2px}
.s3-comms{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-4);align-items:start}
.s3-comms__col{display:flex;flex-direction:column;gap:var(--space-3);min-width:0}
.s3-update{display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-control);background:var(--color-surface)}
.s3-update__note{margin:0;font-size:var(--text-sm)}
.s3-update__foot{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:var(--space-2);margin:0;color:var(--color-text-muted);font-size:var(--text-xs)}
.s3-customer-text{margin:0;padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-control);background:var(--color-surface-sunken)}
.s3-thread{display:flex;flex-direction:column;gap:var(--space-3);padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-control);background:var(--color-surface)}
.s3-thread__list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-3)}
.s3-msg{display:flex;flex-direction:column;gap:2px;max-width:80%}
.s3-msg[data-side="office"]{align-self:flex-end;align-items:flex-end}
.s3-msg__by{color:var(--color-text-muted);font-size:var(--text-xs)}
.s3-msg__body{margin:0;padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-card);background:var(--color-surface-sunken)}
.s3-msg[data-side="office"] .s3-msg__body{border-color:color-mix(in srgb,var(--color-action-text) 45%,transparent);background:color-mix(in srgb,var(--color-action) 14%,var(--color-surface));color:var(--color-text)}
.s3-thread__reply{display:flex;gap:var(--space-2);align-items:center}
.s3-grow{flex:1;min-width:0}
.s3-notify{display:flex;gap:var(--space-2);align-items:flex-start;color:var(--color-text-muted);font-size:var(--text-sm)}
.s3-notify span{display:flex;flex-direction:column}
.s3-notify small{font-size:var(--text-xs)}
.s3-internal{display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-3);border:1px dashed var(--color-border-hard);border-radius:var(--radius-control);background:var(--color-page)}
.s3-internal__list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-2)}
.s3-internal__list li{padding-bottom:var(--space-2);border-bottom:1px solid var(--color-border)}
.s3-internal__list p{margin:2px 0 0}
.s3-pick{list-style:none;margin:0;padding:0}
.s3-pick li{display:grid;grid-template-columns:7rem minmax(0,1fr) auto;gap:var(--space-3);align-items:baseline;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)}
@media (max-width:980px){.s3-detail-grid,.s3-comms{grid-template-columns:minmax(0,1fr)}}
@media (max-width:600px){.s3-visit{grid-template-columns:minmax(0,1fr)}.s3-visit__date{flex-direction:row;gap:var(--space-2);align-items:baseline;padding:0}.s3-pick li{grid-template-columns:minmax(0,1fr)}.s3-msg{max-width:95%}}

/* ---- Manager Dashboard: the company on one page — waits, attention, the completed/invoiced trend, branches, team ---- */
.s3-mgr-example{margin:calc(-1 * var(--space-2)) 0 var(--space-3);font-size:var(--text-xs)}
#mgr-figures{grid-template-columns:repeat(3,minmax(0,1fr))}
.s3-mgr-pair{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:var(--space-4);align-items:stretch;margin:0 0 var(--space-4)}
.s3-mgr-bar{display:block;flex:1;min-inline-size:4rem;block-size:8px;border-radius:var(--radius-pill);background:var(--color-surface-sunken)}
.s3-mgr-bar__fill{display:block;block-size:100%;border-radius:var(--radius-pill);background:var(--color-action-text)}
.s3-mgr-bar__fill[data-over="true"]{background:var(--color-status-breached)}
.s3-mgr-waits,.s3-mgr-attn{list-style:none;margin:0;padding:0}
.s3-mgr-wait{display:grid;grid-template-columns:minmax(0,13rem) minmax(0,1fr) 6rem;gap:var(--space-3);align-items:center;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)}
.s3-mgr-wait:last-child,.s3-mgr-attn__item:last-child{border-bottom:0}
.s3-mgr-wait__step,.s3-mgr-attn__item>span:last-child{display:flex;flex-direction:column;gap:2px;min-width:0}
.s3-mgr-wait__step small,.s3-mgr-attn__item small{color:var(--color-text-muted);font-size:var(--text-xs)}
.s3-mgr-wait__n{display:flex;flex-direction:column;align-items:flex-end;font-weight:600}
.s3-mgr-wait__n[data-over="true"]{color:var(--color-status-breached)}
.s3-mgr-wait__n small{font-family:var(--font-label);font-size:var(--text-xs);font-weight:600}
.s3-mgr-attn__item{display:grid;grid-template-columns:8.5rem minmax(0,1fr);gap:var(--space-3);align-items:start;padding:var(--space-3) 0;border-bottom:1px solid var(--color-border)}
.s3-mgr-attn__item>:first-child{justify-self:start}
.s3-mgr-chart{margin:0;display:flex;flex-direction:column;gap:var(--space-2)}
.s3-mgr-chart__svg{display:block;inline-size:100%;block-size:auto}
.s3-mgr-chart__grid{stroke:var(--color-border);stroke-width:1}
.s3-mgr-chart__tick{fill:var(--color-text-muted);font-family:var(--font-instrument);font-size:var(--text-xs)}
.s3-mgr-chart__series path{fill:none;stroke-width:2;stroke-linejoin:round}
.s3-mgr-chart__series circle{stroke:var(--color-surface);stroke-width:2}
.s3-mgr-chart__series[data-series="completed"] path{stroke:var(--color-action-text)}
.s3-mgr-chart__series[data-series="completed"] circle{fill:var(--color-action-text)}
.s3-mgr-chart__series[data-series="invoiced"] path{stroke:var(--color-text-muted);stroke-dasharray:6 4}
.s3-mgr-chart__series[data-series="invoiced"] circle{fill:var(--color-text-muted)}
.s3-mgr-chart__end{fill:var(--color-text);font-family:var(--font-label);font-size:var(--text-xs);font-weight:700}
.s3-mgr-legend{display:flex;flex-wrap:wrap;gap:var(--space-2) var(--space-4);font-family:var(--font-label);font-size:var(--text-xs);color:var(--color-text-muted)}
.s3-mgr-legend__item{display:inline-flex;align-items:center;gap:var(--space-2)}
.s3-mgr-legend__item::before{content:"";inline-size:1.25rem;border-top:2px solid var(--color-action-text)}
.s3-mgr-legend__item[data-series="invoiced"]::before{border-top:2px dashed var(--color-text-muted)}
.s3-mgr-util{display:flex;align-items:center;gap:var(--space-2);min-inline-size:9rem}
.s3-mgr-team-tools{display:flex;flex-wrap:wrap;gap:var(--space-2)}
.s3-mgr .s3-chips{margin:0 0 var(--space-3)}
@media (max-width:980px){.s3-mgr-pair{grid-template-columns:minmax(0,1fr)}#mgr-figures{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:600px){.s3-mgr-wait{grid-template-columns:minmax(0,1fr) auto}.s3-mgr-wait .s3-mgr-bar{grid-column:1 / -1;grid-row:2}.s3-mgr-attn__item{grid-template-columns:minmax(0,1fr)}}

.s3-map-job-list{display:flex;flex-direction:column;gap:0;max-height:34rem;overflow:auto;list-style:none;margin:0;padding:0}.s3-map-job{display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--color-border)}
.s3-map-job__main{display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-2)}
.s3-map-job__site{font-weight:700}
.s3-map-job__service,.s3-map-job__state{color:var(--color-text-muted);font-size:var(--text-sm);text-transform:capitalize}
.s3-map-job__assignment{display:flex;justify-content:space-between;align-items:center;gap:var(--space-2);min-height:var(--row-height)}
.s3-map-job__crew{display:flex;align-items:center;gap:var(--space-2);font-weight:600}
.s3-truck-model{display:block;width:4.75rem;height:auto;flex:none}
.s3-truck-model__mark{fill:var(--color-text);font-family:var(--font-label);font-size:var(--text-xs);font-weight:700}
.s3-map-job__unassigned{color:var(--color-text);font-weight:600}
.s3-map-job__location{color:var(--color-text-muted);font-size:var(--text-xs);text-align:end}
.s3-map-job__footer{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap}
.s3-map-job__footer .s3-row-actions{margin-inline-start:auto}
.s3-map-empty{display:flex;flex:1;flex-direction:column;justify-content:center;gap:var(--space-2);padding:var(--space-6);color:var(--color-text-muted);text-align:center}
.s3-map-empty strong{color:var(--color-text)}
@media(max-width:980px){.s3-map-layout{grid-template-columns:minmax(0,1fr)}}
@media(max-width:600px){
  .s3-map-scene__art{min-height:30rem}
  .s3-map-scene__blocks span{opacity:.65}
  .s3-shop{top:40%;width:76%}
  .s3-map-notice{bottom:var(--space-2);left:var(--space-2);width:calc(100% - var(--space-4))}
  .s3-map-scale{display:none}
  .s3-map-filters{justify-content:flex-start}
  .s3-map-job__main,.s3-map-job__assignment{align-items:flex-start;flex-direction:column}
  .s3-map-job__location{text-align:start}
}
.s3-intake{display:flex;flex-direction:column;gap:var(--space-3)}
.s3-new-job{display:flex;flex-direction:column;gap:var(--space-3)}
.s3-intake__layout{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-3);align-items:start}
.s3-intake__layout[data-viewing="true"]{grid-template-columns:minmax(0,2fr) minmax(16rem,1fr)}
.s3-intake__asked{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;max-width:var(--measure-narrow);white-space:pre-line}
.s3-intake__thumbs{display:flex;gap:var(--space-1)}
.s3-intake__thumb{appearance:none;-webkit-appearance:none;padding:0;width:var(--control-height);height:var(--control-height);border:1px solid var(--color-border);border-radius:var(--radius-control);background:var(--color-surface-sunken);overflow:hidden;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:var(--text-xs)}
.s3-intake__thumb img{display:block;width:100%;height:100%;object-fit:cover}
.s3-intake__thumb[aria-pressed="true"]{border:2px solid var(--color-action-text)}
.s3-intake__thumb:focus-visible{outline:2px solid var(--color-focus-ring);outline-offset:2px}
.s3-intake__view{margin:0;display:flex;flex-direction:column;gap:var(--space-2)}
.s3-intake__view img{display:block;width:100%;height:auto;max-height:70vh;object-fit:contain;border-radius:var(--radius-control);background:var(--color-surface-sunken)}
.s3-intake__view figcaption{font-size:var(--text-sm);color:var(--color-text-muted)}
@media (max-width:1100px){.s3-intake__layout[data-viewing="true"]{grid-template-columns:minmax(0,1fr)}}
`;
