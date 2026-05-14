"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { clearAuthCookie } from "@/lib/session";

export default function SubtitlePage() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState(".srt");
  const [whisperModel, setWhisperModel] = useState("small");
  const [sourceLang, setSourceLang] = useState("English");
  const [targetLang, setTargetLang] = useState("Spanish");
  const [status, setStatus] = useState("Idle");
  const [progress, setProgress] = useState<{current: number, total: number} | null>(null);
  const [liveSegments, setLiveSegments] = useState<any[]>([]);
  const [completedSegments, setCompletedSegments] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<{username: string} | null>(null);
  const [logs, setLogs] = useState<{time: string; message: string}[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const previewListRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const addLog = (message: string) => {
    const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
    setLogs(prev => [...prev.slice(-50), { time, message }]);
  };

  useEffect(() => {
    const savedUser = window.localStorage.getItem("translateapp_user");
    if (savedUser) {
      try {
        setCurrentUser(JSON.parse(savedUser));
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (previewListRef.current) {
      previewListRef.current.scrollTop = previewListRef.current.scrollHeight;
    }
  }, [liveSegments]);

  // Close WebSocket on component unmount (Next.js client-side navigation)
  // and on full page unload — beforeunload only fires for real unloads,
  // so the useEffect cleanup covers in-app navigation.
  useEffect(() => {
    const handleBeforeUnload = () => {
      wsRef.current?.close();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      wsRef.current?.close();
    };
  }, []);

  const handleLogout = () => {
    window.localStorage.removeItem("translateapp_token");
    window.localStorage.removeItem("translateapp_user");
    clearAuthCookie();
    router.replace("/login");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const processAudioFile = async (audioData: Float32Array) => {
    return new Promise<string>((resolve) => {
      // Convert Float32 to Int16
      const int16Array = new Int16Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        const s = Math.max(-1, Math.min(1, audioData[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      
      const uint8Array = new Uint8Array(int16Array.buffer);
      // Fast chunked convert to avoid stack size limits
      let binary = "";
      const chunkSize = 8192;
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(uint8Array.subarray(i, i + chunkSize)));
      }
      resolve(window.btoa(binary));
    });
  };

  function toSubtitleTime(sec: number, ext: string) {
    const hours = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);
    let ms = Math.floor((sec % 1) * 1000);
    
    if (ext === ".srt") {
      return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
    } else if (ext === ".vtt") {
      return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
    } else {
      // .ass formatting
      ms = Math.floor(ms / 10);
      return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
    }
  }

  const exportSubtitles = (segments: any[]) => {
    let output = "";
    if (format === ".vtt") output += "WEBVTT\n\n";
    else if (format === ".ass") {
      output += `[Script Info]
ScriptType: v4.00+
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
    }

    segments.forEach((seg, i) => {
      const start = toSubtitleTime(seg.start, format);
      const end = toSubtitleTime(seg.end, format);
      if (format === ".srt") {
        output += `${i + 1}\n${start} --> ${end}\n${seg.translated}\n\n`;
      } else if (format === ".vtt") {
        output += `${i + 1}\n${start} --> ${end}\n${seg.translated}\n\n`;
      } else if (format === ".ass") {
        output += `Dialogue: 0,${start},${end},Default,,0,0,0,,${seg.translated}\n`;
      }
    });

    const blob = new Blob([output], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `subtitle_${Date.now()}${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleStart = async () => {
    if (!file) return;
    setStatus("Decoding local audio (may a take moment for large files)...");
    addLog(`Iniciando procesamiento de: ${file.name}`);
    try {
      addLog(`📂 Leyendo archivo: ${(file.size / 1024 / 1024).toFixed(2)} MB`);
      const arrayBuffer = await file.arrayBuffer();
      addLog(`✓ Archivo leído correctamente`);
      
      addLog(`🔄 Decodificando audio...`);
      const actx = new window.AudioContext();
      const audioBuffer = await actx.decodeAudioData(arrayBuffer);
      addLog(`✓ Audio decodificado: ${audioBuffer.duration.toFixed(2)}s`);
      
      addLog(`📊 Remuestreando a 16kHz...`);
      const offlineCtx = new window.OfflineAudioContext(1, audioBuffer.duration * 16000, 16000);
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);
      source.start();
      const renderedBuffer = await offlineCtx.startRendering();
      addLog(`✓ Remuestreo completado`);
      
      addLog(`🔐 Codificando a Base64...`);
      setStatus("Encoding audio...");
      const rawPcm = renderedBuffer.getChannelData(0);
      const base64Audio = await processAudioFile(rawPcm);
      addLog(`✓ Codificación completada: ${(base64Audio.length / 1024).toFixed(2)} KB`);

      addLog(`🌐 Conectando a WebSocket...`);
      setStatus("Connecting to server...");
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${process.env.NEXT_PUBLIC_WS_URL ?? `${protocol}//${window.location.host.split(":")[0]}:8000`}/ws/subtitle`;
      addLog(`Endpoint: ${wsUrl}`);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      const connectionTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          addLog(`⚠️ Timeout: WebSocket no conectó después de 10s`);
          ws.close();
        }
      }, 10000);

      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        addLog(`✓ WebSocket conectado`);
        setLiveSegments([]);
        setStatus("Sending payload chunking...");
        addLog(`Enviando config: ${sourceLang}→${targetLang}`);
        ws.send(JSON.stringify({
          type: "process",
          config: {
            input_lang: sourceLang,
            target_lang: targetLang,
            // Request a smaller Whisper model for faster load during subtitle generation
            whisper_model_size: whisperModel
          }
        }));
        
        const chunkBase64 = 100000;
        const chunks = Math.ceil(base64Audio.length / chunkBase64);
        addLog(`📨 Enviando ${chunks} chunks de audio...`);
        for (let i = 0; i < base64Audio.length; i += chunkBase64) {
          ws.send(JSON.stringify({
            type: "audio_chunk",
            data: base64Audio.substring(i, i + chunkBase64)
          }));
        }
        ws.send(JSON.stringify({ type: "audio_end" }));
        addLog(`✓ Todos los chunks enviados`);
      };
      
      ws.onerror = (evt: Event) => {
        clearTimeout(connectionTimeout);
        const errMsg = (evt as any)?.message ?? evt.type ?? 'Error desconocido';
        addLog(`❌ Error WebSocket: ${errMsg}`);
        // also log full event to console for debugging
        // eslint-disable-next-line no-console
        console.error('WebSocket error event:', evt);
        setStatus("WebSocket Error");
      };
      
      ws.onclose = () => {
        clearTimeout(connectionTimeout);
        addLog(`🔌 WebSocket desconectado`);
      };
      
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "status") {
          addLog(`📨 Status: ${msg.message || msg.state}`);
          setStatus(msg.message || msg.state);
        } else if (msg.type === "progress") {
          addLog(`⏳ Progreso: ${msg.current}/${msg.total} - ${msg.message || ''}`);
          setProgress({ current: msg.current, total: msg.total });
          setStatus(msg.message || `Translating chunk ${msg.current} of ${msg.total}`);
          if (msg.new_segment) {
            setLiveSegments(prev => [...prev, msg.new_segment]);
          }
        } else if (msg.type === "error") {
          addLog(`❌ Error: ${msg.message}`);
          setStatus(`Error: ${msg.message}`);
          ws.close();
        } else if (msg.type === "done") {
          addLog(`✅ Proceso completado - ${msg.segments?.length || 0} subtítulos generados`);
          setStatus("Done!");
          setCompletedSegments(msg.segments || []);
          ws.close();
        }
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      addLog(`❌ Error: ${errorMsg}`);
      setStatus(`Error: ${errorMsg}`);
    }
  };

  return (
    <div className="page" style={{ paddingBottom: "62px" }}>
      <AppHeader username={currentUser?.username} onLogout={handleLogout} />

      <header className="hero">
        <div>
          <h1>Subtitle generation</h1>
          <p className="subtitle">
            Sube un archivo de audio o video, elige el formato y genera subtítulos en vivo.
          </p>
        </div>
        <div className="status-card">
          <span className={`status-pill ${
            status.toLowerCase().includes("error") ? "error"
            : status === "Done!" ? "live"
            : progress ? "loading"
            : "idle"
          }`}>{
            status.toLowerCase().includes("error") ? "Error"
            : status === "Done!" ? "Done"
            : progress ? "Processing"
            : "Idle"
          }</span>
          <p className="status-text">{status}</p>
          <p className="status-meta">
            {progress ? `${progress.current} / ${progress.total} segments` : `Format: ${format}`}
          </p>
        </div>
      </header>

      <section className="grid">
        <div className="panel config subtitle-upload">
          <h2>Upload source</h2>
          <div
            className="subtitle-dropzone"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            {file ? (
              <p className="subtitle-dropzone-label">Selected: {file.name}</p>
            ) : (
              <p className="note">Drag and drop an MP3, MP4, or WAV file here</p>
            )}
            <input type="file" accept="audio/*,video/*" onChange={handleFileChange} />
          </div>

          <div className="select-grid">
            <label>
              Format
              <select value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value=".srt">.srt</option>
                <option value=".ass">.ass</option>
                <option value=".vtt">.vtt</option>
              </select>
            </label>
            <label>
              Whisper model
              <select value={whisperModel} onChange={(e) => setWhisperModel(e.target.value)}>
                <option value="tiny">tiny</option>
                <option value="small">small</option>
                <option value="medium">medium</option>
                <option value="turbo">turbo</option>
              </select>
            </label>
            <label>
              Source language
              <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)}>
                <option value="English">English</option>
                <option value="Spanish">Spanish</option>
                <option value="Japanese">Japanese</option>
                <option value="Chinese">Chinese</option>
              </select>
            </label>
            <label>
              Target language
              <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
                <option value="English">English</option>
                <option value="Spanish">Spanish</option>
                <option value="Japanese">Japanese</option>
                <option value="Chinese">Chinese</option>
              </select>
            </label>
          </div>

          <div className="button-row" style={{ marginTop: "1rem" }}>
            <button onClick={handleStart} disabled={!file || status.includes("... ")} className="btn primary">
              {status.includes("Done") ? "Generate again" : "Generate Subtitles"}
            </button>
            {completedSegments.length > 0 && (
              <button
                className="btn ghost"
                onClick={() => exportSubtitles(completedSegments)}
              >
                Descargar subtítulos
              </button>
            )}
          </div>

          <div className="subtitle-progress">
            <p className="status-meta">{status}</p>
            {progress && (
              <div className="voice-bar">
                <div
                  className="voice-fill"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="panel subtitle-preview">
          <h2>Live preview</h2>
          {liveSegments.length > 0 ? (
            <div className="subtitle-preview-list" ref={previewListRef}>
              {liveSegments.map((seg, idx) => (
                <div key={idx} className="subtitle-preview-item">
                  <span className="subtitle-preview-time">
                    {toSubtitleTime(seg.start, ".srt")} → {toSubtitleTime(seg.end, ".srt")}
                  </span>
                  <div className="subtitle-preview-body">
                    <div className="subtitle-preview-row">
                      <span className="subtitle-preview-label">Original</span>
                      <p className="subtitle-preview-source">{seg.text}</p>
                    </div>
                    <div className="subtitle-preview-row">
                      <span className="subtitle-preview-label">Traducción</span>
                      <p className="subtitle-preview-translation">{seg.translated}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="note">The live preview will appear here while processing.</p>
          )}
        </div>

        <div className="panel logs-panel">
          <h2>Actividad reciente</h2>
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
            background: status.toLowerCase().includes("error") ? "#ef4444"
              : status === "Done!" ? "#22c55e"
              : status === "Idle" ? "#cbd5e1"
              : "#3b82f6",
            boxShadow: status === "Done!" ? "0 0 6px #22c55e"
              : status !== "Idle" && !status.toLowerCase().includes("error") ? "0 0 8px rgba(59,130,246,0.6)"
              : "none",
          }} />
          <strong style={{ color: "#f1f5f9", fontSize: "13px" }}>{status}</strong>
        </div>

        <span style={{ color: "rgba(255,255,255,0.15)" }}>│</span>

        {/* Language pair + format */}
        <span style={{ flexShrink: 0 }}>
          {sourceLang}&nbsp;→&nbsp;{targetLang}
          &nbsp;·&nbsp;<strong style={{ color: "#f1f5f9" }}>{format}</strong>
        </span>

        {/* Progress — only when processing */}
        {progress && (
          <>
            <span style={{ color: "rgba(255,255,255,0.15)" }}>│</span>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
              <span>
                <strong style={{ color: "#f1f5f9" }}>{progress.current}</strong>
                <span style={{ opacity: 0.5 }}> / {progress.total}</span>
                &nbsp;segments
              </span>
              <div style={{ width: 120, height: 4, background: "#e2e8f0", borderRadius: 3 }}>
                <div style={{
                  width: `${(progress.current / progress.total) * 100}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
                  borderRadius: 3,
                  transition: "width 0.3s ease",
                }} />
              </div>
            </div>
          </>
        )}

        {/* File name — right-aligned */}
        {file && (
          <span style={{ marginLeft: "auto", opacity: 0.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260, flexShrink: 1 }}>
            {file.name}
          </span>
        )}
      </div>
    </div>
  );
}
