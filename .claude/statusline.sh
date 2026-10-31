#!/usr/bin/env bash
# Status line: model │ context used/window │ prompt-cache HOT/COLD with TTL countdown.
# Input: Claude Code statusLine JSON on stdin. Cache state is read from the transcript.
in=$(cat)
model=$(jq -r '.model.display_name // .model.id // "?"' <<<"$in")
read -r used size pct rd <<<"$(jq -r '.context_window as $c
  | ($c.current_usage // {}) as $u
  | [ (($u.input_tokens//0)+($u.cache_creation_input_tokens//0)+($u.cache_read_input_tokens//0)),
      ($c.context_window_size//200000), ($c.used_percentage//0), ($u.cache_read_input_tokens//0) ] | @tsv' <<<"$in")"
tp=$(jq -r '.transcript_path // empty' <<<"$in")

k() { awk -v n="$1" 'BEGIN{ if(n>=1e6) printf "%.2fM",n/1e6; else if(n>=1e3) printf "%.1fk",n/1e3; else printf "%d",n }'; }
R=$'\e[0m'; DIM=$'\e[2m'; G=$'\e[32m'; Y=$'\e[33m'; RED=$'\e[31m'; C=$'\e[36m'

pct=${pct%.*}; pct=${pct:-0}
cc=$G; ((pct>=60)) && cc=$Y; ((pct>=85)) && cc=$RED
filled=$((pct/10)); bar=""
for i in $(seq 1 10); do ((i<=filled)) && bar+="█" || bar+="░"; done
ctx="${cc}${bar}${R} $(k "$used")/$(k "$size") ${cc}${pct}%${R}"

cache="${DIM}cache —${R}"
if [[ -f $tp ]]; then
  # Last 400 lines is enough to find the latest assistant turn and its cache write tier.
  last=$(tail -n 400 "$tp" | tac | grep -m1 '"type":"assistant"')
  if [[ -n $last ]]; then
    ts=$(jq -r '.timestamp' <<<"$last")
    ttl=$(tail -n 400 "$tp" | tac | grep '"type":"assistant"' | jq -rs '
      map(.message.usage.cache_creation // {}) | map(select((.ephemeral_1h_input_tokens//0)+(.ephemeral_5m_input_tokens//0) > 0))
      | if length==0 then 300 elif (.[0].ephemeral_1h_input_tokens//0) > 0 then 3600 else 300 end')
    age=$(( $(date +%s) - $(date -d "$ts" +%s) ))
    left=$((ttl-age))
    tier=$([[ $ttl == 3600 ]] && echo 1h || echo 5m)
    hit=$(awk -v r="$rd" -v t="$used" 'BEGIN{ printf "%d", (t>0? 100*r/t : 0) }')
    if ((left>0)); then
      hc=$G; ((left<ttl/5)) && hc=$Y
      cache="${hc}● HOT${R} ${tier} $(printf '%d:%02d' $((left/60)) $((left%60))) left ${DIM}hit ${hit}%${R}"
    else
      cache="${RED}○ COLD${R} ${tier} ${DIM}expired $(printf '%dm' $(( -left/60 ))) ago — next turn re-writes $(k "$used")${R}"
    fi
  fi
fi

printf '%s%s%s │ %s │ %s' "$C" "$model" "$R" "$ctx" "$cache"
