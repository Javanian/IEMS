@echo off
set PYTHON=python
set SCRIPT=%~dp0tts_gen.py

if "%~1"=="" (
    echo TTS Generator — suara Indonesia
    echo.
    echo Usage:
    echo   tts "teks"                           = Edge Ardi ^(male, MP3^)
    echo   tts "teks" --voice gadis             = Edge Gadis ^(female, MP3^)
    echo   tts "teks" --engine piper            = Piper local ^(WAV^)
    echo   tts --list                           = List all voices
    echo.
    echo Contoh:
    echo   tts "Halo selamat pagi"
    echo   tts "Perhatian order selesai" --voice gadis
    exit /b 1
)

"%PYTHON%" "%SCRIPT%" %*
