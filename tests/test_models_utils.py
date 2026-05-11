"""
Unit tests for ModelManager utility methods.
These tests do NOT load any ML model — only pure Python logic is exercised.
"""
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest


# ── _select_device ────────────────────────────────────────────────────────────

class TestSelectDevice:
    def test_cpu_explicit_always_returns_cpu(self, model_manager):
        with patch("torch.cuda.is_available", return_value=True):
            assert model_manager._select_device("cpu") == "cpu"

    def test_cpu_explicit_no_cuda(self, model_manager):
        with patch("torch.cuda.is_available", return_value=False):
            assert model_manager._select_device("cpu") == "cpu"

    def test_gpu_with_cuda_available(self, model_manager):
        with patch("torch.cuda.is_available", return_value=True):
            assert model_manager._select_device("gpu") == "cuda"

    def test_gpu_without_cuda_falls_back_to_cpu(self, model_manager):
        with patch("torch.cuda.is_available", return_value=False):
            assert model_manager._select_device("gpu") == "cpu"

    def test_auto_with_cuda(self, model_manager):
        with patch("torch.cuda.is_available", return_value=True):
            assert model_manager._select_device("auto") == "cuda"

    def test_auto_without_cuda(self, model_manager):
        with patch("torch.cuda.is_available", return_value=False):
            assert model_manager._select_device("auto") == "cpu"

    def test_cuda_alias(self, model_manager):
        with patch("torch.cuda.is_available", return_value=True):
            assert model_manager._select_device("cuda") == "cuda"

    def test_none_treated_as_auto(self, model_manager):
        with patch("torch.cuda.is_available", return_value=False):
            assert model_manager._select_device(None) == "cpu"

    def test_unknown_value_treated_as_auto(self, model_manager):
        with patch("torch.cuda.is_available", return_value=False):
            assert model_manager._select_device("unknown") == "cpu"


# ── _load_name_glossary ───────────────────────────────────────────────────────

class TestLoadNameGlossary:
    def test_loads_names_from_file(self, model_manager):
        # conftest seeds the file with Nicolas, Maria, Takeshi
        assert "Nicolas" in model_manager.name_glossary
        assert "Maria" in model_manager.name_glossary
        assert "Takeshi" in model_manager.name_glossary

    def test_skips_comments_and_blank_lines(self, model_manager):
        assert len(model_manager.name_glossary) == 3

    def test_missing_file_returns_empty(self, tmp_path):
        from app.models import ModelConfig, ModelManager

        cfg = ModelConfig(
            cache_root=str(tmp_path / "cache"),
            names_glossary_path=str(tmp_path / "nonexistent.txt"),
        )
        mm = ModelManager(cfg)
        assert mm.name_glossary == []

    def test_deduplicates_names(self, tmp_path):
        names_file = tmp_path / "names.txt"
        names_file.write_text("Alice\nAlice\nBob\n")

        from app.models import ModelConfig, ModelManager

        cfg = ModelConfig(
            cache_root=str(tmp_path / "cache"),
            names_glossary_path=str(names_file),
        )
        mm = ModelManager(cfg)
        assert mm.name_glossary.count("Alice") == 1
        assert len(mm.name_glossary) == 2


# ── build_transcription_prompt ────────────────────────────────────────────────

class TestBuildTranscriptionPrompt:
    def test_returns_none_with_empty_glossary(self, tmp_path):
        from app.models import ModelConfig, ModelManager

        cfg = ModelConfig(
            cache_root=str(tmp_path / "cache"),
            names_glossary_path=str(tmp_path / "empty.txt"),
        )
        (tmp_path / "empty.txt").write_text("")
        mm = ModelManager(cfg)
        assert mm.build_transcription_prompt() is None

    def test_includes_names_and_language(self, model_manager):
        prompt = model_manager.build_transcription_prompt("en")
        assert prompt is not None
        assert "Nicolas" in prompt
        assert "en" in prompt

    def test_limits_to_first_20_names(self, tmp_path):
        names = [f"Name{i}" for i in range(30)]
        names_file = tmp_path / "names.txt"
        names_file.write_text("\n".join(names))

        from app.models import ModelConfig, ModelManager

        cfg = ModelConfig(
            cache_root=str(tmp_path / "cache"),
            names_glossary_path=str(names_file),
        )
        mm = ModelManager(cfg)
        prompt = mm.build_transcription_prompt("es")
        # Only first 20 names should appear
        assert "Name19" in prompt
        assert "Name20" not in prompt


# ── protect_terms / restore_terms ─────────────────────────────────────────────

