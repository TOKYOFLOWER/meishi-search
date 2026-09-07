@echo off
cd /d X:\projects\meishi-search\ingest
if exist .venv\Scripts\python.exe (
  .venv\Scripts\python.exe ingest.py --once
) else (
  python ingest.py --once
)
