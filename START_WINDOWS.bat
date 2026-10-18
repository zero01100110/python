@echo off
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel% equ 0 (
  start "" http://localhost:8000
  py -3 -m http.server 8000
  goto :end
)
where python >nul 2>nul
if %errorlevel% equ 0 (
  start "" http://localhost:8000
  python -m http.server 8000
  goto :end
)
echo Chua tim thay Python de mo HTTP server.
echo Dung VS Code Live Server, hoac upload len GitHub Pages de chay khong can cai Python.
pause
:end
