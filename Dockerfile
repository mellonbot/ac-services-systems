# syntax=docker/dockerfile:1
# THE GATEWAY IMAGE — services/gateway and services/worker, unmodified, as one process
# tree. Built and pushed by `wrangler deploy -c infra/cloudflare/wrangler.jsonc`
# (CI does this on main); runs on Cloudflare Containers behind the Worker in
# infra/cloudflare/worker.mjs. Nothing here is special to Cloudflare: the same
# image runs anywhere Docker does, with DATABASE_URL and AC_SIGNING_KEY_PEM set.
#
#   docker build -t ac-gateway .
#   docker run --rm -p 8080:8080 -e DATABASE_URL=… -e AC_SIGNING_KEY_PEM="$(cat key.pem)" -e AC_SITE=ac.example ac-gateway
# Pinned by digest (node:22-slim, resolved 2026-10-22): a re-published tag
# must not change what production runs without a commit saying so.
FROM node:22-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d

ENV NODE_ENV=production \
    PORT=8080 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

WORKDIR /app
RUN corepack enable

# The whole workspace: intra-repo imports are relative .ts paths and run under
# Node's type stripping, so there is no build step and nothing to compile.
# `pg` is the only runtime dependency (services/gateway/src/db/pg-tx.ts is the only
# file that imports it). .dockerignore keeps tests, docs and the demo out.
COPY . .
RUN pnpm install --frozen-lockfile --prod

# The process holds DATABASE_URL and the signing key; it does not also need root.
USER node
EXPOSE 8080
CMD ["node", "infra/cloudflare/entrypoint.mjs"]
