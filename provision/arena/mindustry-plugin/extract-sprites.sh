#!/bin/bash
# Extract official Mindustry v159.7 sprite sheets + atlas.json into /opt/tetrapod/arena/sprites.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="/opt/tetrapod/arena/sprites"
CACHE_JAR="/opt/tetrapod/arena/Mindustry-v159.7.jar"

sudo install -d -o tetraslam -g tetraslam /opt/tetrapod/arena "$OUT_DIR"
if [ ! -f "$CACHE_JAR" ]; then
  if [ -f /tmp/mindustry-client-test/Mindustry.jar ]; then
    cp /tmp/mindustry-client-test/Mindustry.jar "$CACHE_JAR"
  else
    curl -fsSL -o "$CACHE_JAR" \
      https://github.com/Anuken/Mindustry/releases/download/v159.7/Mindustry.jar
  fi
fi

unzip -qo -j "$CACHE_JAR" "sprites/sprites*.png" "sprites/sprites.aatls" -d "$OUT_DIR"
sudo docker run --rm \
  -v "$CACHE_JAR:/mindustry.jar:ro" \
  -v "$OUT_DIR:/out" \
  -v "$HERE/ExtractAtlas.java:/ExtractAtlas.java:ro" \
  eclipse-temurin:17-jdk sh -c '
    set -e
    javac -cp /mindustry.jar -d /tmp /ExtractAtlas.java
    java -cp /tmp:/mindustry.jar ExtractAtlas /out
  '
sudo chown -R tetraslam:tetraslam "$OUT_DIR"
rm -f "$OUT_DIR/sprites.aatls"
ls -lh "$OUT_DIR"
