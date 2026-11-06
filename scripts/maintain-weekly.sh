#!/usr/bin/env bash
# Weekly maintenance of a wiki clone (docs/PIPELINE.md §8.6): every `cortex maintain` subtask with --apply, one commit on
# a branch `maintain/<date>` for a human to review, then back to the base branch. Nothing is pushed unless asked.
#
#   maintain-weekly.sh [--dry-run] [--push] [<wiki clone>]       (clone: $CORTEX_ROOT, otherwise the current folder)
#
#   --dry-run  lists what each subtask would do (no --apply): no git operation, nothing written.
#   --push     pushes the branch to the remote (never forced); also $MAINTAIN_PUSH=1.
# Environment: CORTEX_BIN (cortex), MAINTAIN_REMOTE (origin), MAINTAIN_BASE (the branch checked out at start),
#   MAINTAIN_NO_SYNC=1 (no fetch and fast-forward of the base before the run), MAINTAIN_LIMIT=N (--limit of each subtask),
#   MAINTAIN_DATE (YYYY-MM-DD, tests). The model server comes from cortex.json / $OPENAI_BASE_URL like any cortex command.
# Exit: 0 nothing wrong (including "nothing to do"), 1 a subtask failed (the others ran and what they wrote is committed),
#   2 refused (dirty clone, no git repository, failed push...), 3 blocked by a maintenance branch nobody reviewed yet
#   (nothing ran: the failed unit in the journal is the reminder to merge or delete it).
set -euo pipefail

dry=0 push=${MAINTAIN_PUSH:-0} root=""
for a in "$@"; do
  case "$a" in
    --dry-run) dry=1 ;;
    --push) push=1 ;;
    -*) echo "usage: maintain-weekly.sh [--dry-run] [--push] [<wiki clone>]" >&2; exit 2 ;;
    *) root=$a ;;
  esac
done
cortex_bin=${CORTEX_BIN:-cortex} remote=${MAINTAIN_REMOTE:-origin}
cd "${root:-${CORTEX_ROOT:-.}}"
export CORTEX_ROOT=$PWD
say() { echo "maintain: $*"; }
die() { echo "maintain: $*" >&2; exit 2; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$PWD is not a git clone"
# The commits are the maintenance's, whoever runs it.
export GIT_AUTHOR_NAME=${GIT_AUTHOR_NAME:-cortex-maintain} GIT_COMMITTER_NAME=${GIT_COMMITTER_NAME:-cortex-maintain}
export GIT_AUTHOR_EMAIL=${GIT_AUTHOR_EMAIL:-cortex-maintain@localhost} GIT_COMMITTER_EMAIL=${GIT_COMMITTER_EMAIL:-cortex-maintain@localhost}

# Order: duplicates first (fewer pages to judge afterwards), then contradictions, then what cuts pages, then syntheses (they read the queue).
tasks=(merge contradictions split synthesize)
limit=(); [ -n "${MAINTAIN_LIMIT:-}" ] && limit=(--limit "$MAINTAIN_LIMIT")
# run_tasks [--apply]: every subtask, whatever the previous ones did. Their output goes to stderr, "<task>=<exit>" lines to stdout.
run_tasks() {
  local t rc
  for t in "${tasks[@]}"; do
    say "cortex maintain $t $*" >&2
    rc=0; "$cortex_bin" maintain "$t" "$@" "${limit[@]}" >&2 || rc=$?
    echo "$t=$rc"
  done
}

if [ "$dry" = 1 ]; then
  fails=0
  while IFS== read -r t rc; do [ "$rc" = 0 ] || fails=1; done < <(run_tasks)
  exit "$fails"
fi

# The `.cortex/` folder (state, caches) is not part of the review, ignored or not.
status() { git status --porcelain -- . ':!.cortex'; }
[ -z "$(status)" ] || die "the clone has uncommitted changes; the maintenance needs a clean one"
base=${MAINTAIN_BASE:-$(git symbolic-ref --short HEAD)}
case "$base" in maintain/*) die "$base is a maintenance branch, not a base" ;; esac
date=${MAINTAIN_DATE:-$(date +%F)} branch=maintain/$date
git checkout -q "$base"
if [ "${MAINTAIN_NO_SYNC:-0}" != 1 ] && git remote get-url "$remote" >/dev/null 2>&1; then
  { git fetch -q "$remote" && git merge -q --ff-only "$remote/$base"; } || die "cannot bring $base up to date with $remote (fetch or fast-forward failed)"
fi
# A branch of an earlier week still unmerged: a second run would pile its changes (and queue entries) on top; wait for the review.
# A squash or rebase merge leaves the branch "unmerged" for git: it counts as merged when merging it would change nothing in the base.
already_in_base() { local t; t=$(git merge-tree --write-tree "$base" "$1" 2>/dev/null) || return 1; [ "${t%%$'\n'*}" = "$(git rev-parse "$base^{tree}")" ]; }
pending=""
for b in $(git branch --list 'maintain/*' --no-merged "$base" --format '%(refname:short)'); do
  if already_in_base "$b"; then git branch -q -D "$b"; say "$b: its changes are already in $base (squash or rebase merge), branch deleted."; else pending+="$b "; fi
done
if [ -n "$pending" ]; then
  say "waiting for the review of: ${pending}(merge or delete the branch to resume). Nothing done."
  exit 3
fi
git rev-parse --verify -q "refs/heads/$branch" >/dev/null && { say "$branch already exists: nothing done."; exit 0; }

git checkout -q -b "$branch"
ok=() fails=()
while IFS== read -r t rc; do if [ "$rc" = 0 ]; then ok+=("$t"); else fails+=("$t"); fi; done < <(run_tasks --apply)

if [ -z "$(status)" ]; then
  git checkout -q "$base"; git branch -q -d "$branch"
  say "nothing to review this week (${#fails[@]} subtask(s) failed)."
  [ ${#fails[@]} = 0 ]; exit
fi
changed=$(status | wc -l)
text="Maintenance hebdomadaire du $date : ${ok[*]:-aucune sous-tâche} terminées${fails[*]:+, en échec : ${fails[*]}} ; $changed fichier(s) modifié(s), branche $branch à relire."
"$cortex_bin" log add update "$text" || say "journal line not written"
git add -A -- . ':!.cortex'
git commit -q -m "maintain: $date" -m "$text"
say "committed on $branch: $changed file(s) + journal."
if [ "$push" = 1 ]; then
  git checkout -q "$base"
  git remote get-url "$remote" >/dev/null 2>&1 || die "no remote $remote to push to"
  git push -q "$remote" "$branch" || die "push of $branch to $remote failed (the commit stays local)"
  say "pushed $branch to $remote."
else
  git checkout -q "$base"
  say "not pushed (--push or MAINTAIN_PUSH=1 pushes $branch to $remote)."
fi
[ ${#fails[@]} = 0 ]
