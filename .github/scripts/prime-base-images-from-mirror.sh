#!/usr/bin/env bash
# public.ecr.aws rate-limits shared GitHub runner IPs (429 "Data limit
# exceeded"), which fails compose builds before any test runs. Pull each
# Dockerfile base image from the mirror.gcr.io Docker Hub mirror and tag it
# under the public.ecr.aws name: BuildKit then resolves FROM locally and never
# contacts ECR. The Dockerfiles keep literal FROM lines so Dependabot can
# still update them.
set -euo pipefail

ECR_PREFIX="public.ecr.aws/docker/library/"
MIRROR_PREFIX="mirror.gcr.io/library/"

images=("$@")
if [ "${#images[@]}" -eq 0 ]; then
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  mapfile -t images < <(
    grep -hoE "^FROM ${ECR_PREFIX//./\\.}[^ ]+" \
      "${root}/deploy/compose/service.Dockerfile" \
      "${root}/deploy/compose/fnn/Dockerfile" |
      awk '{print $2}' | sort -u
  )
fi

for image in "${images[@]}"; do
  mirror="${MIRROR_PREFIX}${image#"${ECR_PREFIX}"}"
  echo "priming ${image} from ${mirror}"
  docker pull --quiet "${mirror}"
  docker tag "${mirror}" "${image}"
done
