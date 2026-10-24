# Debian 12 baseline: glibc 2.36 or newer on x86-64.
FROM node:24-bookworm@sha256:14078204b6bb268c107ceff6d3c43f45a888105e5c2b18b14c32b3409d93a1b0 AS node
FROM rust:1.90.0-bookworm@sha256:3914072ca0c3b8aad871db9169a651ccfce30cf58303e5d6f2db16d1d8a7e58f AS build
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=node /usr/local/LICENSE /opt/node-LICENSE
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && apt-get update && apt-get install -y --no-install-recommends zstd libarchive-tools desktop-file-utils shellcheck \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY native/linux/Cargo.toml native/linux/Cargo.lock native/linux/
COPY native/linux/src native/linux/src
RUN cargo test --locked --manifest-path native/linux/Cargo.toml \
    && cargo build --release --locked --manifest-path native/linux/Cargo.toml
COPY server.js LICENSE ./
COPY src src
COPY public public
COPY scripts scripts
COPY native/linux/70-windock-uinput.rules native/linux/
COPY native/linux/packaging native/linux/packaging
ARG PACKAGE_VERSION
ARG PACKAGE_RELEASE=1
RUN shellcheck native/linux/packaging/windock native/linux/packaging/postinst native/linux/packaging/postrm scripts/package-linux.sh scripts/test-linux-package.sh \
    && desktop-file-validate native/linux/packaging/windock.desktop \
    && NODE_LICENSE=/opt/node-LICENSE bash scripts/package-linux.sh "$PACKAGE_VERSION" "$PACKAGE_RELEASE"
FROM scratch AS packages
COPY --from=build /src/artifacts/linux/ /
