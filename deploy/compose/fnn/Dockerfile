FROM debian:bookworm-slim

ARG FNN_VERSION=v0.6.1
ARG FNN_ASSET=fnn_v0.6.1-x86_64-linux-portable.tar.gz

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl tar openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/fnn

RUN curl -fsSL -o /tmp/fnn.tar.gz "https://github.com/nervosnetwork/fiber/releases/download/${FNN_VERSION}/${FNN_ASSET}" \
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
