$ErrorActionPreference = "Stop"

param(
    [switch]$UseCuda
)

$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $ProjectRoot

$env:PIP_CACHE_DIR = Join-Path $ProjectRoot ".cache\pip"
$env:HF_HOME = Join-Path $ProjectRoot ".cache\huggingface"
$env:TORCH_HOME = Join-Path $ProjectRoot ".cache\torch"
$env:XDG_CACHE_HOME = Join-Path $ProjectRoot ".cache"
$env:TTS_HOME = Join-Path $ProjectRoot ".cache\tts"

New-Item -ItemType Directory -Force -Path ".cache", ".cache\pip", ".cache\huggingface", ".cache\torch", ".cache\tts", "assets" | Out-Null

if (!(Test-Path ".venv")) {
    py -3.10 -m venv .venv
}

& .\.venv\Scripts\python.exe -m pip install --upgrade pip wheel "setuptools<82"
& .\.venv\Scripts\python.exe -m pip install -r .\requirements.txt

if ($UseCuda) {
    Write-Host "Installing CUDA-enabled PyTorch wheels (cu124)..."
    & .\.venv\Scripts\python.exe -m pip install --upgrade --force-reinstall torch==2.5.1+cu124 torchaudio==2.5.1+cu124 --index-url https://download.pytorch.org/whl/cu124
    & .\.venv\Scripts\python.exe -m pip install "networkx<3"
}

Write-Host "Setup complete."
Write-Host "Virtual environment: $ProjectRoot\.venv"
Write-Host "Cache root: $ProjectRoot\.cache"
Write-Host "Run: .\.venv\Scripts\python.exe .\main.py"
if ($UseCuda) {
    Write-Host "CUDA mode enabled: torch/torchaudio installed from cu124 index"
}
