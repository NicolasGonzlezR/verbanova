# Real-Time Speech-to-Speech Translation with Voice Cloning (Windows)

This project provides a modular MVP for real-time phrase-based speech translation with voice cloning.

Pipeline:
1. Microphone input (`sounddevice`)
2. Silero VAD phrase segmentation
3. Whisper transcription
4. NLLB translation
5. XTTS v2 voice-cloned synthesis
6. Speaker playback (`sounddevice`)
7. Tkinter GUI with Start/Stop controls

## Project Structure

- `main.py`: Tkinter GUI and app lifecycle
- `audio.py`: input/output audio workers
- `vad.py`: speech/silence phrase segmentation logic
- `pipeline.py`: transcription/translation/synthesis worker
- `models.py`: one-time model loading and inference
- `requirements.txt`: Python dependencies
- `scripts/setup_windows.ps1`: local setup script that keeps caches on this drive

## Important: Keep installs and model caches off C:

This repository is designed to keep artifacts local under this folder:
- virtual environment: `.venv`
- model/package caches: `.cache`

The setup script exports:
- `PIP_CACHE_DIR`
- `HF_HOME`
- `TORCH_HOME`
- `XDG_CACHE_HOME`
- `TTS_HOME`

All are pointed to `.cache/...` inside this workspace.

## 1) Setup (PowerShell)

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\scripts\setup_windows.ps1
```

### Setup with NVIDIA GPU (CUDA)

If you want GPU acceleration on NVIDIA hardware, run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\scripts\setup_windows.ps1 -UseCuda
```

This installs `torch` and `torchaudio` from the PyTorch `cu124` index.

## 2) Add your reference voice file

Place a short clean sample at:

- `assets/speaker.wav`

You can also add multiple speaker profiles using folders:

- `assets/speaker1/speaker.wav`
- `assets/speaker2/speaker.wav`
- `assets/my_voice/speaker.wav`

Then use the **Speaker profile** dropdown in the app and click **Refresh speakers**.

### Improve person-name recognition

Add names to `assets/names.txt` (one per line), for example:

```text
Nicolas
Maria
Takeshi
王伟
```

The app uses this list to:
- bias Whisper transcription with an initial prompt
- protect known names before translation and restore them afterwards

## 3) Run the app

```powershell
.\.venv\Scripts\python.exe .\main.py
```

## Notes

- First startup can take time because models are downloaded.
- If CUDA is available and your PyTorch build supports it, models run on GPU automatically.
- Latency of a few seconds is expected in this MVP.
- `torch` is pinned below 2.6 in `requirements.txt` for current XTTS checkpoint compatibility.

## Optional configuration

Open `models.py` and adjust `ModelConfig` defaults, for example:
- `whisper_model_size`
- `source_lang_nllb`
- `target_lang_nllb`
- `target_lang_xtts`
- `speaker_wav`
