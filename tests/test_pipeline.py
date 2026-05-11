"""
Unit tests for ProcessingWorker (pipeline.py).
All ML models are mocked — no heavy dependencies needed.
"""
import queue
import threading
from unittest.mock import MagicMock

import numpy as np
import pytest

from app.pipeline import ProcessingWorker


# ── helpers ───────────────────────────────────────────────────────────────────

AUDIO_SEGMENT = np.ones(512, dtype=np.float32)


def make_models(transcribed="Hello", translated="Hola", tts_audio=None):
    m = MagicMock()
    m.transcribe.return_value = transcribed
    m.translate.return_value = translated
    audio = tts_audio if tts_audio is not None else np.ones(512, dtype=np.float32)
    m.synthesize.return_value = (audio, 24000)
    m.protect_terms.side_effect = lambda text: (text, {})
    m.restore_terms.side_effect = lambda text, _: text
    m.build_transcription_prompt.return_value = None
    return m


def run_segment(models, segment=AUDIO_SEGMENT, timeout=2.0):
    """Run the worker with a single segment and collect results."""
    seg_q: queue.Queue = queue.Queue(maxsize=16)
    out_q: queue.Queue = queue.Queue(maxsize=16)
    stop = threading.Event()

    texts = []
    metrics = []
    errors = []

    worker = ProcessingWorker(
        models=models,
        segments_queue=seg_q,
        output_queue=out_q,
        stop_event=stop,
        input_lang_whisper="en",
        source_lang_nllb="eng_Latn",
        target_lang_nllb="spa_Latn",
        target_lang_xtts="es",
        on_text=lambda t, tr: texts.append((t, tr)),
        on_error=lambda e: errors.append(e),
        on_metrics=lambda m: metrics.append(m),
    )
    worker.start()
    seg_q.put(segment)
    seg_q.put(None)  # sentinel — exits the worker loop
    worker.join(timeout=timeout)

    return texts, metrics, errors, out_q, worker


# ── normal pipeline flow ───────────────────────────────────────────────────────

def test_full_pipeline_emits_text():
    models = make_models("Hello", "Hola")
    texts, _, errors, _, _ = run_segment(models)
    assert errors == []
    assert texts == [("Hello", "Hola")]


def test_full_pipeline_puts_audio_in_output_queue():
    models = make_models("Hello", "Hola")
    _, _, errors, out_q, _ = run_segment(models)
    assert errors == []
    assert not out_q.empty()
    audio, sr = out_q.get_nowait()
    assert sr == 24000
    assert isinstance(audio, np.ndarray)
    assert audio.size > 0


def test_metrics_reported_with_correct_keys():
    models = make_models("Hello", "Hola")
    _, metrics, errors, _, _ = run_segment(models)
    assert errors == []
    assert len(metrics) == 1
    m = metrics[0]
    for key in ("stt_ms", "translate_ms", "tts_ms", "total_ms"):
        assert key in m, f"Missing metric key: {key}"


def test_metrics_are_non_negative():
    models = make_models("Hello", "Hola")
    _, metrics, _, _, _ = run_segment(models)
    m = metrics[0]
    for key, val in m.items():
        assert val >= 0, f"Metric {key} is negative: {val}"


# ── empty transcription / translation ─────────────────────────────────────────

def test_empty_transcription_skips_rest_of_pipeline():
    models = make_models(transcribed="", translated="Hola")
    texts, metrics, errors, out_q, _ = run_segment(models)
    assert errors == []
    assert texts == []
    assert out_q.empty()
    assert metrics == []
    models.translate.assert_not_called()
    models.synthesize.assert_not_called()


def test_empty_translation_skips_tts():
    models = make_models(transcribed="Hello", translated="")
    texts, metrics, errors, out_q, _ = run_segment(models)
    assert errors == []
    assert texts == []
    assert out_q.empty()
    models.synthesize.assert_not_called()


def test_empty_tts_audio_not_put_in_queue():
    models = make_models("Hello", "Hola", tts_audio=np.array([], dtype=np.float32))
    _, _, errors, out_q, _ = run_segment(models)
    assert errors == []
    assert out_q.empty()


# ── error handling ─────────────────────────────────────────────────────────────

def test_transcription_error_calls_on_error():
    models = make_models()
    models.transcribe.side_effect = RuntimeError("transcription failed")
    _, _, errors, _, _ = run_segment(models)
    assert len(errors) == 1
    assert "transcription failed" in errors[0]


def test_translation_error_calls_on_error():
    models = make_models(transcribed="Hello")
    models.translate.side_effect = RuntimeError("translation failed")
    _, _, errors, _, _ = run_segment(models)
    assert len(errors) == 1
    assert "translation failed" in errors[0]


def test_tts_error_calls_on_error():
    models = make_models(transcribed="Hello", translated="Hola")
    models.synthesize.side_effect = RuntimeError("tts failed")
    _, _, errors, _, _ = run_segment(models)
    assert len(errors) == 1
    assert "tts failed" in errors[0]


