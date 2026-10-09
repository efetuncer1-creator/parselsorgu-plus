@echo off
chcp 65001 >nul
title Parsel Sorgu +
cd /d "%~dp0"
python -m parselapp.server %*
if errorlevel 1 pause
