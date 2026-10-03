@echo off
rem Broken State desktop app, run from source (always the current game files in prototype\).
rem First run installs Electron into desktop\node_modules (about 360 MB, once).
setlocal
cd /d "%~dp0desktop"
if exist "node_modules\electron\dist\electron.exe" goto run
where npm >/dev/null 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
echo First run: installing the desktop app (Electron, about 360 MB download^). This happens only once...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo The install failed. Check the internet connection and run this file again.
  pause
  exit /b 1
)
:run
start "" "node_modules\electron\dist\electron.exe" .
