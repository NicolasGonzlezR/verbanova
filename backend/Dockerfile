# syntax=docker/dockerfile:1
# ─── Stage 1: builder ────────────────────────────────────────────────────────
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3.11-venv python3-pip git \
    && rm -rf /var/lib/apt/lists/*

RUN python3.11 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# PyTorch with CUDA 12.4 — must be installed before the rest to avoid
# pip resolving a CPU-only torch from PyPI
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
        torch==2.5.1 torchaudio==2.5.1 \
        --index-url https://download.pytorch.org/whl/cu124

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ─── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    # Fragmentation fix for CUDA allocator
    PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.11 libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app

# Application code — no binaries or caches
COPY app/ ./app/
COPY ../config/names.txt ./config/names.txt

# Mount points — populated at runtime by PersistentVolumes or host mounts:
#   /app/.cache   — Hugging Face / Torch / TTS model cache (~3-5 GB)
#   /app/uploads  — voice profile WAV files (shared with frontend)
VOLUME ["/app/.cache", "/app/uploads"]

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD python3.11 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

CMD ["python", "-m", "uvicorn", "app.server:app", "--host", "0.0.0.0", "--port", "8000"]
