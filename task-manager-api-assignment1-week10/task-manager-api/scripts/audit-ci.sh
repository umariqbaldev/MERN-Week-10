#!/usr/bin/env bash
#
# X1 (Asgn3): CI dependency audit step.
# Fails the build if npm audit finds any HIGH or CRITICAL vulnerabilities.
#
# Usage:  bash scripts/audit-ci.sh
#         (or add to your CI pipeline as a step)
#
# Exit codes:
#   0 — no high/critical vulnerabilities found
#   1 — high/critical vulnerabilities detected (build should fail)

set -euo pipefail

echo "=== Running npm audit (high severity) ==="

# npm audit exits non-zero when vulnerabilities are found.
# We only care about high and critical — moderate/low are informational.
if npm audit --audit-level=high; then
  echo "No high/critical vulnerabilities found."
  exit 0
else
  echo ""
  echo "HIGH or CRITICAL vulnerabilities detected!"
  echo "Fix them with: npm audit fix"
  echo "Or review manually: npm audit"
  exit 1
fi
