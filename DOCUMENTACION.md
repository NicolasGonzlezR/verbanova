# Documentacion de TranslateApp

## 1. Descripcion general

TranslateApp es una aplicacion de escritorio para Windows que captura voz del microfono, la transcribe, la traduce y la vuelve a reproducir con clonacion de voz.

El objetivo del proyecto es un MVP funcional de traduccion de voz por frases (no streaming palabra por palabra), priorizando modularidad y facilidad de evolucion.

## 2. Flujo funcional (pipeline)

La app ejecuta este flujo en tiempo real:

1. Captura de audio de entrada con `sounddevice`.
2. Segmentacion por voz/silencio con VAD Silero.
3. Transcripcion de cada segmento con Whisper.
4. Traduccion del texto con NLLB.
5. Sintesis de voz clonada con XTTS v2 usando un WAV de referencia.
6. Reproduccion del audio sintetizado por el dispositivo de salida.
7. Visualizacion en GUI (texto transcrito y traducido).

## 3. Arquitectura del proyecto

### 3.1 GUI y ciclo de vida

Archivo: `main.py`

Responsabilidades principales:

- Construir la interfaz Tkinter (Start/Stop, dispositivos, idiomas, perfil de voz, logs de texto).
- Cargar modelos en segundo plano al iniciar.
- Crear y coordinar tres workers al pulsar Start:
  - `AudioInputWorker`
  - `ProcessingWorker`
  - `AudioOutputWorker`
- Detener workers y limpiar colas al pulsar Stop o cerrar ventana.

### 3.2 Captura y reproduccion de audio

Archivo: `audio.py`

- `AudioInputWorker`:
  - Abre stream de entrada con fallback automatico de sample rate/canales/formato.
  - Convierte entrada a mono `float32`.
  - Re-muestrea a 16 kHz cuando es necesario.
  - Entrega frames al segmentador VAD para detectar frases completas.
- `AudioOutputWorker`:
  - Reproduce resultados TTS bloqueando por cada frase para mantener orden.

### 3.3 Segmentacion de frases (VAD)

Archivo: `vad.py`

- `PhraseSegmenter` usa la probabilidad de voz entregada por Silero.
- Acumula buffers mientras hay voz.
- Cierra frase cuando detecta suficiente silencio (`silence_ms_to_split`) o limite de duracion (`max_phrase_seconds`).
- Descarta segmentos demasiado cortos (`min_phrase_ms`) para reducir ruido.

### 3.4 Procesamiento NLP/TTS

Archivo: `pipeline.py`

- `ProcessingWorker` consume segmentos detectados y ejecuta:
  1. `transcribe(...)`
  2. `translate(...)`
  3. `synthesize(...)`
- Publica resultados de texto a la GUI.
- Inserta audio sintetizado en la cola de salida.

### 3.5 Carga y manejo de modelos

Archivo: `models.py`

- `ModelManager` centraliza todos los modelos y caches locales.
- Modelos cargados:
  - Silero VAD
  - Whisper
  - NLLB (transformers)
  - XTTS v2 (Coqui TTS)
- Gestiona dispositivo de computo (`auto`, `gpu`, `cpu`).
- Implementa glosario de nombres (`assets/names.txt`) para:
  - Mejorar transcripcion (prompt inicial)
  - Proteger nombres propios durante traduccion (placeholders)

## 4. Idiomas soportados en la interfaz

Configurados en `main.py`:

- English
- Spanish
- Japanese
- Chinese

Por cada idioma se define:

- Codigo para Whisper
- Codigo para NLLB
- Codigo para XTTS

## 5. Requisitos del entorno

- Windows (script de setup preparado para PowerShell).
- Python 3.10 (el setup crea venv con `py -3.10`).
- Microfono y salida de audio funcionales.
- Conexion a internet en primer arranque (descarga de modelos).

Dependencias clave en `requirements.txt`:

- `torch==2.5.1`, `torchaudio==2.5.1`
- `openai-whisper`
- `transformers`, `sentencepiece`
- `TTS`
- `sounddevice`, `numpy`

Nota de compatibilidad: `torch` esta fijado por compatibilidad de checkpoints XTTS.

## 6. Instalacion (Windows)

Desde PowerShell, en la carpeta del proyecto:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\scripts\setup_windows.ps1
```

Para instalar variante CUDA (NVIDIA):

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\scripts\setup_windows.ps1 -UseCuda
```

Que hace el script:

- Crea `.venv`.
- Instala dependencias.
- Crea `.cache` local y redirige caches (`PIP_CACHE_DIR`, `HF_HOME`, `TORCH_HOME`, `XDG_CACHE_HOME`, `TTS_HOME`).
- Evita que modelos y paquetes se vayan a otra unidad por defecto.

## 7. Configuracion de voz de referencia

La app requiere al menos un WAV de referencia:

- Opcion simple: `assets/speaker.wav`
- Opcion multi-perfil: `assets/<perfil>/speaker.wav`

Ejemplos:

- `assets/speaker1/speaker.wav`
- `assets/mi_voz/speaker.wav`

Luego en la GUI:

1. Seleccionar perfil en "Speaker profile".
2. Pulsar "Refresh speakers" si agregaste archivos con la app abierta.

## 8. Ejecucion

```powershell
.\.venv\Scripts\python.exe .\main.py
```

Flujo de uso recomendado:

1. Esperar estado "Models ready".
2. Elegir dispositivo de entrada y salida.
3. Elegir idioma origen y destino.
4. Elegir perfil de voz.
5. Pulsar Start y hablar por frases.
6. Pulsar Stop para finalizar.

## 9. Rendimiento y latencia esperada

- En primer arranque puede tardar por descarga/carga de modelos.
- La latencia por frase es normal en este MVP (varios segundos segun hardware).
- GPU reduce tiempos de transcripcion/traduccion/sintesis.

## 10. Problemas comunes

### 10.1 No aparece audio de entrada o salida

- Revisa dispositivos en la GUI y usa "Refresh devices".
- Verifica permisos de microfono en Windows.
- Prueba con "Default" primero.

### 10.2 Error por speaker.wav faltante

- Agrega `assets/speaker.wav` o un perfil en `assets/<perfil>/speaker.wav`.

### 10.3 Arranque lento o consumo alto

- Es normal en modelos grandes.
- Cambia compute a CPU/GPU segun disponibilidad.
- Considera reducir modelo Whisper en `ModelConfig`.

## 11. Seguridad y datos

- El procesamiento se ejecuta localmente en tu maquina.
- Los modelos pueden descargarse de repositorios externos en primer uso.
- El audio capturado se maneja en memoria dentro del proceso.
