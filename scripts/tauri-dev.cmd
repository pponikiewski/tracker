@echo off
REM Helper for Windows: setup MSVC env + run pnpm tauri dev.
REM Usage from project root: scripts\tauri-dev.cmd

set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" (
  set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
)
if not exist "%VCVARS%" (
  echo ERROR: vcvars64.bat not found. Install VS Build Tools with "Desktop development with C++" workload.
  exit /b 1
)

call "%VCVARS%" >nul
pnpm tauri dev %*
