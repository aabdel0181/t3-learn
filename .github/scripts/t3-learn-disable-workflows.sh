#!/usr/bin/env bash
# The t3-learn fork runs only T3 Learn CI. Upstream's other workflows deploy,
# publish, or label and comment with write scopes, and a workflow file merged
# from upstream starts out active, so disable every one after each sync merges:
#   bash .github/scripts/t3-learn-disable-workflows.sh
# Needs a gh login with admin on the fork. Safe to rerun.
set -euo pipefail

repo="${1:-aabdel0181/t3-learn}"

gh api "repos/$repo/actions/workflows" --paginate --jq '.workflows[]
  | select(.state == "active"
    and (.path | startswith(".github/workflows/"))
    and .path != ".github/workflows/t3-learn-ci.yml"
    and .path != ".github/workflows/t3-learn-release.yml")
  | "\(.id) \(.path)"' |
  while read -r id path; do
    gh api -X PUT "repos/$repo/actions/workflows/$id/disable"
    echo "Disabled $path ($id)"
  done
