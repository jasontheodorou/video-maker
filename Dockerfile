# syntax=docker/dockerfile:1.7
#
# The video maker in one container: the web app, the engine, headless Chrome, FFmpeg, the Kokoro voice
# and whisper captions, with the voice and caption models baked in so the first video needs no downloads.
#
# Build (arm64 is the main target, for example an Oracle Cloud Ampere A1 VM or an Apple silicon Mac):
#   docker build -t video-assembly .
#   docker buildx build --platform linux/amd64 -t video-assembly:amd64 .   (also works)
#
# Run: see docker-compose.yml and docs/DEPLOY.md. Jobs, brands and caches live in /data (DATA_DIR).

ARG NODE_IMAGE=node:24.14.0-trixie-slim

# ---------- whisper-cli, built from source at a pinned version ----------
FROM ${NODE_IMAGE} AS whisper
ARG TARGETARCH
ARG WHISPER_VERSION=v1.9.5
# 1 builds whisper-cli for exactly this machine's CPU (-march=native). Only for building on the machine that
# runs it, such as the home kit's source build on an Arm board: a Raspberry Pi 4 lacks the ARMv8.2 features below.
ARG WHISPER_NATIVE=0
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates libopenblas-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "${WHISPER_VERSION}" https://github.com/ggml-org/whisper.cpp.git /src
WORKDIR /src
# GGML_NATIVE=OFF so the binary runs on any CPU of the target type, not only the build machine's.
# On arm64 it targets ARMv8.2 with dot product and fp16, which Ampere A1 (Neoverse N1) and Apple silicon have.
# On amd64, GGML_NATIVE=OFF on its own turns on AVX, AVX2, FMA, F16C and BMI2, which cheap mini PC chips such as
# the Celeron J4125, N5095 and N5105 do not have (they would stop with "Illegal instruction"). So amd64 gets two
# builds: whisper-cli-v3 (AVX2, FMA, F16C, BMI2: Haswell, Zen and N100 or newer) and whisper-cli-v2 (SSE4.2 only),
# and a small whisper-cli script picks the right one for the CPU when it runs.
# OpenBLAS makes the caption step about 2.5 times faster on 2 CPUs (measured: 21 s instead of 52 s a phrase).
# Debian's OpenBLAS picks its own CPU code when it runs, so it is safe on any CPU.
RUN set -e; ARCH="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    COMMON="-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_BLAS=ON -DGGML_BLAS_VENDOR=OpenBLAS \
      -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_SDL2=OFF -DWHISPER_CURL=OFF"; \
    build() { cmake -B "build-$1" $COMMON $2 && cmake --build "build-$1" --config Release -j"$(nproc)" --target whisper-cli \
      && strip "build-$1/bin/whisper-cli" && mkdir -p /out && cp "build-$1/bin/whisper-cli" "/out/whisper-cli-$1"; }; \
    if [ "$WHISPER_NATIVE" = "1" ]; then \
      build native "-DGGML_NATIVE=ON"; \
    elif [ "$ARCH" = "arm64" ]; then \
      build arm64 "-DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16"; \
    elif [ "$ARCH" = "amd64" ]; then \
      build v3 "-DGGML_SSE42=ON -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON -DGGML_BMI2=ON -DGGML_AVX512=OFF"; \
      build v2 "-DGGML_SSE42=ON -DGGML_AVX=OFF -DGGML_AVX2=OFF -DGGML_FMA=OFF -DGGML_F16C=OFF -DGGML_BMI2=OFF -DGGML_AVX512=OFF -DGGML_AVX_VNNI=OFF"; \
      if objdump -d /out/whisper-cli-v2 | grep -q '%ymm'; then echo "whisper-cli-v2 uses AVX instructions" >&2; exit 1; fi; \
      /out/whisper-cli-v2 --version; \
    else \
      build generic ""; \
    fi
