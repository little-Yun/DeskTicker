@echo off
setlocal

cd /d "%~dp0"

echo [1/4] Setting Electron mirror...
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"

echo [2/4] Installing dependencies if needed...
if not exist "node_modules" (
  call npm install
  if errorlevel 1 goto failed
) else (
  echo node_modules already exists, skip npm install.
)

echo [3/4] Packaging Windows app...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process YinPan -ErrorAction SilentlyContinue | Stop-Process -Force"
if exist "dist" rmdir /s /q "dist"
call npm run package:win
if errorlevel 1 goto failed

echo [4/4] Creating zip package...
if exist "YinPan-win32-x64.zip" del /f /q "YinPan-win32-x64.zip"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '.\dist\YinPan-win32-x64\*' -DestinationPath '.\YinPan-win32-x64.zip' -Force"
if errorlevel 1 goto failed

echo.
echo Done.
echo App folder: %cd%\dist\YinPan-win32-x64
echo Zip file:   %cd%\YinPan-win32-x64.zip
echo.
pause
exit /b 0

:failed
echo.
echo Packaging failed.
pause
exit /b 1
