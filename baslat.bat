@echo off
chcp 65001 >nul
cd /d "%~dp0"
python -m parselapp.server %*
if errorlevel 1 pause
