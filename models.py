import logging
import os
import subprocess
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import torch
import whisper
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
from TTS.api import TTS
from TTS.tts.configs.xtts_config import XttsConfig


LOGGER = logging.getLogger(__name__)

# Suppress non-critical Triton warnings about missing CUDA toolkit
# Whisper will fallback to slower implementations but will work fine
warnings.filterwarnings(
    "ignore",
    message=r"Failed to launch Triton kernels.*",
    category=UserWarning,
)


@dataclass
class ModelConfig:
    whisper_model_size: str = "medium"
    nllb_model_name: str = "facebook/nllb-200-distilled-600M"
    source_lang_nllb: str = "eng_Latn"
    target_lang_nllb: str = "spa_Latn"
    target_lang_xtts: str = "es"
    speaker_wav: str = "assets/speaker.wav"
    names_glossary_path: str = "assets/names.txt"
    cache_root: str = ".cache"
    device_preference: str = "auto"
    # Flags to control which model components to load. Useful for lightweight workflows
    # (e.g., subtitle generation which doesn't require TTS or VAD).
    load_vad: bool = True
    load_whisper: bool = True
    load_nllb: bool = True
    load_xtts: bool = True


class ModelManager:
    def __init__(self, config: ModelConfig):
        self.config = config
        self.device = self._select_device(config.device_preference)
        
        # Set CUDA device if using GPU
        if self.device == "cuda" and torch.cuda.is_available():
            torch.cuda.set_device(0)
        
        LOGGER.info("Device selection: preference=%s, selected=%s, cuda_available=%s", 
                    config.device_preference, self.device, torch.cuda.is_available())

        self.vad_model = None
        self.whisper_model = None
        self.nllb_tokenizer = None
        self.nllb_model = None
        self.tts_model = None
        self.name_glossary = self._load_name_glossary()

        self._configure_local_caches()

    def _select_device(self, device_preference: str) -> str:
        """Select device based on preference with smart fallback."""
        preference = (device_preference or "auto").strip().lower()
        
        if preference in ("gpu", "cuda"):
            # GPU preferred: use CUDA if available, fallback to CPU
            if torch.cuda.is_available():
                return "cuda"
            else:
                LOGGER.warning("GPU requested but CUDA is unavailable. Falling back to CPU.")
                return "cpu"
        elif preference == "cpu":
            # CPU explicitly requested
            return "cpu"
        else:
            # Auto mode: let PyTorch decide (CUDA if available, otherwise CPU)
            return "cuda" if torch.cuda.is_available() else "cpu"

    def _configure_local_caches(self) -> None:
        cache_root = Path(self.config.cache_root).resolve()
        cache_root.mkdir(parents=True, exist_ok=True)

        os.environ.setdefault("XDG_CACHE_HOME", str(cache_root))
        os.environ.setdefault("HF_HOME", str(cache_root / "huggingface"))
        os.environ.setdefault("TORCH_HOME", str(cache_root / "torch"))
        os.environ.setdefault("TTS_HOME", str(cache_root / "tts"))
        os.environ.setdefault("PIP_CACHE_DIR", str(cache_root / "pip"))
        # XTTS checkpoints require object deserialization that breaks with torch>=2.6 default.
        # This only affects trusted checkpoints downloaded by Coqui TTS into local cache.
        os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")
        # Reduce CUDA allocator fragmentation when models are reloaded mid-session.
        # Without this, "out of memory" can occur even when enough free VRAM exists.
        os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
        warnings.filterwarnings(
            "ignore",
            message=r"You are using `torch.load` with `weights_only=False`.*",
            category=FutureWarning,
            module=r"TTS(\..*)?",
        )

        # Japanese XTTS tokenizer relies on cutlet/fugashi + MeCab config.
        # On Windows, unidic-lite provides a local mecabrc file we can point to.
        if "MECABRC" not in os.environ:
            try:
                import unidic_lite

                mecabrc = Path(unidic_lite.DICDIR) / "mecabrc"
                if mecabrc.exists():
                    os.environ["MECABRC"] = str(mecabrc)
            except Exception:
                LOGGER.debug("unidic-lite not available; MECABRC not auto-configured")

    def load_all(self) -> None:
        LOGGER.info("Loading models on device: %s", self.device)
        # Load only the components requested in the config to reduce startup time
        if self.config.load_vad:
            self._load_vad()
        if self.config.load_whisper:
            self._load_whisper()
        if self.config.load_nllb:
            self._load_nllb()
        if self.config.load_xtts:
            self._load_xtts()
        LOGGER.info("All models loaded successfully")

    def reload_whisper(self) -> None:
        LOGGER.info("Reloading Whisper: %s", self.config.whisper_model_size)
        if self.whisper_model is not None:
            del self.whisper_model
            self.whisper_model = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        self._load_whisper()

    def _load_name_glossary(self) -> List[str]:
        path = Path(self.config.names_glossary_path)
        if not path.exists():
            return []

        names: List[str] = []
        try:
            for raw in path.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                names.append(line)
        except Exception:
            LOGGER.exception("Failed reading names glossary: %s", path)
            return []

        # Keep order stable while removing duplicates.
        deduped = list(dict.fromkeys(names))
        LOGGER.info("Loaded %d names from glossary", len(deduped))
        return deduped

    def build_transcription_prompt(self, whisper_language: Optional[str] = None) -> Optional[str]:
        if not self.name_glossary:
            return None

        samples = ", ".join(self.name_glossary[:20])
        lang_note = whisper_language or "auto"
        return (
            f"Language: {lang_note}. "
            f"Use these exact proper names when they appear in speech: {samples}."
        )

    def protect_terms(self, text: str) -> Tuple[str, Dict[str, str]]:
        if not text or not self.name_glossary:
            return text, {}

        protected = text
        placeholders: Dict[str, str] = {}
        index = 0
        for term in sorted(self.name_glossary, key=len, reverse=True):
            if term and term in protected:
                token = f"ZXQNAMETOKEN{index}ZXQ"
                protected = protected.replace(term, token)
                placeholders[token] = term
                index += 1

        return protected, placeholders

    def restore_terms(self, text: str, placeholders: Dict[str, str]) -> str:
        if not text or not placeholders:
            return text

        restored = text
        for token, term in placeholders.items():
            restored = restored.replace(token, term)
        return restored

    def _load_vad(self) -> None:
        LOGGER.info("Loading Silero VAD")
        model, _utils = torch.hub.load(
            repo_or_dir="snakers4/silero-vad",
            model="silero_vad",
            force_reload=False,
            onnx=False,
        )
        model.to(self.device)
        model.eval()
        model.reset_states()
        self.vad_model = model

    def _load_whisper(self) -> None:
        LOGGER.info("Loading Whisper: %s, device_preference: %s, cuda_available: %s", 
                    self.config.whisper_model_size, self.config.device_preference, torch.cuda.is_available())
        try:
            # Whisper.load_model() will handle device placement
            # Pass device parameter if CUDA is available and preferred
            if self.device == "cuda":
                self.whisper_model = whisper.load_model(
                    self.config.whisper_model_size, 
                    device="cuda"
                )
            else:
                self.whisper_model = whisper.load_model(
                    self.config.whisper_model_size, 
                    device="cpu"
                )
            
            LOGGER.info("Whisper loaded successfully on device: %s", self.device)
        except (RuntimeError, MemoryError) as e:
            if isinstance(e, MemoryError) or ("out of memory" in str(e).lower() and self.device == "cuda"):
                LOGGER.warning("Out of memory loading Whisper, falling back to CPU")
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                self.device = "cpu"
                try:
                    self.whisper_model = whisper.load_model(
                        self.config.whisper_model_size,
                        device="cpu",
                    )
                    LOGGER.info("Whisper loaded on CPU")
                except (RuntimeError, MemoryError) as cpu_err:
                    raise MemoryError(
                        f"Not enough memory to load Whisper '{self.config.whisper_model_size}' "
                        f"on CPU after CUDA OOM: {cpu_err}"
                    ) from None
            else:
                raise

    def _load_nllb(self) -> None:
        LOGGER.info("Loading NLLB: %s on device: %s", self.config.nllb_model_name, self.device)
        try:
            self.nllb_tokenizer = AutoTokenizer.from_pretrained(self.config.nllb_model_name)
            self.nllb_model = AutoModelForSeq2SeqLM.from_pretrained(self.config.nllb_model_name).to(self.device)
            self.nllb_model.eval()
            LOGGER.info("NLLB loaded successfully on %s", self.device)
        except RuntimeError as e:
            if "out of memory" in str(e).lower() and self.device == "cuda":
                LOGGER.warning("CUDA out of memory loading NLLB, falling back to CPU")
                torch.cuda.empty_cache()
                self.device = "cpu"
                self.nllb_tokenizer = AutoTokenizer.from_pretrained(self.config.nllb_model_name)
                self.nllb_model = AutoModelForSeq2SeqLM.from_pretrained(self.config.nllb_model_name).to("cpu")
                self.nllb_model.eval()
                LOGGER.info("NLLB reloaded on CPU")
            else:
                raise

    def _load_xtts(self) -> None:
        LOGGER.info("Loading XTTS v2 on device: %s", self.device)
        try:
            # Allow trusted XTTS config class during checkpoint load on newer torch versions.
            torch.serialization.add_safe_globals([XttsConfig])
            self.tts_model = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
            self.tts_model.to(self.device)
            LOGGER.info("XTTS loaded successfully on %s", self.device)
        except RuntimeError as e:
            if "out of memory" in str(e).lower() and self.device == "cuda":
                LOGGER.warning("CUDA out of memory loading XTTS, falling back to CPU")
                torch.cuda.empty_cache()
                self.device = "cpu"
                torch.serialization.add_safe_globals([XttsConfig])
                self.tts_model = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
                self.tts_model.to("cpu")
                LOGGER.info("XTTS reloaded on CPU")
            else:
                raise

    def transcribe(
        self,
        audio: np.ndarray,
        sample_rate: int,
        whisper_language: Optional[str] = None,
        initial_prompt: Optional[str] = None,
    ) -> str:
        if self.whisper_model is None:
            raise RuntimeError("Whisper model is not loaded")

        if audio.size == 0:
            return ""

        if sample_rate != 16000:
            raise ValueError("Whisper path expects 16kHz audio")

        audio = audio.astype(np.float32, copy=False)
        max_amp = np.max(np.abs(audio)) if audio.size else 1.0
        if max_amp > 1.0:
            audio = audio / max_amp

        # Let Whisper handle device detection automatically
        # Don't pass fp16 or device parameters as they can cause issues
        result = self.whisper_model.transcribe(
            audio,
            language=whisper_language,
            initial_prompt=initial_prompt,
        )
        return result.get("text", "").strip()

    def transcribe_with_timestamps(
        self,
        audio: np.ndarray,
        sample_rate: int,
        whisper_language: Optional[str] = None,
    ) -> dict:
        if self.whisper_model is None:
            raise RuntimeError("Whisper model is not loaded")
        
        if audio.size == 0:
            return {"text": "", "segments": []}

        if sample_rate != 16000:
            raise ValueError("Whisper expects 16kHz audio")

        audio = audio.astype(np.float32, copy=False)
        max_amp = np.max(np.abs(audio)) if audio.size else 1.0
        if max_amp > 1.0:
            audio = audio / max_amp

        # Let Whisper handle device detection automatically
        # Don't pass fp16 or device parameters as they can cause issues
        result = self.whisper_model.transcribe(
            audio,
            language=whisper_language,
            word_timestamps=True
        )
        return result

    def translate(
        self,
        text: str,
        source_lang_nllb: Optional[str] = None,
        target_lang_nllb: Optional[str] = None,
    ) -> str:
        if self.nllb_model is None or self.nllb_tokenizer is None:
            raise RuntimeError("NLLB model is not loaded")

        if not text.strip():
            return ""

        src_lang = source_lang_nllb or self.config.source_lang_nllb
        tgt_lang = target_lang_nllb or self.config.target_lang_nllb
        self.nllb_tokenizer.src_lang = src_lang

        tokenizer_inputs = self.nllb_tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            max_length=512,
        ).to(self.device)

        target_token_id = self.nllb_tokenizer.lang_code_to_id[tgt_lang]

        with torch.no_grad():
            generated_tokens = self.nllb_model.generate(
                **tokenizer_inputs,
                forced_bos_token_id=target_token_id,
                max_length=512,
            )

        translated = self.nllb_tokenizer.batch_decode(generated_tokens, skip_special_tokens=True)
        return translated[0].strip() if translated else ""

    def _to_wav(self, audio_path: str) -> str:
        """Return a WAV path, converting via ffmpeg if the file is WebM/MP3/etc.

        The converted file is cached alongside the original so conversion only
        runs once per uploaded file, not on every synthesis call.
        """
        p = Path(audio_path)
        if p.suffix.lower() == ".wav":
            return audio_path

        wav_path = p.with_suffix(".wav")
        if wav_path.exists() and wav_path.stat().st_mtime >= p.stat().st_mtime:
            return str(wav_path)

        try:
            import imageio_ffmpeg
            ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            ffmpeg_exe = "ffmpeg"

        try:
            result = subprocess.run(
                [ffmpeg_exe, "-y", "-i", str(p), "-ar", "22050", "-ac", "1", str(wav_path)],
                capture_output=True,
                timeout=60,
            )
        except FileNotFoundError:
            raise RuntimeError(
                "ffmpeg binary not found. Install imageio-ffmpeg: pip install imageio-ffmpeg"
            )
        if result.returncode != 0:
            raise RuntimeError(
                f"ffmpeg failed to convert {p.name} to WAV:\n"
                + result.stderr.decode(errors="replace")
            )
        LOGGER.info("Converted %s -> %s for XTTS speaker", p.name, wav_path.name)
        return str(wav_path)

    def synthesize(self, text: str, target_lang_xtts: Optional[str] = None) -> Tuple[np.ndarray, int]:
        if self.tts_model is None:
            raise RuntimeError("XTTS model is not loaded")

        if not text.strip():
            return np.array([], dtype=np.float32), 24000

        speaker_wav = Path(self.config.speaker_wav)
        if not speaker_wav.exists() or not speaker_wav.is_file():
            fallback = Path("assets/speaker.wav")
            if fallback.exists():
                LOGGER.warning("Speaker WAV not found or invalid: %s — using default speaker", speaker_wav)
                speaker_wav = fallback
            else:
                raise FileNotFoundError(f"Speaker WAV not found: {speaker_wav}")

        speaker_path = self._to_wav(str(speaker_wav))
        tts_lang = target_lang_xtts or self.config.target_lang_xtts

        wav = self.tts_model.tts(
            text=text,
            speaker_wav=speaker_path,
            language=tts_lang,
        )

        audio = np.array(wav, dtype=np.float32)
        if audio.size:
            peak = np.max(np.abs(audio))
            if peak > 0:
                audio = audio / peak

        return audio, 24000

    @torch.inference_mode()
    def vad_probability(self, frame_16k_mono: np.ndarray) -> float:
        if self.vad_model is None:
            raise RuntimeError("Silero VAD model is not loaded")

        frame = frame_16k_mono.astype(np.float32, copy=False)
        if frame.ndim != 1:
            frame = frame.reshape(-1)

        # Silero VAD expects at least 512 samples for 16 kHz input.
        if frame.shape[0] < 512:
            frame = np.pad(frame, (0, 512 - frame.shape[0]), mode="constant")

        tensor = torch.from_numpy(frame).to(self.device)
        prob = self.vad_model(tensor, 16000).item()
        return float(prob)

    def reset_vad_state(self) -> None:
        if self.vad_model is not None:
            self.vad_model.reset_states()

    def device_name(self) -> str:
        return self.device
