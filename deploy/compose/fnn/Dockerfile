FROM debian:bookworm-slim

ARG FNN_VERSION=v0.6.1
ARG FNN_ASSET=fnn_v0.6.1-x86_64-linux-portable.tar.gz
ARG FNN_ASSET_SHA256=

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl tar openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/fnn

RUN curl -fsSL -o /tmp/fnn.tar.gz "https://github.com/nervosnetwork/fiber/releases/download/${FNN_VERSION}/${FNN_ASSET}" \
  && test -n "${FNN_ASSET_SHA256}" \
  && echo "${FNN_ASSET_SHA256}  /tmp/fnn.tar.gz" | sha256sum --check \
  && tar -xzf /tmp/fnn.tar.gz -C /opt/fnn \
  && rm -f /tmp/fnn.tar.gz \
  && test -x /opt/fnn/fnn \
  && test -x /opt/fnn/fnn-migrate

COPY deploy/compose/fnn/config/testnet.yml /opt/fnn/config/testnet.yml
COPY deploy/compose/fnn/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh /opt/fnn/fnn /opt/fnn/fnn-migrate

ENV FIBER_CONFIG_TEMPLATE=/opt/fnn/config/testnet.yml
WORKDIR /data

EXPOSE 8227 8228
ENTRYPOINT ["/entrypoint.sh"]
