"""
Unit tests for PhraseSegmenter (vad.py).
The ModelManager is fully mocked — no ML model is loaded.
"""
from unittest.mock import MagicMock

import numpy as np
import pytest

from app.vad import PhraseSegmenter, VADConfig


SR = 16000
FRAME_MS = 32
FRAME_SAMPLES = SR * FRAME_MS // 1000  # 512


@pytest.fixture
def config():
    return VADConfig(
        sample_rate=SR,
        frame_ms=FRAME_MS,
        speech_threshold=0.5,
        silence_ms_to_split=160,   # 5 frames of silence → flush
        max_phrase_seconds=1.0,    # short for tests
        pre_speech_ms=64,          # 2 pre-frames
        min_phrase_ms=64,          # 2 frames minimum phrase
    )


@pytest.fixture
def silent_models():
    m = MagicMock()
    m.vad_probability.return_value = 0.0
    return m


@pytest.fixture
def segmenter(silent_models, config):
    return PhraseSegmenter(silent_models, config)


def make_frame(value: float = 0.0) -> np.ndarray:
    return np.full(FRAME_SAMPLES, value, dtype=np.float32)


# ── frame_samples ──────────────────────────────────────────────────────────────

def test_frame_samples_matches_config(segmenter):
    assert segmenter.frame_samples == FRAME_SAMPLES


# ── silence only ───────────────────────────────────────────────────────────────

def test_silence_frame_returns_none(segmenter):
    assert segmenter.process_frame(make_frame()) is None


def test_multiple_silence_frames_never_emit(segmenter):
    for _ in range(20):
        assert segmenter.process_frame(make_frame()) is None


# ── single speech frame without trailing silence ───────────────────────────────

def test_single_speech_frame_no_trailing_silence_returns_none(silent_models, config):
    silent_models.vad_probability.return_value = 0.9
    seg = PhraseSegmenter(silent_models, config)
    result = seg.process_frame(make_frame())
    assert result is None


# ── full speech → silence → emit ──────────────────────────────────────────────

def test_speech_then_silence_emits_segment(silent_models, config):
    silent_models.vad_probability.return_value = 0.9
    seg = PhraseSegmenter(silent_models, config)

    # Accumulate enough speech to exceed min_phrase_ms
    n_speech = config.min_phrase_ms // config.frame_ms + 2
    for _ in range(n_speech):
        assert seg.process_frame(make_frame()) is None

    # Now silence until flush threshold
    silent_models.vad_probability.return_value = 0.0
    n_silence = config.silence_ms_to_split // config.frame_ms + 1
    emitted = None
    for _ in range(n_silence):
        emitted = seg.process_frame(make_frame())
        if emitted is not None:
            break

    assert emitted is not None
    assert isinstance(emitted, np.ndarray)
    assert emitted.size > 0


def test_emitted_audio_is_float32(silent_models, config):
    silent_models.vad_probability.return_value = 0.9
    seg = PhraseSegmenter(silent_models, config)

    n_speech = config.min_phrase_ms // config.frame_ms + 2
    for _ in range(n_speech):
        seg.process_frame(make_frame())

    silent_models.vad_probability.return_value = 0.0
    n_silence = config.silence_ms_to_split // config.frame_ms + 1
    emitted = None
    for _ in range(n_silence):
        emitted = seg.process_frame(make_frame())
        if emitted is not None:
            break

    assert emitted is not None
    assert emitted.dtype == np.float32


# ── too-short phrase is discarded ─────────────────────────────────────────────

def test_too_short_phrase_is_discarded(silent_models):
    """
    min_phrase_ms must exceed the total accumulated audio (pre-frames + speech
    + trailing silence) to actually discard the segment.  Use a very large
    min_phrase_ms with the smallest possible silence window so trailing silence
    doesn't pad the segment past the threshold.
    """
    cfg = VADConfig(
        sample_rate=SR,
        frame_ms=FRAME_MS,
        speech_threshold=0.5,
        silence_ms_to_split=FRAME_MS,  # flush after just 1 silence frame
        max_phrase_seconds=60.0,
        pre_speech_ms=0,               # no pre-frames (deque maxlen clamped to 1)
        min_phrase_ms=10_000,          # 10 s — impossible to reach with 1 speech frame
    )
    seg = PhraseSegmenter(silent_models, cfg)

    # One speech frame followed by one silence frame (triggers flush immediately)
    silent_models.vad_probability.return_value = 0.9
    seg.process_frame(make_frame())

    silent_models.vad_probability.return_value = 0.0
    result = seg.process_frame(make_frame())  # silence → flush

    # The segment is far shorter than 10 s → discarded
    assert result is None


# ── max-duration flush ─────────────────────────────────────────────────────────

def test_max_duration_triggers_flush(silent_models, config):
    silent_models.vad_probability.return_value = 0.9
    seg = PhraseSegmenter(silent_models, config)

    max_samples = int(config.sample_rate * config.max_phrase_seconds)
    n_frames = max_samples // FRAME_SAMPLES + 2

    emitted = None
    for _ in range(n_frames):
        emitted = seg.process_frame(make_frame())
        if emitted is not None:
            break

    assert emitted is not None


