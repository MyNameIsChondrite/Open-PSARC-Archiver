# Architecture Overview

This project is a clean-room implementation of a PSARC Archiver tool split into a Python backend and a Tauri (Rust + React) frontend.

## The Problem
Many proprietary `.psarc` files contain AES-128-CTR encrypted `zlib` payloads (often with specific extension formats). The cryptography keys are proprietary to the respective publishers and cannot be legally distributed.

## The Solution: BYOK (Bring Your Own Keys)
This tool is built around the philosophy that the user must provide their own keys. We distribute the *algorithm* (how to decrypt/decompress given a key), but we do *not* distribute the keys.

## Backend (Python)
Located in `backend/`.
- `psarc.py`: A completely key-less parser and packer for the PlayStation Archive (`.psarc`) container format. Uses standard Python `struct` and `zlib` modules. Keys are injected at runtime via module globals `psarc.ARC_KEY` and `psarc.ARC_IV`.
- `patcher.py`: Wraps `psarc.py` to handle the specific directory traversal logic required to pack folders back into a `.psarc`.
- `deep_repacker.py`: The core utility that unpacks a `.psarc`, scans the output for encrypted files, decrypts them using the user-provided "old" payload key, encrypts them using the user-provided "new" payload key and a freshly generated IV, and finally packs everything back into a new `.psarc` using the new PSARC keys.
- `psarc_inspector.py`: A utility to list `.psarc` contents and deep-inspect the raw bytes and decompressed payload of individual encrypted files on the fly. 

## Frontend (Tauri)
Located in `frontend/`.
- **Rust (`src-tauri/src/lib.rs`)**: Acts as a bridge. Exposes Tauri commands (`run_repacker`, `list_psarc`, `inspect_entry`) that spawn standard `Command` processes calling the Python backend scripts in `backend/`.
- **React (`src/App.tsx`)**: The UI layer. It maintains the user's input keys and passes them as arguments to the Rust commands. Uses standard React state and hooks.
- **Vite**: Bundles the React application.

## Inter-Process Communication
The frontend communicates with the Python scripts via standard streams. 
- **Inspector**: JSON stdout. The Python script prints a JSON string, which the Rust layer parses and forwards to the frontend.
- **Repacker**: Real-time progress. The Python script prints `{"type": "progress"}` JSON lines to stdout as it processes files. Rust spawns a background thread reading stdout line-by-line and emitting Tauri events (`app.emit()`) which are caught by the React frontend (`listen()`) to update the progress bar.
