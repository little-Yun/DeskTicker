@echo off
setlocal

cd /d "%~dp0"

echo [1/4] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not in PATH.
  echo Please install Node.js first: https://nodejs.org/
  pause
  exit /b 1
)

echo [2/4] Checking dependencies...
if not exist "node_modules" (
  echo Installing dependencies...
  set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo [3/4] Packaging Windows app...
call npm run package:win
if errorlevel 1 (
  echo Package failed.
  pause
  exit /b 1
)

echo [4/4] Done.
echo Output: %CD%\dist\YinPan-win32-x64\YinPan.exe
pause
