#!/usr/bin/env bash
set -euo pipefail

# validate.sh — validate a commit message against the Conventional Commits spec.
#
# Usage:
#   ./scripts/validate.sh "message"        # message as a single argument
#   printf '...\n' | ./scripts/validate.sh # message from stdin
#   ./scripts/validate.sh --help

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

TYPES="feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert"

fail() { printf '✗ %s\n' "$*" >&2; exit 1; }
warn() { printf '⚠ %s\n' "$*" >&2; }

msg="${1:-}"
if [[ -z "$msg" && ! -t 0 ]]; then
  msg="$(cat)"
fi
[[ -n "$msg" ]] || fail "no commit message provided"

header="$(printf '%s\n' "$msg" | head -n 1)"

# type(scope)!: subject  |  type!: subject  |  type: subject
header_regex="^($TYPES)(\([^)]+\))?(!)?:[[:space:]]+(.+)$"
if ! [[ "$header" =~ $header_regex ]]; then
  fail "invalid header; expected '<type>(<scope>)?(!)?: <subject>'"
fi

type="${BASH_REMATCH[1]}"
scope="${BASH_REMATCH[2]}"
bang="${BASH_REMATCH[3]}"
subject="${BASH_REMATCH[4]}"

[[ "${#header}" -le 72 ]] || fail "header is ${#header} chars (max 72)"
[[ "${#subject}" -le 50 ]] || warn "subject is ${#subject} chars (recommended ≤ 50)"
[[ "${subject:0:1}" =~ [A-Z] ]] && warn "subject should start lowercase: '$subject'"
[[ "$subject" =~ \.$ ]] && fail "subject must not end with a period"

past_tense_regex="^(added|fixed|updated|changed|wrote|made|removed|created|deleted|improved|refactored|reverted)[[:space:]]"
if [[ "$subject" =~ $past_tense_regex ]]; then
  warn "subject looks past-tense; use imperative mood (e.g. 'add' not 'added')"
fi

body="$(printf '%s\n' "$msg" | tail -n +2)"
if [[ -n "$body" ]]; then
  while IFS= read -r line; do
    [[ "${#line}" -le 72 ]] || warn "body line exceeds 72 chars: '${line:0:40}…'"
  done <<< "$body"
fi

if [[ -n "$bang" ]] && ! grep -qi '^BREAKING CHANGE:' <<< "$body"; then
  warn "breaking change marked with '!' but no 'BREAKING CHANGE:' footer"
fi

printf '✓ valid: %s\n' "$header"
