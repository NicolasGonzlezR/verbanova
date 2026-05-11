from collections import deque
from dataclasses import dataclass
from typing import Deque, Optional

import numpy as np

from models import ModelManager


@dataclass
class VADConfig:
    sample_rate: int = 16000
    frame_ms: int = 32
    speech_threshold: float = 0.5
    silence_ms_to_split: int = 700
    max_phrase_seconds: float = 15.0
    pre_speech_ms: int = 240
    min_phrase_ms: int = 250


class PhraseSegmenter:
    def __init__(self, models: ModelManager, config: VADConfig):
        self.models = models
        self.config = config

        self.frame_samples = int(config.sample_rate * config.frame_ms / 1000)
        self.pre_frames: Deque[np.ndarray] = deque(maxlen=max(1, config.pre_speech_ms // config.frame_ms))

        self.in_speech = False
        self.silence_ms = 0
        self.current_frames = []
        self.current_samples = 0

    def reset(self) -> None:
        self.in_speech = False
        self.silence_ms = 0
        self.current_frames.clear()
        self.current_samples = 0
        self.pre_frames.clear()
        self.models.reset_vad_state()

    def _flush_if_valid(self) -> Optional[np.ndarray]:
        if not self.current_frames:
            return None

        audio = np.concatenate(self.current_frames).astype(np.float32, copy=False)
        min_samples = int(self.config.sample_rate * self.config.min_phrase_ms / 1000)
        if audio.shape[0] < min_samples:
            self.current_frames.clear()
            self.current_samples = 0
            return None

        self.current_frames.clear()
        self.current_samples = 0
        return audio

    def process_frame(self, frame: np.ndarray) -> Optional[np.ndarray]:
        self.pre_frames.append(frame)

        prob = self.models.vad_probability(frame)
        is_speech = prob >= self.config.speech_threshold

        max_samples = int(self.config.sample_rate * self.config.max_phrase_seconds)

        if is_speech:
            if not self.in_speech:
                self.in_speech = True
                self.silence_ms = 0
                if self.pre_frames:
                    self.current_frames.extend(list(self.pre_frames))
                    self.current_samples += sum(chunk.shape[0] for chunk in self.pre_frames)
            self.current_frames.append(frame)
            self.current_samples += frame.shape[0]
            self.silence_ms = 0
        elif self.in_speech:
            self.silence_ms += self.config.frame_ms
            self.current_frames.append(frame)
            self.current_samples += frame.shape[0]
            if self.silence_ms >= self.config.silence_ms_to_split:
                self.in_speech = False
                self.silence_ms = 0
                return self._flush_if_valid()

        if self.current_samples >= max_samples:
            self.in_speech = False
            self.silence_ms = 0
            return self._flush_if_valid()

        return None