class TestProtectRestoreTerms:
    def test_roundtrip_with_known_name(self, model_manager):
        original = "Hello Nicolas, how are you?"
        protected, placeholders = model_manager.protect_terms(original)
        assert "Nicolas" not in protected
        assert len(placeholders) == 1
        restored = model_manager.restore_terms(protected, placeholders)
        assert restored == original

    def test_multiple_names(self, model_manager):
        original = "Nicolas and Maria are friends."
        protected, placeholders = model_manager.protect_terms(original)
        assert "Nicolas" not in protected
        assert "Maria" not in protected
        assert len(placeholders) == 2
        assert model_manager.restore_terms(protected, placeholders) == original

    def test_name_not_in_text_unchanged(self, model_manager):
        original = "Hello world."
        protected, placeholders = model_manager.protect_terms(original)
        assert protected == original
        assert placeholders == {}

    def test_empty_text_unchanged(self, model_manager):
        protected, placeholders = model_manager.protect_terms("")
        assert protected == ""
        assert placeholders == {}

    def test_restore_with_empty_placeholders(self, model_manager):
        assert model_manager.restore_terms("Hello.", {}) == "Hello."

    def test_longer_name_matched_first(self, tmp_path):
        """Longer names take precedence over shorter substrings."""
        names_file = tmp_path / "names.txt"
        names_file.write_text("San\nSantiago\n")

        from app.models import ModelConfig, ModelManager

        cfg = ModelConfig(
            cache_root=str(tmp_path / "cache"),
            names_glossary_path=str(names_file),
        )
        mm = ModelManager(cfg)
        original = "I visited Santiago last year."
        protected, placeholders = mm.protect_terms(original)
        # "Santiago" should be replaced as a whole, not "San" first
        assert "Santiago" not in protected
        restored = mm.restore_terms(protected, placeholders)
        assert restored == original


# ── ModelConfig defaults ───────────────────────────────────────────────────────

class TestModelConfig:
    def test_default_whisper_model_size(self):
        from app.models import ModelConfig
        assert ModelConfig().whisper_model_size == "medium"

    def test_default_device_preference(self):
        from app.models import ModelConfig
        assert ModelConfig().device_preference == "auto"

    def test_load_flags_all_true_by_default(self):
        from app.models import ModelConfig
        cfg = ModelConfig()
        assert cfg.load_vad is True
        assert cfg.load_whisper is True
        assert cfg.load_nllb is True
        assert cfg.load_xtts is True


# ── transcribe validation ──────────────────────────────────────────────────────

class TestTranscribeValidation:
    def test_raises_without_whisper_model(self, tmp_path):
        from app.models import ModelConfig, ModelManager
        cfg = ModelConfig(cache_root=str(tmp_path / "cache"))
        mm = ModelManager(cfg)
        with pytest.raises(RuntimeError, match="Whisper model is not loaded"):
            mm.transcribe(np.ones(16000, dtype=np.float32), sample_rate=16000)

    def test_returns_empty_for_empty_audio(self, tmp_path):
        from app.models import ModelConfig, ModelManager
        cfg = ModelConfig(cache_root=str(tmp_path / "cache"))
        mm = ModelManager(cfg)
        mm.whisper_model = MagicMock()
        result = mm.transcribe(np.array([], dtype=np.float32), sample_rate=16000)
        assert result == ""
        mm.whisper_model.transcribe.assert_not_called()

    def test_raises_for_wrong_sample_rate(self, tmp_path):
        from app.models import ModelConfig, ModelManager
        cfg = ModelConfig(cache_root=str(tmp_path / "cache"))
        mm = ModelManager(cfg)
        mm.whisper_model = MagicMock()
        with pytest.raises(ValueError, match="16kHz"):
            mm.transcribe(np.ones(8000, dtype=np.float32), sample_rate=8000)


# ── translate validation ───────────────────────────────────────────────────────

class TestTranslateValidation:
    def test_raises_without_nllb_model(self, tmp_path):
        from app.models import ModelConfig, ModelManager
        cfg = ModelConfig(cache_root=str(tmp_path / "cache"))
        mm = ModelManager(cfg)
        with pytest.raises(RuntimeError, match="NLLB model is not loaded"):
            mm.translate("Hello world")

    def test_returns_empty_for_whitespace_input(self, tmp_path):
        from app.models import ModelConfig, ModelManager
        cfg = ModelConfig(cache_root=str(tmp_path / "cache"))
        mm = ModelManager(cfg)
        mm.nllb_model = MagicMock()
        mm.nllb_tokenizer = MagicMock()
        result = mm.translate("   ")
        assert result == ""
        mm.nllb_model.generate.assert_not_called()


# ── synthesize validation ──────────────────────────────────────────────────────

class TestSynthesizeValidation:
    def test_raises_without_xtts_model(self, tmp_path):
        from app.models import ModelConfig, ModelManager
        cfg = ModelConfig(cache_root=str(tmp_path / "cache"))
        mm = ModelManager(cfg)
        with pytest.raises(RuntimeError, match="XTTS model is not loaded"):
            mm.synthesize("Hello world")

    def test_returns_empty_float32_for_blank_text(self, tmp_path):
        from app.models import ModelConfig, ModelManager
        cfg = ModelConfig(cache_root=str(tmp_path / "cache"))
        mm = ModelManager(cfg)
        mm.tts_model = MagicMock()
        audio, sr = mm.synthesize("   ")
        assert audio.dtype == np.float32
        assert audio.size == 0
        assert sr == 24000
        mm.tts_model.tts.assert_not_called()

    def test_raises_when_speaker_wav_missing(self, tmp_path):
        from app.models import ModelConfig, ModelManager
        cfg = ModelConfig(
            cache_root=str(tmp_path / "cache"),
            speaker_wav=str(tmp_path / "nonexistent.wav"),
        )
        mm = ModelManager(cfg)
        mm.tts_model = MagicMock()
        with pytest.raises(FileNotFoundError, match="Speaker WAV not found"):
            mm.synthesize("Hello world")
