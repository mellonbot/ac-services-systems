#!/usr/bin/env bash
# Stop hook: when the live context passes a threshold, remind the user to /clear.
# Context size = input + cache-read + cache-write tokens of the last main-thread
# assistant turn in the transcript. Threshold: CLAUDE_CONTEXT_REMIND_TOKENS (default 120000).
set -euo pipefail

threshold="${CLAUDE_CONTEXT_REMIND_TOKENS:-120000}"
transcript="$(jq -r '.transcript_path // empty')"
[ -n "$transcript" ] && [ -f "$transcript" ] || exit 0

tokens="$(jq -s '[.[] | select(.type == "assistant" and (.isSidechain | not) and .message.usage)]
  | last | .message.usage
  | (.input_tokens // 0) + (.cache_read_input_tokens // 0) + (.cache_creation_input_tokens // 0)' "$transcript")"

[ "$tokens" != "null" ] && [ "$tokens" -ge "$threshold" ] || exit 0

jq -n --arg t "$tokens" --arg th "$threshold" \
  '{systemMessage: "Context at \($t | tonumber / 1000 | floor)k tokens (threshold \($th | tonumber / 1000 | floor)k). Commit what matters, then /clear."}'
