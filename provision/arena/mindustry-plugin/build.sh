#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT_JAR="/opt/tetrapod/mindustry/config/mods/arena-bridge.jar"

sudo docker run --rm \
  -v /opt/tetrapod/mindustry:/data \
  -v "$HERE:/src:ro" \
  eclipse-temurin:17-jdk sh -c '
    set -e
    mkdir -p /tmp/build/classes
    javac --release 17 -cp /data/server.jar -d /tmp/build/classes /src/src/arena/ArenaBridgePlugin.java
    cp /src/plugin.json /tmp/build/classes/plugin.json
    jar cf /data/config/mods/arena-bridge.jar -C /tmp/build/classes .
  '
ls -lh "$OUT_JAR"
