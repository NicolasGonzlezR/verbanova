import logging
import queue
import threading
import tkinter as tk
from dataclasses import dataclass
from pathlib import Path
from tkinter import messagebox, scrolledtext, ttk

import sounddevice as sd
from audio import AudioInputWorker, AudioOutputWorker
from models import ModelConfig, ModelManager
from pipeline import ProcessingWorker
from vad import PhraseSegmenter, VADConfig


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(threadName)s | %(message)s",
)
LOGGER = logging.getLogger(__name__)


@dataclass
class AppConfig:
    sample_rate: int = 16000
    frame_ms: int = 32


LANG_OPTIONS = {
    "Spanish": {
        "whisper": "es",
        "nllb": "spa_Latn",
        "xtts": "es",
    },
    "English": {
        "whisper": "en",
        "nllb": "eng_Latn",
        "xtts": "en",
    },
    "Japanese": {
        "whisper": "ja",
        "nllb": "jpn_Jpan",
        "xtts": "ja",
    },
    "Chinese": {
        "whisper": "zh",
        "nllb": "zho_Hans",
        "xtts": "zh-cn",
    },
}


class TranslationApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Real-Time Speech Translator (Whisper + NLLB + XTTS)")
        self.root.geometry("860x540")

        self.app_config = AppConfig()
        self.model_config = ModelConfig()
        self.models = ModelManager(self.model_config)

        self.stop_event = threading.Event()
        self.segments_queue: queue.Queue = queue.Queue(maxsize=16)
        self.output_queue: queue.Queue = queue.Queue(maxsize=16)

        self.input_worker = None
        self.processing_worker = None
        self.output_worker = None

        self.models_ready = False
        self.is_running = False

        self.input_devices = {}
        self.output_devices = {}
        self.selected_input = tk.StringVar(value="Default")
        self.selected_output = tk.StringVar(value="Default")
        self.selected_source_lang = tk.StringVar(value="English")
        self.selected_target_lang = tk.StringVar(value="Spanish")
        self.selected_compute = tk.StringVar(value="Auto")
        self.selected_speaker = tk.StringVar(value="")
        self.speaker_profiles = {}

        pref = (self.model_config.device_preference or "auto").lower()
        if pref in ("gpu", "cuda"):
            self.selected_compute.set("GPU")
        elif pref == "cpu":
            self.selected_compute.set("CPU")

        self._build_ui()
        self._ensure_paths()
        self._refresh_audio_devices()
        self._refresh_speaker_profiles()
        self._load_models_in_background()

    def _build_ui(self) -> None:
        controls = tk.Frame(self.root)
        controls.pack(fill=tk.X, padx=12, pady=12)

        self.start_btn = tk.Button(controls, text="Start", width=14, command=self.start_pipeline, state=tk.DISABLED)
        self.start_btn.pack(side=tk.LEFT)

        self.stop_btn = tk.Button(controls, text="Stop", width=14, command=self.stop_pipeline, state=tk.DISABLED)
        self.stop_btn.pack(side=tk.LEFT, padx=(10, 0))

        self.status_label = tk.Label(controls, text="Loading models...", anchor="w")
        self.status_label.pack(side=tk.LEFT, padx=(20, 0))

        device_frame = tk.Frame(self.root)
        device_frame.pack(fill=tk.X, padx=12, pady=(0, 8))

        tk.Label(device_frame, text="Input device").grid(row=0, column=0, sticky="w")
        self.input_combo = ttk.Combobox(device_frame, textvariable=self.selected_input, state="readonly", width=42)
        self.input_combo.grid(row=1, column=0, sticky="we", padx=(0, 8))

        tk.Label(device_frame, text="Output device").grid(row=0, column=1, sticky="w")
        self.output_combo = ttk.Combobox(device_frame, textvariable=self.selected_output, state="readonly", width=42)
        self.output_combo.grid(row=1, column=1, sticky="we", padx=(0, 8))

        refresh_btn = tk.Button(device_frame, text="Refresh devices", command=self._refresh_audio_devices)
        refresh_btn.grid(row=1, column=2, sticky="e")

        device_frame.columnconfigure(0, weight=1)
        device_frame.columnconfigure(1, weight=1)

        compute_frame = tk.Frame(self.root)
        compute_frame.pack(fill=tk.X, padx=12, pady=(0, 8))

        tk.Label(compute_frame, text="Compute device").grid(row=0, column=0, sticky="w")
        self.compute_combo = ttk.Combobox(
            compute_frame,
            textvariable=self.selected_compute,
            state="readonly",
            values=["Auto", "GPU", "CPU"],
            width=20,
        )
        self.compute_combo.grid(row=1, column=0, sticky="w", padx=(0, 8))

        apply_compute_btn = tk.Button(compute_frame, text="Apply compute", command=self._apply_compute_device)
        apply_compute_btn.grid(row=1, column=1, sticky="w")

        lang_frame = tk.Frame(self.root)
        lang_frame.pack(fill=tk.X, padx=12, pady=(0, 8))

        tk.Label(lang_frame, text="Input language").grid(row=0, column=0, sticky="w")
        self.source_lang_combo = ttk.Combobox(
            lang_frame,
            textvariable=self.selected_source_lang,
            state="readonly",
            values=list(LANG_OPTIONS.keys()),
            width=42,
        )
        self.source_lang_combo.grid(row=1, column=0, sticky="we", padx=(0, 8))

        tk.Label(lang_frame, text="Output language").grid(row=0, column=1, sticky="w")
        self.target_lang_combo = ttk.Combobox(
            lang_frame,
            textvariable=self.selected_target_lang,
            state="readonly",
            values=list(LANG_OPTIONS.keys()),
            width=42,
        )
        self.target_lang_combo.grid(row=1, column=1, sticky="we", padx=(0, 8))

        lang_frame.columnconfigure(0, weight=1)
        lang_frame.columnconfigure(1, weight=1)

        speaker_frame = tk.Frame(self.root)
        speaker_frame.pack(fill=tk.X, padx=12, pady=(0, 8))

        tk.Label(speaker_frame, text="Speaker profile").grid(row=0, column=0, sticky="w")
        self.speaker_combo = ttk.Combobox(
            speaker_frame,
            textvariable=self.selected_speaker,
            state="readonly",
            width=72,
        )
        self.speaker_combo.grid(row=1, column=0, sticky="we", padx=(0, 8))

        refresh_speakers_btn = tk.Button(speaker_frame, text="Refresh speakers", command=self._refresh_speaker_profiles)
        refresh_speakers_btn.grid(row=1, column=1, sticky="e")

        speaker_frame.columnconfigure(0, weight=1)

        text_frame = tk.Frame(self.root)
        text_frame.pack(fill=tk.BOTH, expand=True, padx=12, pady=(0, 12))

        tk.Label(text_frame, text="Transcribed text").pack(anchor="w")
        self.transcribed_box = scrolledtext.ScrolledText(text_frame, height=8, wrap=tk.WORD)
        self.transcribed_box.pack(fill=tk.BOTH, expand=True, pady=(0, 8))

        tk.Label(text_frame, text="Translated text").pack(anchor="w")
        self.translated_box = scrolledtext.ScrolledText(text_frame, height=8, wrap=tk.WORD)
        self.translated_box.pack(fill=tk.BOTH, expand=True)

    def _ensure_paths(self) -> None:
        Path("assets").mkdir(parents=True, exist_ok=True)
        Path(self.model_config.cache_root).mkdir(parents=True, exist_ok=True)

    def _refresh_audio_devices(self) -> None:
        try:
            devices = sd.query_devices()
            hostapis = sd.query_hostapis()
        except Exception as exc:
            LOGGER.exception("Failed to query audio devices")
            self.status_label.config(text=f"Audio device query failed: {exc}")
            return

        input_names = ["Default"]
        output_names = ["Default"]
        self.input_devices = {"Default": None}
        self.output_devices = {"Default": None}

        for idx, dev in enumerate(devices):
            name = str(dev.get("name", f"Device {idx}"))
            hostapi_index = int(dev.get("hostapi", -1))
            if 0 <= hostapi_index < len(hostapis):
                hostapi_name = str(hostapis[hostapi_index].get("name", "Unknown API"))
            else:
                hostapi_name = "Unknown API"
            label = f"{idx}: {name} [{hostapi_name}]"
            if int(dev.get("max_input_channels", 0)) > 0:
                input_names.append(label)
                self.input_devices[label] = idx
            if int(dev.get("max_output_channels", 0)) > 0:
                output_names.append(label)
                self.output_devices[label] = idx

        self.input_combo["values"] = input_names
        self.output_combo["values"] = output_names

        LOGGER.info("Audio device list refreshed (%d inputs, %d outputs)", len(input_names) - 1, len(output_names) - 1)

        if self.selected_input.get() not in self.input_devices:
            self.selected_input.set("Default")
        if self.selected_output.get() not in self.output_devices:
            self.selected_output.set("Default")

    def _refresh_speaker_profiles(self) -> None:
        assets_dir = Path("assets")
        assets_dir.mkdir(parents=True, exist_ok=True)

        profiles = {}
        options = []

        default_wav = assets_dir / "speaker.wav"
        if default_wav.exists():
            label = "default (assets/speaker.wav)"
            profiles[label] = str(default_wav)
            options.append(label)

        for child in sorted(assets_dir.iterdir()):
            if not child.is_dir():
                continue
            wav_path = child / "speaker.wav"
            if not wav_path.exists():
                continue
            label = f"{child.name} ({wav_path.as_posix()})"
            profiles[label] = str(wav_path)
            options.append(label)

        self.speaker_profiles = profiles
        self.speaker_combo["values"] = options

        if not options:
            self.selected_speaker.set("")
            self.speaker_combo.set("")
            return

        if self.selected_speaker.get() not in self.speaker_profiles:
            self.selected_speaker.set(options[0])

    def _selected_speaker_path(self):
        return self.speaker_profiles.get(self.selected_speaker.get())

    def _apply_compute_device(self) -> None:
        if self.is_running:
            messagebox.showwarning("Stop first", "Stop the pipeline before changing compute device.")
            return

        choice = self.selected_compute.get()
        mapping = {
            "Auto": "auto",
            "GPU": "gpu",
            "CPU": "cpu",
        }
        self.model_config.device_preference = mapping.get(choice, "auto")

        self.models_ready = False
        self.start_btn.config(state=tk.DISABLED)
        self.status_label.config(text=f"Reloading models on {choice}...")

        self.models = ModelManager(self.model_config)
        self._load_models_in_background()

    def _selected_device_ids(self):
        input_id = self.input_devices.get(self.selected_input.get(), None)
        output_id = self.output_devices.get(self.selected_output.get(), None)
        return input_id, output_id

    def _selected_language_codes(self):
        source_name = self.selected_source_lang.get()
        target_name = self.selected_target_lang.get()

        source = LANG_OPTIONS.get(source_name)
        target = LANG_OPTIONS.get(target_name)
        if not source or not target:
            raise ValueError("Invalid language selection")

        return {
            "whisper": source["whisper"],
            "source_nllb": source["nllb"],
            "target_nllb": target["nllb"],
            "target_xtts": target["xtts"],
            "source_name": source_name,
            "target_name": target_name,
        }

    def _load_models_in_background(self) -> None:
        def task() -> None:
            try:
                self.models.load_all()
            except Exception as exc:
                LOGGER.exception("Failed loading models")
                err_msg = str(exc)
                self.root.after(0, lambda msg=err_msg: self._set_model_error(msg))
                return

            self.models_ready = True
            self.root.after(0, self._set_model_ready)

        threading.Thread(target=task, name="ModelLoader", daemon=True).start()

    def _set_model_ready(self) -> None:
        self.status_label.config(text=f"Models ready | Device: {self.models.device_name()}")
        self.start_btn.config(state=tk.NORMAL)

    def _set_model_error(self, message: str) -> None:
        self.status_label.config(text="Model loading failed")
        messagebox.showerror("Model Error", message)

    def start_pipeline(self) -> None:
        if self.is_running:
            return
        if not self.models_ready:
            messagebox.showwarning("Please wait", "Models are still loading.")
            return

        selected_speaker = self._selected_speaker_path()
        if not selected_speaker:
            messagebox.showerror(
                "Missing voice profile",
                "No speaker profile found. Add assets/speaker.wav or assets/<profile>/speaker.wav",
            )
            return

        speaker_path = Path(selected_speaker)
        if not speaker_path.exists():
            messagebox.showerror(
                "Missing voice sample",
                f"Reference voice file not found: {speaker_path}\n"
                "Place WAV files at assets/speaker.wav or assets/<profile>/speaker.wav",
            )
            return

        self.model_config.speaker_wav = str(speaker_path)

        self.stop_event.clear()

        input_device_id, output_device_id = self._selected_device_ids()
        lang_codes = self._selected_language_codes()

        # Fresh queues per run avoid stale data from previous sessions.
        self.segments_queue = queue.Queue(maxsize=16)
        self.output_queue = queue.Queue(maxsize=16)

        segmenter = PhraseSegmenter(self.models, VADConfig(sample_rate=self.app_config.sample_rate, frame_ms=self.app_config.frame_ms))

        self.input_worker = AudioInputWorker(
            segmenter=segmenter,
            segments_queue=self.segments_queue,
            stop_event=self.stop_event,
            sample_rate=self.app_config.sample_rate,
            frame_ms=self.app_config.frame_ms,
            input_device=input_device_id,
        )

        self.processing_worker = ProcessingWorker(
            models=self.models,
            segments_queue=self.segments_queue,
            output_queue=self.output_queue,
            stop_event=self.stop_event,
            input_lang_whisper=lang_codes["whisper"],
            source_lang_nllb=lang_codes["source_nllb"],
            target_lang_nllb=lang_codes["target_nllb"],
            target_lang_xtts=lang_codes["target_xtts"],
            on_text=self._on_text_result,
            on_error=self._on_worker_error,
        )

        self.output_worker = AudioOutputWorker(
            output_queue=self.output_queue,
            stop_event=self.stop_event,
            on_error=self._on_worker_error,
            output_device=output_device_id,
        )

        self.input_worker.start()
        self.processing_worker.start()
        self.output_worker.start()

        self.is_running = True
        self.start_btn.config(state=tk.DISABLED)
        self.stop_btn.config(state=tk.NORMAL)
        self.status_label.config(
            text=(
                f"Listening... | Model device: {self.models.device_name()} | "
                f"In: {self.selected_input.get()} | Out: {self.selected_output.get()} | "
                f"{lang_codes['source_name']} -> {lang_codes['target_name']} | "
                f"Speaker: {Path(self.model_config.speaker_wav).parent.name if Path(self.model_config.speaker_wav).parent.name != 'assets' else 'default'}"
            )
        )

    def stop_pipeline(self) -> None:
        if not self.is_running:
            return

        self.stop_event.set()
        self.segments_queue.put(None)
        self.output_queue.put(None)

        for worker in (self.input_worker, self.processing_worker, self.output_worker):
            if worker and worker.is_alive():
                worker.join(timeout=2.0)

        self.is_running = False
        self.start_btn.config(state=tk.NORMAL if self.models_ready else tk.DISABLED)
        self.stop_btn.config(state=tk.DISABLED)
        self.status_label.config(text=f"Stopped | Device: {self.models.device_name()}")

    def _on_text_result(self, transcribed: str, translated: str) -> None:
        def update() -> None:
            self.transcribed_box.insert(tk.END, transcribed + "\n")
            self.transcribed_box.see(tk.END)

            self.translated_box.insert(tk.END, translated + "\n")
            self.translated_box.see(tk.END)

        self.root.after(0, update)

    def _on_worker_error(self, message: str) -> None:
        self.root.after(0, lambda: self.status_label.config(text=f"Error: {message}"))


def main() -> None:
    root = tk.Tk()
    app = TranslationApp(root)

    def on_close() -> None:
        try:
            app.stop_pipeline()
        finally:
            root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_close)
    root.mainloop()


if __name__ == "__main__":
    main()
