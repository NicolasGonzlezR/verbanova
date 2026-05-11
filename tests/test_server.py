"""
Tests for the FastAPI server (server_ws.py).
ML model loading is patched so no heavy dependencies are needed.
"""
import json
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from starlette.testclient import TestClient

import app.server as server_ws
from server_ws import app


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_global_manager():
    """Ensure the model manager singleton is clear between tests."""
    server_ws._model_manager = None
    yield
    server_ws._model_manager = None


@pytest.fixture
def mock_manager():
    m = MagicMock()
    m.config.whisper_model_size = "tiny"
    m.config.device_preference = "cpu"
    m.config.speaker_wav = "config/speaker.wav"
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
def client():
    return TestClient(app)


# ── /health ───────────────────────────────────────────────────────────────────

def test_health_returns_200(client):
    resp = client.get("/health")
    assert resp.status_code == 200


def test_health_returns_ok_status(client):
    resp = client.get("/health")
    assert resp.json()["status"] == "ok"


def test_health_reports_models_not_loaded_initially(client):
    resp = client.get("/health")
    assert resp.json()["models_loaded"] is False


def test_health_reports_models_loaded_when_manager_set(client, mock_manager):
    server_ws._model_manager = mock_manager
    resp = client.get("/health")
    assert resp.json()["models_loaded"] is True


# ── /ws — stop message ────────────────────────────────────────────────────────

def test_ws_stop_without_start_closes_cleanly(client):
    """Sending stop as the first message must not crash the server."""
    with client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"type": "stop"}))
    # If we reach here the connection closed without errors


def test_ws_unknown_message_type_is_ignored(client):
    """Unknown message types should be silently ignored and not crash."""
    with client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"type": "unknown_command", "data": 123}))
        ws.send_text(json.dumps({"type": "stop"}))


# ── /ws — start → ready flow ──────────────────────────────────────────────────

def _drain_until(ws, target_state: str, max_messages: int = 15) -> bool:
    """Read WebSocket messages until we find the given status state."""
    for _ in range(max_messages):
        raw = ws.receive_text()
        msg = json.loads(raw)
        if msg.get("type") == "status" and msg.get("state") == target_state:
            return True
    return False


def test_ws_start_reaches_ready_state(client, mock_manager):
    with patch("server_ws._get_model_manager", return_value=mock_manager):
        with client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({
                "type": "start",
                "config": {
                    "input_lang": "English",
                    "target_lang": "Spanish",
                    "whisper_model_size": "tiny",
                    "device_preference": "cpu",
                },
            }))
            assert _drain_until(ws, "ready"), "Did not receive 'ready' status"
            ws.send_text(json.dumps({"type": "stop"}))


def test_ws_start_error_propagated_to_client(client):
    with patch(
        "server_ws._get_model_manager",
        side_effect=RuntimeError("model load failed"),
    ):
        with client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({"type": "start", "config": {}}))
            assert _drain_until(ws, "error"), "Did not receive 'error' status"
            ws.send_text(json.dumps({"type": "stop"}))


# ── /ws — audio message ───────────────────────────────────────────────────────

def test_ws_audio_before_start_is_ignored(client):
    """Audio messages before 'start' (no segmenter yet) should not crash."""
    import base64
    import numpy as np

    audio = np.zeros(512, dtype=np.int16).tobytes()
    payload = base64.b64encode(audio).decode()

    with client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"type": "audio", "data": payload}))
        ws.send_text(json.dumps({"type": "stop"}))


# ── /ws/subtitle — basic connect ──────────────────────────────────────────────

def test_ws_subtitle_disconnect_without_process_is_clean(client):
    """Disconnecting from /ws/subtitle immediately should not raise."""
    with client.websocket_connect("/ws/subtitle"):
        pass  # just connect and disconnect


# ── language config ───────────────────────────────────────────────────────────

def test_ws_start_with_japanese_config(client, mock_manager):
    with patch("server_ws._get_model_manager", return_value=mock_manager):
        with client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({
                "type": "start",
                "config": {
                    "input_lang": "Japanese",
                    "target_lang": "English",
                    "whisper_model_size": "tiny",
                },
            }))
            assert _drain_until(ws, "ready")
            ws.send_text(json.dumps({"type": "stop"}))


def test_ws_start_with_unknown_lang_falls_back_to_english(client, mock_manager):
    with patch("server_ws._get_model_manager", return_value=mock_manager):
        with client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps({
                "type": "start",
                "config": {
                    "input_lang": "Klingon",
                    "target_lang": "Spanish",
                },
            }))
            assert _drain_until(ws, "ready")
            ws.send_text(json.dumps({"type": "stop"}))