# ── reset ──────────────────────────────────────────────────────────────────────

def test_reset_clears_in_speech(silent_models, config):
    silent_models.vad_probability.return_value = 0.9
    seg = PhraseSegmenter(silent_models, config)
    for _ in range(5):
        seg.process_frame(make_frame())
    assert seg.in_speech is True

    seg.reset()
    assert seg.in_speech is False


def test_reset_clears_accumulated_frames(silent_models, config):
    silent_models.vad_probability.return_value = 0.9
    seg = PhraseSegmenter(silent_models, config)
    for _ in range(5):
        seg.process_frame(make_frame())

    seg.reset()
    assert seg.current_samples == 0
    assert len(seg.current_frames) == 0


def test_reset_clears_silence_counter(silent_models, config):
    silent_models.vad_probability.return_value = 0.9
    seg = PhraseSegmenter(silent_models, config)
    seg.process_frame(make_frame())
    silent_models.vad_probability.return_value = 0.0
    seg.process_frame(make_frame())  # starts accumulating silence

    seg.reset()
    assert seg.silence_ms == 0


def test_reset_calls_model_reset(silent_models, config):
    seg = PhraseSegmenter(silent_models, config)
    seg.reset()
    silent_models.reset_vad_state.assert_called_once()


# ── pre-speech buffer ──────────────────────────────────────────────────────────

def test_pre_speech_frames_included_in_segment(silent_models, config):
    """The pre-speech buffer should be prepended to the detected phrase."""
    seg = PhraseSegmenter(silent_models, config)

    # Feed some silent pre-frames
    silent_models.vad_probability.return_value = 0.0
    for _ in range(3):
        seg.process_frame(make_frame())

    # Now speech starts
    silent_models.vad_probability.return_value = 0.9
    n_speech = config.min_phrase_ms // config.frame_ms + 2
    for _ in range(n_speech):
        seg.process_frame(make_frame())

    # Silence to flush
    silent_models.vad_probability.return_value = 0.0
    n_silence = config.silence_ms_to_split // config.frame_ms + 1
    emitted = None
    for _ in range(n_silence):
        emitted = seg.process_frame(make_frame())
        if emitted is not None:
            break

    # The segment should be longer than just the speech frames (pre-frames included)
    assert emitted is not None
    n_pre = config.pre_speech_ms // config.frame_ms
    min_expected = (n_speech + n_pre) * FRAME_SAMPLES
    assert emitted.size >= min_expected


# ── speech threshold boundary ──────────────────────────────────────────────────

def test_speech_at_exact_threshold_is_speech(silent_models, config):
    """Probability exactly equal to the threshold counts as speech."""
    silent_models.vad_probability.return_value = config.speech_threshold
    seg = PhraseSegmenter(silent_models, config)
    seg.process_frame(make_frame())
    assert seg.in_speech is True


def test_speech_below_threshold_is_silence(silent_models, config):
    """Probability strictly below the threshold does not trigger speech state."""
    silent_models.vad_probability.return_value = config.speech_threshold - 0.01
    seg = PhraseSegmenter(silent_models, config)
    seg.process_frame(make_frame())
    assert seg.in_speech is False


# ── pre_frames deque bound ─────────────────────────────────────────────────────

def test_pre_speech_maxlen_matches_config():
    """pre_frames deque maxlen equals pre_speech_ms // frame_ms."""
    cfg = VADConfig(sample_rate=SR, frame_ms=FRAME_MS, pre_speech_ms=64)
    models = MagicMock()
    models.vad_probability.return_value = 0.0
    seg = PhraseSegmenter(models, cfg)
    assert seg.pre_frames.maxlen == 64 // FRAME_MS  # == 2


# ── silence counter accumulation ──────────────────────────────────────────────

def test_silence_ms_accumulates_per_frame(silent_models, config):
    """Each non-speech frame while in_speech increments silence_ms by frame_ms."""
    silent_models.vad_probability.return_value = 0.9
    seg = PhraseSegmenter(silent_models, config)
    seg.process_frame(make_frame())
    assert seg.in_speech is True

    silent_models.vad_probability.return_value = 0.0
    seg.process_frame(make_frame())
    assert seg.silence_ms == config.frame_ms
    seg.process_frame(make_frame())
    assert seg.silence_ms == config.frame_ms * 2


# ── frame_samples scaling ──────────────────────────────────────────────────────

def test_frame_samples_scales_with_sample_rate():
    """frame_samples is correctly derived from sample_rate and frame_ms."""
    cfg = VADConfig(sample_rate=8000, frame_ms=32)
    models = MagicMock()
    models.vad_probability.return_value = 0.0
    seg = PhraseSegmenter(models, cfg)
    assert seg.frame_samples == 8000 * 32 // 1000  # == 256
