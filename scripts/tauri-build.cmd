@echo off
REM Helper for Windows: setup MSVC env + run pnpm tauri build.
REM Usage from project root: scripts\tauri-build.cmd

REM Add cargo to PATH (rustup install location)
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" (
  set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
)
if not exist "%VCVARS%" (
  echo ERROR: vcvars64.bat not found. Install VS Build Tools with "Desktop development with C++" workload.
  exit /b 1
)

call "%VCVARS%" >nul 2>nul
pnpm tauri build %*
