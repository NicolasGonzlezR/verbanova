import logging
import queue
import threading
from contextlib import contextmanager
from typing import Callable, Optional

import numpy as np
import sounddevice as sd

from vad import PhraseSegmenter


LOGGER = logging.getLogger(__name__)


class AudioInputWorker(threading.Thread):
    def __init__(
        self,
        segmenter: PhraseSegmenter,
        segments_queue: queue.Queue,
        stop_event: threading.Event,
        sample_rate: int = 16000,
        frame_ms: int = 30,
        input_device: Optional[int] = None,
    ):
        super().__init__(name="AudioInputWorker", daemon=True)
        self.segmenter = segmenter
        self.segments_queue = segments_queue
        self.stop_event = stop_event
        self.sample_rate = sample_rate
        self.frame_ms = frame_ms
        self.input_device = input_device
        self.blocksize = int(sample_rate * frame_ms / 1000)
        self.stream_sample_rate = sample_rate
        self.stream_blocksize = self.blocksize
        self.stream_channels = 1
        self._frames_queue: queue.Queue = queue.Queue(maxsize=200)

    @staticmethod
    def _is_recoverable_stream_error(exc: sd.PortAudioError) -> bool:
        text = str(exc).lower()
        recoverable_fragments = (
            "invalid sample rate",
            "unsupported format",
            "audclnt_e_unsupported_format",
            "unanticipated host error",
        )
        return any(fragment in text for fragment in recoverable_fragments)

    def _resample_to_target_rate(self, frame: np.ndarray) -> np.ndarray:
        if self.stream_sample_rate == self.sample_rate:
            return frame

        in_len = frame.shape[0]
        out_len = max(1, int(round(in_len * self.sample_rate / self.stream_sample_rate)))
        x_old = np.linspace(0.0, 1.0, num=in_len, endpoint=False)
        x_new = np.linspace(0.0, 1.0, num=out_len, endpoint=False)
        resampled = np.interp(x_new, x_old, frame).astype(np.float32, copy=False)
        return resampled

    @contextmanager
    def _open_stream_with_fallback(self):
        device_to_try = [self.input_device]
        if self.input_device is not None:
            device_to_try.append(None)

        last_error: Optional[Exception] = None
        for device_id in device_to_try:
            try:
                info = sd.query_devices(device_id, kind="input")
            except Exception:
                info = {}

            default_rate = int(round(float(info.get("default_samplerate", 0) or 0)))
            max_input_channels = int(info.get("max_input_channels", 1) or 1)
            max_input_channels = max(1, max_input_channels)

            candidate_rates = []
            for rate in (self.sample_rate, default_rate, 48000, 44100, 32000, 24000, 16000):
                if rate > 0 and rate not in candidate_rates:
                    candidate_rates.append(rate)

            candidate_channels = [1]
            if max_input_channels > 1:
                candidate_channels.append(min(2, max_input_channels))

            for rate in candidate_rates:
                for channels in candidate_channels:
                    for dtype in ("float32", "int16"):
                        self.stream_sample_rate = rate
                        self.stream_blocksize = max(1, int(rate * self.frame_ms / 1000))
                        self.stream_channels = channels
                        try:
                            with sd.InputStream(
                                samplerate=self.stream_sample_rate,
                                channels=self.stream_channels,
                                dtype=dtype,
                                blocksize=self.stream_blocksize,
                                device=device_id,
                                callback=self._audio_callback,
                            ):
                                if (
                                    self.stream_sample_rate != self.sample_rate
                                    or self.stream_channels != 1
                                    or dtype != "float32"
                                    or device_id != self.input_device
                                ):
                                    LOGGER.warning(
                                        "Input stream fallback active | requested_sr=%d | stream_sr=%d | channels=%d | dtype=%s | device=%s",
                                        self.sample_rate,
                                        self.stream_sample_rate,
                                        self.stream_channels,
                                        dtype,
                                        "default" if device_id is None else str(device_id),
                                    )
                                yield
                                return
                        except sd.PortAudioError as exc:
                            last_error = exc
                            if not self._is_recoverable_stream_error(exc):
                                raise
                            continue
                        except Exception as exc:
                            last_error = exc
                            continue

        if last_error is not None:
            raise last_error
        raise RuntimeError("Failed to initialize microphone input stream")

    def _audio_callback(self, indata, frames, time_info, status):
        if status:
            LOGGER.warning("Input stream status: %s", status)

        frame = indata
        if frame.ndim == 2 and frame.shape[1] > 1:
            frame = frame.mean(axis=1)
        elif frame.ndim == 2:
            frame = frame[:, 0]

        if np.issubdtype(frame.dtype, np.integer):
            info = np.iinfo(frame.dtype)
            denom = max(abs(info.min), info.max)
            frame = frame.astype(np.float32, copy=False) / float(denom)
        else:
            frame = frame.astype(np.float32, copy=False)

        frame = frame.copy()
        try:
            self._frames_queue.put_nowait(frame)
        except queue.Full:
            LOGGER.warning("Input frame queue full; dropping frame")

    def run(self) -> None:
        self.segmenter.reset()
        try:
            with self._open_stream_with_fallback():
                LOGGER.info(
                    "Microphone stream started | stream_sr=%d | target_sr=%d | channels=%d",
                    self.stream_sample_rate,
                    self.sample_rate,
                    self.stream_channels,
                )
                while not self.stop_event.is_set():
                    try:
                        frame = self._frames_queue.get(timeout=0.1)
                    except queue.Empty:
                        continue

                    if self.stream_sample_rate != self.sample_rate:
                        frame = self._resample_to_target_rate(frame)

                    try:
                        segment = self.segmenter.process_frame(frame)
                    except Exception:
                        LOGGER.exception("Frame processing failed; skipping frame")
                        continue
                    if segment is not None and segment.size > 0:
                        self.segments_queue.put(segment)
        except Exception:
            LOGGER.exception("Microphone input worker failed")
        finally:
            LOGGER.info("Microphone stream stopped")


class AudioOutputWorker(threading.Thread):
    def __init__(
        self,
        output_queue: queue.Queue,
        stop_event: threading.Event,
        on_error: Optional[Callable[[str], None]] = None,
        output_device: Optional[int] = None,
    ):
        super().__init__(name="AudioOutputWorker", daemon=True)
        self.output_queue = output_queue
        self.stop_event = stop_event
        self.on_error = on_error
        self.output_device = output_device

    def run(self) -> None:
        while not self.stop_event.is_set():
            try:
                item = self.output_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            if item is None:
                break

            audio, sample_rate = item
            try:
                if audio is None or len(audio) == 0:
                    continue
                sd.play(audio, sample_rate, blocking=True, device=self.output_device)
            except Exception as exc:
                LOGGER.exception("Audio playback failed")
                if self.on_error:
                    self.on_error(str(exc))

        try:
            sd.stop()
        except Exception:
            LOGGER.exception("Failed to stop audio device")
