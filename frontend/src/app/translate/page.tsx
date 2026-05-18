"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";

import { clearAuthCookie, getClientAuthToken, setAuthCookie } from "@/lib/session";

type DeviceOption = { deviceId: string; label: string };
type User = { id: string; email: string; username: string };

const WHISPER_MODELS = ["tiny", "small", "medium", "turbo"] as const;
const COMPUTE_OPTIONS = ["Auto", "GPU", "CPU"] as const;
const LANG_OPTIONS = ["English", "Spanish", "Japanese", "Chinese"] as const;

export default function TranslatePage() {
  const [status, setStatus] = useState("Idle");
  const [isRunning, setIsRunning] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [inputDevices, setInputDevices] = useState<DeviceOption[]>([]);
  const [outputDevices, setOutputDevices] = useState<DeviceOption[]>([]);
  const [selectedInput, setSelectedInput] = useState("default");
  const [selectedOutput, setSelectedOutput] = useState("default");
  const [selectedCompute, setSelectedCompute] = useState("Auto");
  const [selectedWhisper, setSelectedWhisper] = useState("medium");
  const [selectedSource, setSelectedSource] = useState("English");
  const [selectedTarget, setSelectedTarget] = useState("Spanish");
  const [selectedSpeaker, setSelectedSpeaker] = useState("");
  const [transcribedText, setTranscribedText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [sttMs, setSttMs] = useState("--");
  const [mtMs, setMtMs] = useState("--");
  const [ttsMs, setTtsMs] = useState("--");
  const [totalMs, setTotalMs] = useState("--");
  const [logs, setLogs] = useState<{time: string; message: string}[]>([]);

  const addLog = (message: string) => {
    const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
    setLogs(prev => [...prev.slice(-50), { time, message }]);
  };

  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackTimeRef = useRef(0);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const router = useRouter();

  const playPing = async (deviceId: string) => {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const destination = context.createMediaStreamDestination();

    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.08;

    oscillator.connect(gain);
    gain.connect(destination);

    const audio = new Audio();
    audio.srcObject = destination.stream;

    if (deviceId !== "default" && typeof (audio as any).setSinkId === "function") {
      try {
        await (audio as any).setSinkId(deviceId);
      } catch (error) {
        console.error("Failed to set output device", error);
      }
    }

    await audio.play().catch((error) => console.error("Ping playback failed", error));
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
    oscillator.onended = () => {
      audio.pause();
      audio.srcObject = null;
      context.close();
    };
  };

  const [speakerOptions, setSpeakerOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [speakersLoaded, setSpeakersLoaded] = useState(false);

  const refreshDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setStatus("Device access not supported in this browser");
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs: DeviceOption[] = [{ deviceId: "default", label: "Default" }];
      const outputs: DeviceOption[] = [{ deviceId: "default", label: "Default" }];

      devices.forEach((device) => {
        if (device.kind === "audioinput") {
          inputs.push({
            deviceId: device.deviceId,
            label: device.label || "Audio input",
          });
        }
        if (device.kind === "audiooutput") {
          outputs.push({
            deviceId: device.deviceId,
            label: device.label || "Audio output",
          });
        }
      });

      setInputDevices(inputs);
      setOutputDevices(outputs);
    } catch (error) {
      setStatus("Failed to read audio devices");
      console.error(error);
    }
  };

  useEffect(() => {
    void refreshDevices();
  }, []);

  useEffect(() => {
    const savedToken = window.localStorage.getItem("translateapp_token") || getClientAuthToken();
    const savedUser = window.localStorage.getItem("translateapp_user");
    if (savedToken) {
      setAuthToken(savedToken);
      setAuthCookie(savedToken);
    }
    if (savedUser) {
      try {
        setCurrentUser(JSON.parse(savedUser));
      } catch {
        setCurrentUser(null);
      }
    }
    setAuthReady(true);
  }, []);

  function stopPipeline() {
    if (!isRunning && !wsRef.current) return;
    wsRef.current?.send(JSON.stringify({ type: "stop" }));
    wsRef.current?.close();
    wsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    setVoiceLevel(0);
    playbackContextRef.current?.close();
    playbackContextRef.current = null;
    playbackTimeRef.current = 0;
    setIsRunning(false);
    setStatus("Stopped");
  }

  const clearSession = (redirect = true) => {
    stopPipeline();
    setAuthToken(null);
    setCurrentUser(null);
    window.localStorage.removeItem("translateapp_token");
    window.localStorage.removeItem("translateapp_user");
    clearAuthCookie();
    if (redirect) {
      router.replace("/login");
    }
  };

  const validateSession = async (token: string) => {
    try {
      const response = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        clearSession(true);
        return;
      }
      const data = await response.json();
      setCurrentUser(data.user ?? null);
      window.localStorage.setItem("translateapp_user", JSON.stringify(data.user));
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (authReady && authToken) {
      void validateSession(authToken);
    }
    if (authReady && !authToken) {
      router.replace("/login");
    }
  }, [authReady, authToken, router]);

  const loadSpeakerProfiles = async () => {
    if (!authToken) return;
    try {
      const res = await fetch("/api/profiles", {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.status === 401) {
        clearSession(true);
        return;
      }
      const data = await res.json();
      const profiles = (data.profiles || []).map((p: any) => ({ value: p.sourceKey, label: p.name }));
      setSpeakerOptions(profiles);
      setSpeakersLoaded(true);
      if (profiles.length > 0 && !selectedSpeaker) {
        setSelectedSpeaker(profiles[0].value);
      }
    } catch (err) {
      console.error("Failed to load speaker profiles", err);
      setSpeakersLoaded(true);
    }
  };

  useEffect(() => {
    if (authReady && authToken) void loadSpeakerProfiles();
  }, [authReady, authToken]);

  // Close WebSocket when user leaves the tab/closes browser
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    return () => stopPipeline();
  }, []);

  if (!authReady) {
    return (
      <div className="page">
        <div className="panel">
          <p className="note">Cargando sesion...</p>
        </div>
      </div>
    );
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  
  const handleLogout = () => {
    clearSession(true);
  };

  const startPipeline = async () => {
    if (isRunning) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Microphone access not supported in this browser");
      return;
    }
    if (!authToken) {
      setStatus("Login required");
      clearSession(true);
      return;
    }
    if (!selectedSpeaker) {
      addLog("❌ Selecciona un perfil de voz antes de iniciar. Crea uno en Voice Cloning.");
      setStatus("Speaker profile required");
      return;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const constraints: MediaStreamConstraints = {
        audio:
          selectedInput === "default"
            ? true
            : { deviceId: { exact: selectedInput } },
      };

      setStatus("Connecting...");
      setIsModelLoading(true);
      addLog(`Conectando a WebSocket en ${wsUrl}`);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        addLog("✓ WebSocket conectado");
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;

        const audioContext = new AudioContext({ sampleRate: 16000 });
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);

        const processor = audioContext.createScriptProcessor(1024, 1, 1);
        source.connect(processor);

        // ScriptProcessorNode needs a path to the destination or Chrome prunes it
        // and onaudioprocess never fires. Zero-gain node silences output (no echo).
        const silentGain = audioContext.createGain();
        silentGain.gain.value = 0;
        processor.connect(silentGain);
        silentGain.connect(audioContext.destination);

        audioContextRef.current = audioContext;
        analyserRef.current = analyser;
        processorRef.current = processor;

        processor.onaudioprocess = (event) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const input = event.inputBuffer.getChannelData(0);
          const pcm16 = new Int16Array(input.length);
          for (let i = 0; i < input.length; i += 1) {
            const sample = Math.max(-1, Math.min(1, input[i]));
            pcm16[i] = sample < 0 ? sample * 32768 : sample * 32767;
          }
          const payload = btoa(
            String.fromCharCode(...new Uint8Array(pcm16.buffer))
          );
          ws.send(
            JSON.stringify({
              type: "audio",
              format: "s16",
              sample_rate: 16000,
              data: payload,
            })
          );
        };

        const data = new Uint8Array(analyser.fftSize);
        const updateLevel = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (let i = 0; i < data.length; i += 1) {
            const value = Math.abs(data[i] - 128) / 128;
            if (value > peak) peak = value;
          }
          setVoiceLevel(Math.min(1, peak * 1.4));
          rafRef.current = window.requestAnimationFrame(updateLevel);
        };
        updateLevel();

        addLog(`Enviando config: Whisper=${selectedWhisper}, Idioma=${selectedSource}→${selectedTarget}`);
        ws.send(
          JSON.stringify({
            type: "start",
            config: {
              whisper_model_size: selectedWhisper,
              device_preference: selectedCompute.toLowerCase(),
              input_lang: selectedSource,
              target_lang: selectedTarget,
              speaker_profile: selectedSpeaker,
            },
          })
        );

        setIsRunning(true);
        setStatus("Listening...");
      };

      ws.onerror = (evt: Event) => {
        const errMsg = (evt as any)?.message ?? evt.type ?? "Error desconocido";
        addLog(`❌ Error WebSocket: ${errMsg}`);
        // eslint-disable-next-line no-console
        console.error('WebSocket error event:', evt);
        setStatus("WebSocket Error");
        setIsModelLoading(false);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type !== "metrics") {
            addLog(`📨 Servidor: ${message.type} - ${message.state || message.message || "sin mensaje"}`);
          }
          if (message.type === "status") {
            setIsModelLoading(message.state === "loading");
            if (message.state === "ready") {
              setStatus("Listening...");
            }
            if (message.state === "error") {
              setStatus(message.message || "Model error");
            }
          }
          if (message.type === "text") {
            if (message.transcribed) {
              setTranscribedText((prev) => prev + message.transcribed + "\n");
            }
            if (message.translated) {
              setTranslatedText((prev) => prev + message.translated + "\n");
            }
          }
          if (message.type === "metrics") {
            if (message.stt_ms != null) setSttMs(message.stt_ms.toFixed(0));
            if (message.translate_ms != null) setMtMs(message.translate_ms.toFixed(0));
            if (message.tts_ms != null) setTtsMs(message.tts_ms.toFixed(0));
            if (message.total_ms != null) setTotalMs(message.total_ms.toFixed(0));
          }
          if (message.type === "audio") {
            playAudioChunk(message.data, message.sample_rate);
          }
        } catch (error) {
          console.error(error);
        }
      };

      ws.onclose = () => {
        addLog("🔌 WebSocket desconectado");
        setIsModelLoading(false);
        setStatus("Disconnected");
      };
    } catch (error) {
      addLog(`❌ Error al conectar: ${error}`);
      setStatus("Microphone access denied");
      console.error(error);
    }
  };

  const playAudioChunk = (base64Data: string, sampleRate: number) => {
    if (!base64Data) return;
    let context = playbackContextRef.current;
    if (!context) {
      context = new AudioContext({ sampleRate });
      playbackContextRef.current = context;
      playbackTimeRef.current = context.currentTime;
    }

    const binary = atob(base64Data);
    const buffer = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i += 1) {
      view[i] = binary.charCodeAt(i);
    }

    const int16 = new Int16Array(buffer);
    const audioBuffer = context.createBuffer(1, int16.length, sampleRate);
    const channel = audioBuffer.getChannelData(0);
    for (let i = 0; i < int16.length; i += 1) {
      channel[i] = int16[i] / 32768;
    }

    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime, playbackTimeRef.current);
    source.start(startAt);
    playbackTimeRef.current = startAt + audioBuffer.duration;
  };

  return (
    <div className="page" style={{ paddingBottom: "62px" }}>
      <AppHeader username={currentUser?.username} onLogout={handleLogout} />
      <header className="hero">
        <div>
          <p className="eyebrow">Translation endpoint</p>
          <h1>Speech translation console</h1>
          <p className="subtitle">
            Frontend funcional para controlar captura, modelos y salida de audio en tiempo real.
          </p>
        </div>
        <div className="status-card">
          <span className={`status-pill ${
            status.toLowerCase().includes("error") || status === "Disconnected" ? "error"
            : isModelLoading ? "loading"
            : isRunning ? "live"
            : "idle"
          }`}>{
            status.toLowerCase().includes("error") ? "Error"
            : status === "Disconnected" ? "Disconnected"
            : isModelLoading ? "Loading"
            : isRunning ? "Live"
            : "Idle"
          }</span>
          <p className="status-text">{isModelLoading ? "Loading models..." : status}</p>
          <p className="status-meta">
            Whisper {selectedWhisper} · {selectedSource} → {selectedTarget}
          </p>
        </div>
      </header>

      <section className="pipeline-banner">
        <div>
          <p className="eyebrow">Pipeline actual</p>
          <p className="pipeline-text">VAD → Whisper → NLLB → XTTS</p>
        </div>
        <div className="pipeline-status">
          {isModelLoading ? (
            <span className="loader" aria-label="Loading" />
          ) : (
            <span className="ready-pill">Ready</span>
          )}
          <span className="pipeline-meta">
            {isModelLoading ? "Cargando modelos..." : "Modelos listos"}
          </span>
        </div>
      </section>

      <section className="grid">
        <div className="panel controls">
          <h2>Session controls</h2>
          <div className="button-row">
            <button className="btn primary" onClick={startPipeline} disabled={isRunning || !selectedSpeaker}>
              Start
            </button>
            <button className="btn ghost" onClick={stopPipeline} disabled={!isRunning}>
              Stop
            </button>
          </div>
          <div className="voice-meter">
            <div className="voice-label">
              <span>Voice activity</span>
              <span className={isRunning ? "live" : "idle"}>
                {isRunning ? "Detecting" : "Idle"}
              </span>
            </div>
            <div className="voice-bar">
              <div className="voice-fill" style={{ width: `${voiceLevel * 100}%` }} />
            </div>
          </div>
          <div className="select-group">
            <label>
              Input device
              <select
                value={selectedInput}
                onChange={(event) => setSelectedInput(event.target.value)}
              >
                {inputDevices.map((device, index) => (
                  <option key={`${device.deviceId}-${index}`} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Output device
              <select
                value={selectedOutput}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setSelectedOutput(nextValue);
                  void playPing(nextValue);
                }}
                disabled={isRunning}
              >
                {outputDevices.map((device, index) => (
                  <option key={`${device.deviceId}-${index}`} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn small" onClick={refreshDevices}>
              Refresh devices
            </button>
          </div>
        </div>

        <div className="panel config">
          <h2>Model configuration</h2>
          <div className="config-section">
            <h3>Compute and model</h3>
            <div className="select-grid">
              <label>
                Compute device
                <select
                  value={selectedCompute}
                  onChange={(event) => setSelectedCompute(event.target.value)}
                  disabled={isRunning}
                >
                  {COMPUTE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Whisper model
                <select
                  value={selectedWhisper}
                  onChange={(event) => setSelectedWhisper(event.target.value)}
                  disabled={isRunning}
                >
                  {WHISPER_MODELS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="config-section">
            <h3>Input and output</h3>
            <div className="select-grid">
              <label>
                Input language
                <select
                  value={selectedSource}
                  onChange={(event) => setSelectedSource(event.target.value)}
                  disabled={isRunning}
                >
                  {LANG_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Output language
                <select
                  value={selectedTarget}
                  onChange={(event) => setSelectedTarget(event.target.value)}
                  disabled={isRunning}
                >
                  {LANG_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="config-section">
            <h3>Speaker profile <span style={{ color: "#ef4444", fontSize: "0.75rem" }}>*required</span></h3>
            {speakersLoaded && speakerOptions.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <p className="note" style={{ color: "#f59e0b", margin: 0 }}>
                  No tienes perfiles de voz. Crea uno en Voice Cloning para poder iniciar la traducción.
                </p>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <a href="/voice-cloning" className="btn small" style={{ textDecoration: "none" }}>
                    Ir a Voice Cloning →
                  </a>
                  <button className="btn small" type="button" onClick={() => void loadSpeakerProfiles()}>
                    Actualizar
                  </button>
                </div>
              </div>
            ) : (
              <div className="select-grid">
                <label>
                  Speaker profile
                  <select
                    value={selectedSpeaker}
                    onChange={(event) => setSelectedSpeaker(event.target.value)}
                    disabled={isRunning}
                  >
                    {speakerOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn small" type="button" onClick={() => void loadSpeakerProfiles()}>
                  Refresh speakers
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="panel transcript">
          <h2>Texto transcrito</h2>
          <textarea
            placeholder="Transcripcion en vivo..."
            value={transcribedText}
            className="readonly"
            readOnly
          />
        </div>

        <div className="panel transcript">
          <h2>Texto traducido</h2>
          <textarea
            placeholder="Traduccion en vivo..."
            value={translatedText}
            className="readonly"
            readOnly
          />
        </div>

        <div className="panel metrics">
          <h2>Pipeline timings</h2>
          <div className="metric-grid">
            <div>
              <span>STT</span>
              <strong>{sttMs} ms</strong>
            </div>
            <div>
              <span>Translate</span>
              <strong>{mtMs} ms</strong>
            </div>
            <div>
              <span>TTS</span>
              <strong>{ttsMs} ms</strong>
            </div>
            <div>
              <span>Total</span>
              <strong>{totalMs} ms</strong>
            </div>
          </div>
        </div>

        <div className="panel logs-panel">
          <h2>System logs</h2>
          <div className="log-list">
            {logs.length === 0 ? (
              <p className="note">Waiting for events...</p>
            ) : (
              logs.map((log, idx) => (
                <div key={idx} className="log-line">
                  <span className="log-time">[{log.time}]</span> {log.message}
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Sticky status bar */}
      <div style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        background: "rgba(15,23,42,0.96)",
        backdropFilter: "blur(12px)",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        padding: "11px 28px",
        display: "flex",
        alignItems: "center",
        gap: "20px",
        fontSize: "13px",
        color: "#94a3b8",
        fontFamily: "monospace",
      }}>
        {/* Indicator dot + status */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <span style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: isModelLoading ? "#f59e0b"
              : status.toLowerCase().includes("error") || status === "Disconnected" ? "#ef4444"
              : isRunning ? "#22c55e"
              : "#cbd5e1",
            boxShadow: isModelLoading ? "0 0 6px #f59e0b"
              : isRunning ? "0 0 6px rgba(34,197,94,0.6)"
              : "none",
          }} />
          <strong style={{ color: "#f1f5f9", fontSize: "13px" }}>{isModelLoading ? "Cargando modelos..." : status}</strong>
        </div>

        <span style={{ color: "rgba(255,255,255,0.15)" }}>│</span>

        {/* Pipeline config */}
        <span style={{ flexShrink: 0 }}>
          Whisper&nbsp;<strong style={{ color: "#f1f5f9" }}>{selectedWhisper}</strong>
          &nbsp;·&nbsp;{selectedSource}&nbsp;→&nbsp;{selectedTarget}
        </span>

        <span style={{ color: "rgba(255,255,255,0.15)" }}>│</span>

        {/* Timings */}
        <span style={{ display: "flex", gap: "14px", opacity: sttMs === "--" ? 0.3 : 1, flexShrink: 0 }}>
          <span>STT&nbsp;<strong style={{ color: "#f1f5f9" }}>{sttMs}ms</strong></span>
          <span>MT&nbsp;<strong style={{ color: "#f1f5f9" }}>{mtMs}ms</strong></span>
          <span>TTS&nbsp;<strong style={{ color: "#f1f5f9" }}>{ttsMs}ms</strong></span>
          <span>Total&nbsp;<strong style={{ color: "#f1f5f9" }}>{totalMs}ms</strong></span>
        </span>

        {/* Voice activity — right-aligned, only when running */}
        {isRunning && (
          <div style={{ display: "flex", alignItems: "center", gap: "7px", marginLeft: "auto", flexShrink: 0 }}>
            <span>Mic</span>
            <div style={{ width: 72, height: 4, background: "#e2e8f0", borderRadius: 2 }}>
              <div style={{
                width: `${voiceLevel * 100}%`,
                height: "100%",
                background: voiceLevel > 0.6 ? "#f59e0b" : "linear-gradient(90deg,#3b82f6,#8b5cf6)",
                borderRadius: 2,
                transition: "width 0.05s linear",
              }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
