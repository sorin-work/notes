#!/bin/sh
set -e

# Apply any migrations that have not run yet, then start the API.
./node_modules/.bin/prisma migrate deploy
exec node dist/main
