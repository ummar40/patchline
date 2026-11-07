# Execution image for maintenance jobs. Containers from this image run with a read-only
# root filesystem, no capabilities, and (by default) no network; all state lives in per-job
# volumes mounted at /workspace and /home/sandbox.
FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    g++ \
    git \
    make \
    patch \
    python-is-python3 \
    python3 \
    python3-pip \
    python3-venv \
    ripgrep \
  && rm -rf /var/lib/apt/lists/*

RUN npm install --global pnpm@10 \
  && npm cache clean --force

# Named volumes inherit ownership from these directories on first mount.
RUN groupadd --gid 10001 sandbox \
  && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/sandbox --shell /bin/bash sandbox \
  && mkdir -p /workspace \
  && chown sandbox:sandbox /workspace

USER sandbox
WORKDIR /workspace
