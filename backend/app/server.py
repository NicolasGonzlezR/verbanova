import asyncio
import base64
import json
import queue
import threading
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from .models import ModelConfig, ModelManager
from .pipeline import ProcessingWorker
from .vad import PhraseSegmenter, VADConfig


app = FastAPI()
_model_lock = threading.Lock()
_model_manager: Optional[ModelManager] = None


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "models_loaded": _model_manager is not None}
_LANG_CODES = {
    "English": {"whisper": "en", "nllb": "eng_Latn", "xtts": "en"},
    "Spanish": {"whisper": "es", "nllb": "spa_Latn", "xtts": "es"},
    "Japanese": {"whisper": "ja", "nllb": "jpn_Jpan", "xtts": "ja"},
    "Chinese": {"whisper": "zh", "nllb": "zho_Hans", "xtts": "zh-cn"},
}


def _get_model_manager(config: ModelConfig) -> ModelManager:
    global _model_manager
    with _model_lock:
        if _model_manager is None:
            manager = ModelManager(config)
            manager.load_all()  # raises on failure — singleton not cached until success
            _model_manager = manager
            return _model_manager

        # If device preference changed, recreate the manager
        if _model_manager.config.device_preference != config.device_preference:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            manager = ModelManager(config)
            manager.load_all()  # raises on failure — old singleton preserved
            _model_manager = manager
            return _model_manager

        _model_manager.config.speaker_wav = config.speaker_wav
        if _model_manager.config.whisper_model_size != config.whisper_model_size:
            prev_size = _model_manager.config.whisper_model_size
            _model_manager.config.whisper_model_size = config.whisper_model_size
            try:
                _model_manager.reload_whisper()
            except Exception:
                _model_manager.config.whisper_model_size = prev_size  # restore on failure
                raise
        return _model_manager


def _decode_pcm16(payload: str) -> np.ndarray:
    raw = base64.b64decode(payload)
    audio_i16 = np.frombuffer(raw, dtype=np.int16)
    audio_f32 = audio_i16.astype(np.float32) / 32768.0
    return audio_f32