COPY docker/whisper-cli /out/whisper-cli
RUN chmod 755 /out/* && /out/whisper-cli --version

# ---------- Node packages and the built pages ----------
FROM ${NODE_IMAGE} AS app
WORKDIR /app
ENV HUSKY=0 PUPPETEER_SKIP_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run app:build \
 && npm prune --omit=dev --no-audit --no-fund \
 && node -e "const v=require('./node_modules/hyperframes/package.json').version; if (v!=='0.9.8') { console.error('HyperFrames must be 0.9.8, found '+v); process.exit(1); }"

# ---------- the image that runs ----------
FROM ${NODE_IMAGE}
ARG TARGETARCH
# chrome-headless-shell version HyperFrames 0.9.8 expects (CHROME_VERSION in its code). Linux x64 only:
# Google does not publish it for Linux arm64, so arm64 uses Debian's Chromium (HyperFrames supports both).
ARG CHROME_HEADLESS_SHELL=152.0.7977.30

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    VIDEO_INTERPRETER_BACKEND=api \
    PATH=/opt/venv/bin:$PATH \
    HYPERFRAMES_PYTHON=/opt/venv/bin/python3 \
    HYPERFRAMES_NO_TELEMETRY=1 \
    DO_NOT_TRACK=1 \
    HYPERFRAMES_NO_UPDATE_CHECK=1 \
    HYPERFRAMES_NO_AUTO_INSTALL=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    CHROME_NO_SANDBOX=1

# FFmpeg, Python, fonts and the libraries Chrome needs. On arm64, Chromium itself.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates tini ffmpeg python3 python3-venv libgomp1 libopenblas0 libsndfile1 \
      fontconfig fonts-dejavu-core fonts-liberation fonts-noto-core \
      libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 \
      libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 libpango-1.0-0 libcairo2 libdbus-1-3 libexpat1 \
      libx11-6 libxcb1 libxext6 libglib2.0-0t64 libudev1 \
 && if [ "${TARGETARCH:-$(dpkg --print-architecture)}" = "arm64" ]; then apt-get install -y --no-install-recommends chromium; fi \
 && rm -rf /var/lib/apt/lists/*

# Kokoro in its own Python environment, with pinned versions.
COPY docker/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --upgrade pip==25.3 \
 && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt \
 && /opt/venv/bin/python3 -c "import kokoro_onnx, soundfile, onnxruntime; print('kokoro-onnx', kokoro_onnx.__name__, 'onnxruntime', onnxruntime.__version__)" \
 && rm /tmp/requirements.txt

COPY --from=whisper /out/ /usr/local/bin/

# The app runs as the image's "node" user (uid 1000), never as root.
# Models go where the engine and HyperFrames look for them: ~/.cache/hyperframes/...
ADD --chown=node:node --checksum=sha256:7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5 \
    https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx \
    /home/node/.cache/hyperframes/tts/models/kokoro-v1.0.onnx
ADD --chown=node:node --checksum=sha256:bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d \
    https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin \
    /home/node/.cache/hyperframes/tts/voices/voices-v1.0.bin
ADD --chown=node:node --checksum=sha256:c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.en.bin \
    /home/node/.cache/hyperframes/whisper/models/ggml-small.en.bin

WORKDIR /app
COPY --from=app --chown=node:node /app /app
# Only the folders change owner here: a recursive chown would copy the 840 MB of models into another layer.
RUN mkdir -p /data && chown node:node /data && find /home/node -type d -exec chown node:node {} +

USER node

# Chrome: chrome-headless-shell on amd64 (the fast capture path), Debian Chromium on arm64.
RUN if [ "${TARGETARCH:-$(dpkg --print-architecture)}" = "amd64" ]; then \
      node_modules/.bin/browsers install "chrome-headless-shell@${CHROME_HEADLESS_SHELL}" --path /home/node/.cache/puppeteer \
      && ! ldd /home/node/.cache/puppeteer/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell | grep "not found"; \
    else \
      /usr/bin/chromium --version; \
    fi

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini passes SIGTERM to the server (which stops the running video cleanly) and reaps Chrome's child processes.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--import", "tsx", "server/index.ts"]
