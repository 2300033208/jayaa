@echo off
rem Starts the Atomic Gravity Simulator (engine + built frontend on http://127.0.0.1:8000) and opens it.
cd /d "%~dp0"
python run.py %*
if errorlevel 1 pause