async def _send_json(ws: WebSocket, message: Dict[str, Any]) -> None:
    try:
        await ws.send_text(json.dumps(message))
    except RuntimeError as e:
        if "close message has been sent" in str(e):
            return
        raise


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    print("[server_ws] /ws - incoming websocket connection")
    await ws.accept()
    print("[server_ws] /ws - accepted websocket connection")

    segments_queue: queue.Queue = queue.Queue(maxsize=16)
    output_queue: queue.Queue = queue.Queue(maxsize=16)
    stop_event = threading.Event()

    processing_worker: Optional[ProcessingWorker] = None
    sender_thread: Optional[threading.Thread] = None
    segmenter: Optional[PhraseSegmenter] = None
    buffer = np.array([], dtype=np.float32)
    loop = asyncio.get_running_loop()

    async def send_status(state: str, message: str = "") -> None:
        await _send_json(ws, {"type": "status", "state": state, "message": message})

    def send_metrics(payload: Dict[str, Any]) -> None:
        asyncio.run_coroutine_threadsafe(
            _send_json(ws, {"type": "metrics", **payload}), loop
        )

    def send_text(transcribed: str, translated: str) -> None:
        asyncio.run_coroutine_threadsafe(
            _send_json(
                ws,
                {"type": "text", "transcribed": transcribed, "translated": translated},
            ),
            loop,
        )

    def output_sender() -> None:
        while not stop_event.is_set():
            try:
                item = output_queue.get(timeout=0.1)
            except queue.Empty:
                continue

            if item is None:
                break

            audio, sample_rate = item
            if audio is None or audio.size == 0:
                continue

            audio_i16 = np.clip(audio, -1, 1)
            audio_i16 = (audio_i16 * 32767).astype(np.int16)
            payload = base64.b64encode(audio_i16.tobytes()).decode("utf-8")

            asyncio.run_coroutine_threadsafe(
                _send_json(
                    ws,
                    {
                        "type": "audio",
                        "format": "s16",
                        "sample_rate": sample_rate,
                        "data": payload,
                    },
                ),
                loop,
            )

    def process_frames(audio: np.ndarray) -> None:
        nonlocal buffer
        if segmenter is None:
            return

        buffer = np.concatenate([buffer, audio])
        frame_size = segmenter.frame_samples
        while buffer.shape[0] >= frame_size:
            frame = buffer[:frame_size]
            buffer = buffer[frame_size:]
            segment = segmenter.process_frame(frame)
            if segment is not None and segment.size > 0:
                try:
                    segments_queue.put_nowait(segment)
                except queue.Full:
                    pass  # Drop segment under backpressure; worker can't keep up

    try:
        while True:
            message = await ws.receive_text()
            payload = json.loads(message)
            msg_type = payload.get("type")

            if msg_type == "start":
                await send_status("loading", "Loading models")

                config = payload.get("config") or {}
                source_name = config.get("input_lang", "English")
                target_name = config.get("target_lang", "Spanish")
                source_codes = _LANG_CODES.get(source_name, _LANG_CODES["English"])
                target_codes = _LANG_CODES.get(target_name, _LANG_CODES["Spanish"])

                model_config = ModelConfig(
                    whisper_model_size=config.get("whisper_model_size", "medium"),
                    device_preference=config.get("device_preference", "auto"),
                    speaker_wav="config/speaker.wav",
                    source_lang_nllb=source_codes["nllb"],
                    target_lang_nllb=target_codes["nllb"],
                    target_lang_xtts=target_codes["xtts"],
                )
                speaker_key = config.get("speaker_profile")
                if speaker_key not in (None, "", "default"):
                    model_config.speaker_wav = str(Path("web") / "uploads" / Path(speaker_key))

                # Load models off the event loop so it stays responsive
                _loading = True

                async def _loading_heartbeat() -> None:
                    try:
                        while _loading:
                            await _send_json(ws, {"type": "status", "state": "loading", "message": "Loading models..."})
                            await asyncio.sleep(2)
                    except Exception:
                        return

                hb_task = asyncio.create_task(_loading_heartbeat())
                try:
                    models = await loop.run_in_executor(None, _get_model_manager, model_config)
                except Exception as exc:
                    _loading = False
                    await hb_task
                    await send_status("error", f"Failed to load models: {exc}")
                    import traceback
                    traceback.print_exc()
                    continue
                _loading = False
                await hb_task

                segmenter = PhraseSegmenter(models, VADConfig())

                processing_worker = ProcessingWorker(
                    models=models,
                    segments_queue=segments_queue,
                    output_queue=output_queue,
                    stop_event=stop_event,
                    input_lang_whisper=source_codes["whisper"],
                    source_lang_nllb=source_codes["nllb"],
                    target_lang_nllb=target_codes["nllb"],
                    target_lang_xtts=target_codes["xtts"],
                    on_text=send_text,
                    on_error=lambda msg: asyncio.run_coroutine_threadsafe(
                        send_status("error", msg), loop
                    ),
                    on_metrics=send_metrics,
                )

                processing_worker.start()
                sender_thread = threading.Thread(target=output_sender, daemon=True)
                sender_thread.start()
                await send_status("ready", "Models ready")

            elif msg_type == "audio":
                if segmenter is None:
                    continue
                audio = _decode_pcm16(payload.get("data", ""))
                try:
                    process_frames(audio)
                except Exception:
                    import traceback
                    traceback.print_exc()

            elif msg_type == "stop":
                stop_event.set()
                try:
                    segments_queue.put_nowait(None)
                except queue.Full:
                    pass
                try:
                    output_queue.put_nowait(None)
                except queue.Full:
                    pass
                break

    except WebSocketDisconnect:
        pass
    except Exception:
        import traceback
        traceback.print_exc()
    finally:
        stop_event.set()
        try:
            segments_queue.put_nowait(None)
        except queue.Full:
            pass
        try:
            output_queue.put_nowait(None)
        except queue.Full:
            pass
        if processing_worker and processing_worker.is_alive():
            processing_worker.join(timeout=2.0)
        if sender_thread and sender_thread.is_alive():
            sender_thread.join(timeout=2.0)


