#!/usr/bin/env bash
# Clear the sign in and sign up rate limit counters in the local database.
#
#   deploy/dev/rate-limit-reset.sh
#
# Sign up allows 5 tries per 10 minutes and sign in 10 per minute (packages/auth). When you
# test the signup flow over and over you will hit that. This empties core.rate_limit.
# It only ever talks to the local dev database on 127.0.0.1.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
dev_sql "DELETE FROM core.rate_limit"
echo "Rate limit counters cleared."
