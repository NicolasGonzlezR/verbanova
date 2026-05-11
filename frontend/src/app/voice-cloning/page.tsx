"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import AppHeader from "@/components/AppHeader";
import { clearAuthCookie, getClientAuthToken, setAuthCookie } from "@/lib/session";

type VoiceProfile = {
  id: string;
  name: string;
  sourceType: string;
  sourceUrl: string;
  createdAt: string;
};

type User = { id: string; email: string; username: string };

function makeRecorderMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];

  for (const candidate of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return "";
}

function extensionFromMimeType(mimeType: string) {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("mp4")) return "m4a";
  if (normalized.includes("mpeg")) return "mp3";
  return "wav";
}

export default function VoiceCloningPage() {
  const [authReady, setAuthReady] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [profileName, setProfileName] = useState("");
  const [profileFile, setProfileFile] = useState<File | null>(null);
  const [recordedName, setRecordedName] = useState("");
  const [recordedFile, setRecordedFile] = useState<File | null>(null);
  const [recordedPreviewUrl, setRecordedPreviewUrl] = useState<string | null>(null);
  const [recordedPreviewName, setRecordedPreviewName] = useState("");
  const [recordedPreviewDuration, setRecordedPreviewDuration] = useState(0);
  const [recordedPreviewCurrentTime, setRecordedPreviewCurrentTime] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recordingLevel, setRecordingLevel] = useState(0);
  const [logs, setLogs] = useState<{ time: string; message: string }[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const router = useRouter();

  const addLog = (message: string) => {
    const time = new Date().toLocaleTimeString("es-ES", { hour12: false });
    setLogs((prev) => [...prev.slice(-50), { time, message }]);
  };

  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs]);

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

  useEffect(() => {
    if (!authToken) return;

    const loadProfiles = async () => {
      const response = await fetch("/api/profiles", {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (response.status === 401) {
        window.localStorage.removeItem("translateapp_token");
        window.localStorage.removeItem("translateapp_user");
        clearAuthCookie();
        router.replace("/login");
        return;
      }
      const data = await response.json();
      setProfiles(data.profiles || []);
    };

    void loadProfiles();
  }, [authToken, router]);

  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      analyserRef.current?.disconnect();
      analyserRef.current = null;
      audioContextRef.current?.close();
      audioContextRef.current = null;
      if (recordedPreviewUrl) {
        URL.revokeObjectURL(recordedPreviewUrl);
      }
    };
  }, [recordedPreviewUrl]);

  const updateRecordedPreviewUrl = (url: string, name: string) => {
    setRecordedPreviewUrl((previousUrl) => {
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
      return url;
    });
    setRecordedPreviewName(name);
    setRecordedPreviewCurrentTime(0);
    setRecordedPreviewDuration(0);
    setIsPreviewPlaying(false);
  };

  const stopRecordingMeter = () => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    setRecordingLevel(0);
  };

  const requireAuth = () => {
    if (!authToken) {
      setStatus("Login required");
      router.replace("/login");
      return false;
    }
    return true;
  };

  const reloadProfiles = async () => {
    if (!authToken) return;
    const response = await fetch("/api/profiles", {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (response.ok) {
      const data = await response.json();
      setProfiles(data.profiles || []);
    }
  };

  const deleteProfile = async (id: string, name: string) => {
    if (!authToken) return;
    addLog(`🗑️ Eliminando perfil: ${name}`);
    const response = await fetch(`/api/profiles/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (response.ok) {
      addLog(`✓ Perfil eliminado: ${name}`);
      await reloadProfiles();
    } else {
      const payload = await response.json().catch(() => ({}));
      addLog(`❌ Error al eliminar: ${payload.error || response.statusText}`);
    }
  };

  const uploadProfile = async (name: string, file: File) => {
    if (!authToken) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("name", name);
      formData.append("file", file);

      const response = await fetch("/api/profiles", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Upload failed");
      }

      addLog(`✓ Perfil guardado: ${name}`);
      setStatus("Profile saved");
      await reloadProfiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog(`❌ Upload failed: ${message}`);
      setStatus(message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleLogout = () => {
    window.localStorage.removeItem("translateapp_token");
    window.localStorage.removeItem("translateapp_user");
    clearAuthCookie();
    router.replace("/login");
  };

  const handleUploadFile = async () => {
    if (!requireAuth()) return;
    if (!profileName || !profileFile) {
      setStatus("Add a name and an audio file");
      return;
    }
    addLog(`Subiendo archivo ${profileFile.name}`);
    await uploadProfile(profileName, profileFile);
    setProfileName("");
    setProfileFile(null);
  };

  const handleTogglePreviewPlay = async () => {
    const audio = previewAudioRef.current;
    if (!audio || !recordedPreviewUrl) return;

    if (audio.paused) {
      try {
        await audio.play();
        setIsPreviewPlaying(true);
      } catch (error) {
        console.error(error);
      }
      return;
    }

    audio.pause();
    setIsPreviewPlaying(false);
  };

  const handlePreviewSeek = (value: number) => {
    const audio = previewAudioRef.current;
    if (!audio || !Number.isFinite(value)) return;
    audio.currentTime = value;
    setRecordedPreviewCurrentTime(value);
  };

  const handleStartRecording = async () => {
    if (!requireAuth()) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Microphone access not supported");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog(`❌ Microphone error: ${message}`);
      setStatus(message);
      return;
    }

    const mimeType = makeRecorderMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);
    const updateLevel = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let index = 0; index < data.length; index += 1) {
        const value = Math.abs(data[index] - 128) / 128;
        if (value > peak) peak = value;
      }
      setRecordingLevel(Math.min(1, peak * 1.4));
      rafRef.current = window.requestAnimationFrame(updateLevel);
    };

    streamRef.current = stream;
    recorderRef.current = recorder;
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    recordedChunksRef.current = [];
    setIsRecording(true);
    setStatus("Recording...");
    addLog("⏺️ Grabación iniciada");
    updateLevel();

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      setIsRecording(false);
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      stopRecordingMeter();

      const blob = new Blob(recordedChunksRef.current, {
        type: mimeType || "audio/webm",
      });
      recordedChunksRef.current = [];

      if (!blob.size) {
        setStatus("Recording discarded");
        return;
      }

      const extension = extensionFromMimeType(blob.type || mimeType || "audio/webm");
      const recordedFileName = recordedName.trim() || `voice-test-${Date.now()}`;
      const file = new File([blob], `${recordedFileName}.${extension}`, {
        type: blob.type || mimeType || "audio/webm",
      });

      const previewUrl = URL.createObjectURL(blob);
      updateRecordedPreviewUrl(previewUrl, file.name);
      setRecordedFile(file);
      addLog(`🎙️ Grabación lista — revisa el audio y guarda el perfil.`);
      setStatus("Recording ready");
    };

    recorder.start();
  };

  const handleStopRecording = () => {
    if (!recorderRef.current || recorderRef.current.state === "inactive") return;
    addLog("⏹️ Grabación detenida por el usuario");
    recorderRef.current.stop();
  };

  const handleSaveRecording = async () => {
    if (!requireAuth() || !recordedFile) return;
    const name = recordedName.trim() || recordedFile.name.replace(/\.[^.]+$/, "");
    addLog(`💾 Guardando perfil: ${name}`);
    await uploadProfile(name, recordedFile);
    setRecordedFile(null);
    setRecordedPreviewUrl(null);
  };

  const handleDiscardRecording = () => {
    setRecordedFile(null);
    setRecordedPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setRecordedPreviewName("");
    addLog("🗑️ Grabación descartada");
    setStatus("Ready");
  };

  if (!authReady) {
    return (
      <div className="page">
        <div className="panel">
          <p className="note">Cargando sesión...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <AppHeader username={currentUser?.username} onLogout={handleLogout} />

      <header className="hero">
        <div>
          <h1>Voice profile capture</h1>
          <p className="subtitle">
            Sube un archivo o graba una prueba de voz en tiempo real para crear tu perfil.
          </p>
        </div>
        <div className="status-card">
          <span className={`status-pill ${
            isRecording ? "live"
            : isUploading ? "loading"
            : status.toLowerCase().includes("failed") || status.toLowerCase().includes("error") ? "error"
            : status === "Profile saved" ? "live"
            : "idle"
          }`}>{
            isRecording ? "Recording"
            : isUploading ? "Uploading"
            : status.toLowerCase().includes("failed") || status.toLowerCase().includes("error") ? "Error"
            : status === "Profile saved" ? "Saved"
            : "Idle"
          }</span>
          <p className="status-text">{status}</p>
          <p className="status-meta">{profiles.length === 0 ? "No profiles" : `${profiles.length} profile${profiles.length === 1 ? "" : "s"}`}</p>
        </div>
      </header>

      <section className="grid">
        <div className="panel config">
          <h2>Upload file</h2>
          <div className="select-grid">
            <label>
              Profile name
              <input value={profileName} onChange={(event) => setProfileName(event.target.value)} />
            </label>
            <label>
              Audio file
              <input
                type="file"
                accept="audio/*"
                onChange={(event) => setProfileFile(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <div className="button-row" style={{ marginTop: "1rem" }}>
            <button className="btn primary" onClick={handleUploadFile} disabled={isUploading}>
              Upload profile
            </button>
          </div>
        </div>

        <div className="panel controls">
          <h2>Record and upload voice sample</h2>
          <div className="select-grid">
            <label>
              Sample name
              <input
                value={recordedName}
                onChange={(event) => setRecordedName(event.target.value)}
                placeholder="example: sample-1"
              />
            </label>
          </div>
          <p className="note">Graba con el micrófono. Al detener podrás revisar el audio y decidir si guardar el perfil.</p>
          <div className="voice-meter">
            <div className="voice-label">
              <span>Voice activity</span>
              <span className={isRecording ? "live" : "idle"}>
                {isRecording ? "Recording" : "Idle"}
              </span>
            </div>
            <div className="voice-bar">
              <div className="voice-fill" style={{ width: `${recordingLevel * 100}%` }} />
            </div>
          </div>
          <div className="button-row">
            <button className="btn primary" onClick={handleStartRecording} disabled={isRecording}>
              Start recording
            </button>
            <button className="btn ghost" onClick={handleStopRecording} disabled={!isRecording}>
              Stop recording
            </button>
          </div>
          {recordedPreviewUrl && (
            <div className="recorded-preview">
              <div className="recorded-preview-header">
                <div>
                  <p className="recorded-preview-label">Recorded sample</p>
                  <p className="recorded-preview-name">{recordedPreviewName || "voice sample"}</p>
                </div>
                <button className="btn ghost" onClick={handleTogglePreviewPlay}>
                  {isPreviewPlaying ? "Pause" : "Play"}
                </button>
              </div>
              <audio
                ref={previewAudioRef}
                src={recordedPreviewUrl}
                onLoadedMetadata={(event) => {
                  const audio = event.currentTarget;
                  setRecordedPreviewDuration(audio.duration || 0);
                }}
                onTimeUpdate={(event) => {
                  const audio = event.currentTarget;
                  setRecordedPreviewCurrentTime(audio.currentTime || 0);
                }}
                onPlay={() => setIsPreviewPlaying(true)}
                onPause={() => setIsPreviewPlaying(false)}
                onEnded={() => setIsPreviewPlaying(false)}
              />
              <input
                className="recorded-slider"
                type="range"
                min={0}
                max={recordedPreviewDuration || 0}
                step="0.01"
                value={Math.min(recordedPreviewCurrentTime, recordedPreviewDuration || 0)}
                onChange={(event) => handlePreviewSeek(Number(event.target.value))}
                disabled={!recordedPreviewDuration}
              />
              <div className="recorded-preview-times">
                <span>{recordedPreviewCurrentTime.toFixed(1)}s</span>
                <span>{recordedPreviewDuration.toFixed(1)}s</span>
              </div>
              {recordedFile && (
                <div className="button-row" style={{ marginTop: "0.75rem" }}>
                  <button className="btn primary" onClick={handleSaveRecording} disabled={isUploading}>
                    {isUploading ? "Saving..." : "Save profile"}
                  </button>
                  <button className="btn ghost" onClick={handleDiscardRecording} disabled={isUploading}>
                    Discard
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="panel profiles">
          <h2>Saved profiles</h2>
          <div className="profile-list">
            {profiles.length === 0 ? (
              <p className="note">No profiles yet. Upload or record one to start cloning.</p>
            ) : (
              profiles.map((profile) => (
                <div key={profile.id} className="profile-card">
                  <div>
                    <p className="profile-name">{profile.name}</p>
                    <p className="profile-meta">{profile.sourceType.toUpperCase()}</p>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <a href={profile.sourceUrl} target="_blank" rel="noreferrer">
                      Preview
                    </a>
                    <button
                      className="btn ghost"
                      style={{ padding: "0.2rem 0.6rem", fontSize: "0.8rem" }}
                      onClick={() => deleteProfile(profile.id, profile.name)}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel logs-panel" ref={logsContainerRef}>
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
          <div ref={logsEndRef} />
        </div>
      </section>
    </div>
  );
}