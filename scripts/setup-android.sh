#!/usr/bin/env bash
# Installs the Android SDK needed to build PRESS (target API 36 — Google Play requirement since 31 Aug 2026).
#
# Usage:
#   scripts/setup-android.sh            # official route: cmdline-tools from dl.google.com + sdkmanager
#   scripts/setup-android.sh --docker   # fallback for networks that block dl.google.com:
#                                       # extracts the SDK from the public cimg/android Docker image layers
#   ANDROID_HOME=/custom/path scripts/setup-android.sh
#
# Afterwards:
#   export ANDROID_HOME=/opt/android-sdk
#   npm ci && npm run android:debug      # → android/app/build/outputs/apk/debug/app-debug.apk
#
# Note: Gradle still needs Google's Maven repository (dl.google.com / maven.google.com) for the
# Android Gradle Plugin, AndroidX, Play Services Ads and Play Billing. If your network blocks it,
# the GitHub Actions workflow (.github/workflows/android.yml) builds the APK instead.
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
PLATFORM="platforms;android-36"
BUILD_TOOLS="build-tools;36.0.0"
# Pin to a known commandline-tools release (same as the CircleCI image used by --docker).
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }; }
need curl
need java

java_major=$(java -version 2>&1 | sed -nE 's/.*version "([0-9]+).*/\1/p' | head -1)
if [ "${java_major:-0}" -lt 21 ]; then
  echo "JDK 21+ is required (found ${java_major:-none}). Install e.g. openjdk-21-jdk." >&2
  exit 1
fi

mkdir -p "$ANDROID_HOME"

official() {
  need unzip
  echo "→ Downloading Android command-line tools"
  tmp=$(mktemp -d)
  curl -fsSL "$CMDLINE_TOOLS_URL" -o "$tmp/cmdline-tools.zip"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  rm -rf "$ANDROID_HOME/cmdline-tools/latest"
  unzip -q "$tmp/cmdline-tools.zip" -d "$tmp"
  mv "$tmp/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  rm -rf "$tmp"
  local sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
  echo "→ Accepting licenses (review them at https://developer.android.com/studio/terms)"
  # `yes` dies of SIGPIPE when sdkmanager exits; that 141 must not abort the script (pipefail).
  (yes || true) | "$sdkmanager" --sdk_root="$ANDROID_HOME" --licenses >/dev/null
  echo "→ Installing $PLATFORM, $BUILD_TOOLS, platform-tools"
  "$sdkmanager" --sdk_root="$ANDROID_HOME" "$PLATFORM" "$BUILD_TOOLS" "platform-tools"
}

docker_layers() {
  need python3
  need tar
  local img="cimg/android" tag="2026.08.1"
  echo "→ Fetching Android SDK layers from docker.io/$img:$tag (no Docker daemon needed)"
  local token index manifest
  token=$(curl -fsSL "https://auth.docker.io/token?service=registry.docker.io&scope=repository:$img:pull" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
  local accept="application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json"
  index=$(curl -fsSL -H "Authorization: Bearer $token" -H "Accept: $accept" "https://registry-1.docker.io/v2/$img/manifests/$tag")
  local digest
  digest=$(printf '%s' "$index" | python3 -c '
import sys,json
d=json.load(sys.stdin)
for m in d.get("manifests",[]):
  p=m.get("platform",{})
  if p.get("architecture")=="amd64" and p.get("os")=="linux": print(m["digest"]); break
')
  manifest=$(curl -fsSL -H "Authorization: Bearer $token" -H "Accept: $accept" "https://registry-1.docker.io/v2/$img/manifests/$digest")
  local config
  config=$(printf '%s' "$manifest" | python3 -c 'import sys,json;print(json.load(sys.stdin)["config"]["digest"])')
  # Pick the layers whose build step installs the SDK (cmdline-tools, build-tools, platforms).
  local layers mf
  mf=$(mktemp)
  printf '%s' "$manifest" > "$mf"
  layers=$(python3 - "$token" "$img" "$config" "$mf" <<'PY'
import json, subprocess, sys
token, img, config, mf = sys.argv[1:5]
manifest = json.load(open(mf))
cfg = json.loads(subprocess.check_output(["curl", "-fsSL", "-H", f"Authorization: Bearer {token}",
    f"https://registry-1.docker.io/v2/{img}/blobs/{config}"]))
hist = [h for h in cfg["history"] if not h.get("empty_layer")]
for layer, h in zip(manifest["layers"], hist):
    cmd = h.get("created_by", "")
    if "commandlinetools" in cmd or 'sdkmanager "platform-tools"' in cmd or 'sdkmanager "platforms;android-' in cmd:
        print(layer["digest"])
PY
)
  rm -f "$mf"
  for digest in $layers; do
    echo "  layer $digest"
    curl -fsSL --retry 4 -H "Authorization: Bearer $token" "https://registry-1.docker.io/v2/$img/blobs/$digest" |
      tar -xz -C "$ANDROID_HOME" --strip-components=3 --wildcards 'home/circleci/android-sdk/*'
  done
  # Keep only what PRESS needs (saves ~2 GB).
  rm -rf "$ANDROID_HOME/emulator" "$ANDROID_HOME/tools"
  find "$ANDROID_HOME/platforms" -mindepth 1 -maxdepth 1 ! -name 'android-36' ! -name 'android-35' -exec rm -rf {} +
  find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 ! -name '36.0.0' ! -name '35.0.0' -exec rm -rf {} +
}

if [ "${1:-}" = "--docker" ]; then docker_layers; else official; fi

echo "sdk.dir=$ANDROID_HOME" > "$(dirname "$0")/../android/local.properties"
echo "✓ Android SDK ready at $ANDROID_HOME"
ls "$ANDROID_HOME/platforms" "$ANDROID_HOME/build-tools"
echo "Next: export ANDROID_HOME=$ANDROID_HOME && npm ci && npm run android:debug"
