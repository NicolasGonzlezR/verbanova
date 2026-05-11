import logging
import queue
import threading
import time
from typing import Callable, Optional

import numpy as np

from .models import ModelManager


LOGGER = logging.getLogger(__name__)


class ProcessingWorker(threading.Thread):
    def __init__(
        self,
        models: ModelManager,
        segments_queue: queue.Queue,
        output_queue: queue.Queue,
        stop_event: threading.Event,
        input_lang_whisper: str,
        source_lang_nllb: str,
        target_lang_nllb: str,
        target_lang_xtts: str,
        on_text: Optional[Callable[[str, str], None]] = None,
        on_error: Optional[Callable[[str], None]] = None,
        on_metrics: Optional[Callable[[dict], None]] = None,
    ):
        super().__init__(name="ProcessingWorker", daemon=True)
        self.models = models
        self.segments_queue = segments_queue
        self.output_queue = output_queue
        self.stop_event = stop_event
        self.input_lang_whisper = input_lang_whisper
        self.source_lang_nllb = source_lang_nllb
        self.target_lang_nllb = target_lang_nllb
        self.target_lang_xtts = target_lang_xtts
        self.on_text = on_text
        self.on_error = on_error
        self.on_metrics = on_metrics

    def run(self) -> None:
        while not self.stop_event.is_set():
            try:
                segment = self.segments_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            if segment is None:
                break

            if not isinstance(segment, np.ndarray) or segment.size == 0:
                continue

            try:
                total_start = time.perf_counter()

                prompt = self.models.build_transcription_prompt(self.input_lang_whisper)
                stt_start = time.perf_counter()
                transcribed = self.models.transcribe(
                    segment,
                    sample_rate=16000,
                    whisper_language=self.input_lang_whisper,
                    initial_prompt=prompt,
                )
                stt_ms = (time.perf_counter() - stt_start) * 1000.0
                if not transcribed:
                    continue

                protected_text, placeholders = self.models.protect_terms(transcribed)

                mt_start = time.perf_counter()
                translated = self.models.translate(
                    protected_text,
                    source_lang_nllb=self.source_lang_nllb,
                    target_lang_nllb=self.target_lang_nllb,
                )
                mt_ms = (time.perf_counter() - mt_start) * 1000.0
                if not translated:
                    continue

                translated = self.models.restore_terms(translated, placeholders)

                if self.on_text:
                    self.on_text(transcribed, translated)

                tts_start = time.perf_counter()
                tts_audio, tts_sr = self.models.synthesize(
                    translated,
                    target_lang_xtts=self.target_lang_xtts,
                )
                tts_ms = (time.perf_counter() - tts_start) * 1000.0
                if tts_audio.size == 0:
                    continue

                total_ms = (time.perf_counter() - total_start) * 1000.0
                if self.on_metrics:
                    self.on_metrics(
                        {
                            "stt_ms": stt_ms,
                            "translate_ms": mt_ms,
                            "tts_ms": tts_ms,
                            "total_ms": total_ms,
                        }
                    )

                self.output_queue.put((tts_audio, tts_sr))
            except Exception as exc:
                LOGGER.exception("Processing pipeline failed")
                if self.on_error:
                    self.on_error(str(exc))
