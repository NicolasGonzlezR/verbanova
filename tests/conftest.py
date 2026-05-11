from unittest.mock import MagicMock
import sys
from pathlib import Path

import numpy as np
import pytest

# Add backend to path so we can import from app module
BACKEND_PATH = Path(__file__).parent.parent / "backend"
if str(BACKEND_PATH) not in sys.path:
    sys.path.insert(0, str(BACKEND_PATH))


@pytest.fixture
def mock_models():
    """ModelManager mock that returns safe defaults without loading any ML model."""
    m = MagicMock()
    m.vad_probability.return_value = 0.0
    m.transcribe.return_value = ""
    m.translate.return_value = ""
    m.synthesize.return_value = (np.array([], dtype=np.float32), 24000)
    m.protect_terms.side_effect = lambda text: (text, {})
    m.restore_terms.side_effect = lambda text, _: text
    m.build_transcription_prompt.return_value = None
    m.name_glossary = []
    return m


@pytest.fixture
def model_manager(tmp_path):
    """Real ModelManager instance with tmp paths — no ML model loading."""
    names_file = tmp_path / "names.txt"
    names_file.write_text("Nicolas\nMaria\nTakeshi\n# comment\n\n")

    from app.models import ModelConfig, ModelManager

    cfg = ModelConfig(
        cache_root=str(tmp_path / "cache"),
        names_glossary_path=str(names_file),
        load_vad=False,
        load_whisper=False,
        load_nllb=False,
        load_xtts=False,
    )
    return ModelManager(cfg)