@app.websocket("/ws/subtitle")
async def websocket_subtitle_endpoint(ws: WebSocket) -> None:
    print("[server_ws] /ws/subtitle - incoming websocket connection")
    await ws.accept()
    print("[server_ws] /ws/subtitle - accepted websocket connection")
    loop = asyncio.get_running_loop()

    try:
        while True:
            message = await ws.receive_text()
            payload = json.loads(message)
            msg_type = payload.get("type")

            if msg_type == "process":
                print("[server_ws] /ws/subtitle - received 'process' message")
                config = payload.get("config") or {}
                source_name = config.get("input_lang", "English")
                target_name = config.get("target_lang", "Spanish")
                source_codes = _LANG_CODES.get(source_name, _LANG_CODES["English"])
                target_codes = _LANG_CODES.get(target_name, _LANG_CODES["Spanish"])

                model_config = ModelConfig(
                    whisper_model_size=config.get("whisper_model_size", "small"),
                    device_preference=config.get("device_preference", "auto"),
                    source_lang_nllb=source_codes["nllb"],
                    target_lang_nllb=target_codes["nllb"],
                    load_vad=False,
                    load_xtts=False,
                    load_whisper=True,
                    load_nllb=True,
                )
                await _send_json(ws, {"type": "status", "state": "receiving", "message": "Receiving audio chunks..."})

                audio_b64 = ""
                chunk_count = 0
                while True:
                    chunk_msg = await ws.receive_text()
                    chunk_payload = json.loads(chunk_msg)
                    ctype = chunk_payload.get("type")
                    if ctype == "audio_chunk":
                        audio_b64 += chunk_payload.get("data", "")
                        chunk_count += 1
                        if chunk_count % 10 == 0:
                            print(f"[server_ws] /ws/subtitle - received {chunk_count} chunks so far")
                    elif ctype == "audio_end":
                        print(f"[server_ws] /ws/subtitle - received audio_end after {chunk_count} chunks")
                        break

                print("[server_ws] /ws/subtitle - loading models (may take time)")
                loading = True

                async def _heartbeat() -> None:
                    try:
                        while loading:
                            try:
                                await _send_json(ws, {"type": "status", "state": "loading", "message": "Loading models..."})
                            except Exception:
                                break
                            await asyncio.sleep(2)
                    except Exception:
                        return

                hb_task = asyncio.create_task(_heartbeat())
                try:
                    models = await loop.run_in_executor(None, _get_model_manager, model_config)
                    loading = False
                    await hb_task
                    print("[server_ws] /ws/subtitle - models loaded")
                except Exception as e:
                    loading = False
                    try:
                        await _send_json(ws, {"type": "status", "state": "error", "message": f"Model loading failed: {e}"})
                    except Exception:
                        pass
                    import traceback
                    traceback.print_exc()
                    return

                print(f"[server_ws] /ws/subtitle - total base64 size: {len(audio_b64)}")
                audio = _decode_pcm16(audio_b64)
                try:
                    await _send_json(ws, {"type": "status", "state": "transcribing", "message": "Transcribing audio..."})
                except Exception:
                    return

                def run_pipeline() -> None:
                    try:
                        print("[server_ws] /ws/subtitle - pipeline started")
                        result = models.transcribe_with_timestamps(
                            audio, 16000, whisper_language=source_codes["whisper"]
                        )

                        segments = result.get("segments", [])
                        total_segments = len(segments)

                        translated_segments = []
                        for i, seg in enumerate(segments):
                            text = seg.get("text", "")
                            if not text.strip():
                                continue

                            protected_text, placeholders = models.protect_terms(text)
                            translated = models.translate(
                                protected_text,
                                source_lang_nllb=source_codes["nllb"],
                                target_lang_nllb=target_codes["nllb"],
                            )
                            translated = models.restore_terms(translated, placeholders)

                            translated_segments.append({
                                "start": seg.get("start", 0.0),
                                "end": seg.get("end", 0.0),
                                "text": text.strip(),
                                "translated": translated,
                            })

                            asyncio.run_coroutine_threadsafe(
                                _send_json(ws, {
                                    "type": "progress",
                                    "current": i + 1,
                                    "total": total_segments,
                                    "message": f"Translating {i + 1}/{total_segments}...",
                                    "new_segment": {
                                        "start": seg.get("start", 0.0),
                                        "end": seg.get("end", 0.0),
                                        "text": text.strip(),
                                        "translated": translated,
                                    },
                                }),
                                loop,
                            )

                        asyncio.run_coroutine_threadsafe(
                            _send_json(ws, {"type": "done", "segments": translated_segments}),
                            loop,
                        )
                    except Exception as e:
                        print(f"[server_ws] /ws/subtitle - pipeline error: {e}")
                        import traceback
                        traceback.print_exc()
                        asyncio.run_coroutine_threadsafe(
                            _send_json(ws, {"type": "error", "message": str(e)}),
                            loop,
                        )

                threading.Thread(target=run_pipeline, daemon=True).start()

    except WebSocketDisconnect:
        pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server_ws:app",
        host="0.0.0.0",
        port=8000,
        # Disable WebSocket keepalive pings. During model loading (~30-120 s) the
        # application coroutine is suspended in run_in_executor and cannot drive the
        # websockets frame-reader, so pong frames from the browser go unread and the
        # default 20 s ping-timeout fires right after "ready" is sent.
        ws_ping_interval=None,
        ws_ping_timeout=None,
    )
