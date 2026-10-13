# syntax=docker/dockerfile:1
# THE GATEWAY IMAGE — apps/gateway and apps/worker, unmodified, as one process
# tree. Built and pushed by `wrangler deploy -c infra/cloudflare/wrangler.jsonc`
# (CI does this on main); runs on Cloudflare Containers behind the Worker in
# infra/cloudflare/worker.mjs. Nothing here is special to Cloudflare: the same
# image runs anywhere Docker does, with DATABASE_URL and AC_SIGNING_KEY_PEM set.
#
#   docker build -t ac-gateway .
#   docker run --rm -p 8080:8080 -e DATABASE_URL=… -e AC_SIGNING_KEY_PEM="$(cat key.pem)" -e AC_SITE=ac.example ac-gateway
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=8080 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

WORKDIR /app
RUN corepack enable

# The whole workspace: intra-repo imports are relative .ts paths and run under
# Node's type stripping, so there is no build step and nothing to compile.
# `pg` is the only runtime dependency (apps/gateway/src/pg-tx.ts is the only
# file that imports it). .dockerignore keeps tests, docs and the demo out.
COPY . .
RUN pnpm install --frozen-lockfile --prod

EXPOSE 8080
CMD ["node", "infra/cloudflare/entrypoint.mjs"]