def test_worker_continues_after_error():
    """After a processing error the worker must keep running, not crash."""
    models = make_models()
    models.transcribe.side_effect = [RuntimeError("boom"), "Hello"]
    models.translate.return_value = "Hola"

    seg_q: queue.Queue = queue.Queue(maxsize=16)
    out_q: queue.Queue = queue.Queue(maxsize=16)
    stop = threading.Event()
    errors = []
    texts = []

    worker = ProcessingWorker(
        models=models,
        segments_queue=seg_q,
        output_queue=out_q,
        stop_event=stop,
        input_lang_whisper="en",
        source_lang_nllb="eng_Latn",
        target_lang_nllb="spa_Latn",
        target_lang_xtts="es",
        on_error=lambda e: errors.append(e),
        on_text=lambda t, tr: texts.append((t, tr)),
    )
    worker.start()
    seg_q.put(AUDIO_SEGMENT)  # will raise
    seg_q.put(AUDIO_SEGMENT)  # should be processed normally
    seg_q.put(None)
    worker.join(timeout=2.0)

    assert not worker.is_alive()
    assert len(errors) == 1
    assert texts == [("Hello", "Hola")]


# ── stop event ────────────────────────────────────────────────────────────────

def test_stop_event_exits_worker():
    models = make_models()
    seg_q: queue.Queue = queue.Queue()
    out_q: queue.Queue = queue.Queue()
    stop = threading.Event()

    worker = ProcessingWorker(
        models=models,
        segments_queue=seg_q,
        output_queue=out_q,
        stop_event=stop,
        input_lang_whisper="en",
        source_lang_nllb="eng_Latn",
        target_lang_nllb="spa_Latn",
        target_lang_xtts="es",
    )
    worker.start()
    stop.set()
    worker.join(timeout=1.0)
    assert not worker.is_alive()


def test_sentinel_none_exits_worker():
    models = make_models()
    seg_q: queue.Queue = queue.Queue()
    out_q: queue.Queue = queue.Queue()
    stop = threading.Event()

    worker = ProcessingWorker(
        models=models,
        segments_queue=seg_q,
        output_queue=out_q,
        stop_event=stop,
        input_lang_whisper="en",
        source_lang_nllb="eng_Latn",
        target_lang_nllb="spa_Latn",
        target_lang_xtts="es",
    )
    worker.start()
    seg_q.put(None)
    worker.join(timeout=1.0)
    assert not worker.is_alive()


# ── invalid segment types ─────────────────────────────────────────────────────

def test_non_ndarray_segment_skipped():
    models = make_models()
    seg_q: queue.Queue = queue.Queue()
    out_q: queue.Queue = queue.Queue()
    stop = threading.Event()
    texts = []

    worker = ProcessingWorker(
        models=models,
        segments_queue=seg_q,
        output_queue=out_q,
        stop_event=stop,
        input_lang_whisper="en",
        source_lang_nllb="eng_Latn",
        target_lang_nllb="spa_Latn",
        target_lang_xtts="es",
        on_text=lambda t, tr: texts.append((t, tr)),
    )
    worker.start()
    seg_q.put("not an array")  # invalid type
    seg_q.put(None)
    worker.join(timeout=1.0)
    assert texts == []
    models.transcribe.assert_not_called()


def test_empty_ndarray_segment_skipped():
    models = make_models()
    seg_q: queue.Queue = queue.Queue()
    out_q: queue.Queue = queue.Queue()
    stop = threading.Event()
    texts = []

    worker = ProcessingWorker(
        models=models,
        segments_queue=seg_q,
        output_queue=out_q,
        stop_event=stop,
        input_lang_whisper="en",
        source_lang_nllb="eng_Latn",
        target_lang_nllb="spa_Latn",
        target_lang_xtts="es",
        on_text=lambda t, tr: texts.append((t, tr)),
    )
    worker.start()
    seg_q.put(np.array([], dtype=np.float32))  # empty array
    seg_q.put(None)
    worker.join(timeout=1.0)
    assert texts == []
    models.transcribe.assert_not_called()


# ── pipeline integration ──────────────────────────────────────────────────────

def test_two_segments_produce_two_text_results():
    """Worker processes each segment independently and emits one text per segment."""
    models = make_models("Hello", "Hola")
    seg_q: queue.Queue = queue.Queue(maxsize=16)
    out_q: queue.Queue = queue.Queue(maxsize=16)
    stop = threading.Event()
    texts = []

    worker = ProcessingWorker(
        models=models,
        segments_queue=seg_q,
        output_queue=out_q,
        stop_event=stop,
        input_lang_whisper="en",
        source_lang_nllb="eng_Latn",
        target_lang_nllb="spa_Latn",
        target_lang_xtts="es",
        on_text=lambda t, tr: texts.append((t, tr)),
    )
    worker.start()
    seg_q.put(AUDIO_SEGMENT)
    seg_q.put(AUDIO_SEGMENT)
    seg_q.put(None)
    worker.join(timeout=3.0)

    assert len(texts) == 2
    assert all(t == "Hello" and tr == "Hola" for t, tr in texts)


def test_protect_terms_called_with_transcribed_text():
    """protect_terms must receive the raw transcribed text."""
    models = make_models("Hello world", "Hola mundo")
    _, _, errors, _, _ = run_segment(models)
    assert errors == []
    models.protect_terms.assert_called_once_with("Hello world")
