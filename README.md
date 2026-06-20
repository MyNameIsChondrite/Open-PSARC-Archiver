# Open PSARC Archiver

A clean-room, open-source toolset for exploring, deep-inspecting, extracting, and repacking `.psarc` archives and inner encrypted `zlib` payloads. 

**This repository contains absolutely zero proprietary cryptography keys, copyrighted code, or intellectual property from any third party.** It is built purely on reverse-engineered container formats and standard cryptographic algorithms (AES-128-CTR).

**Bring Your Own Keys (BYOK):** To use this software, you must provide your own cryptographic keys.

## Features

### 🔍 Explorer
- View the internal file structure of `.psarc` archives.
- Extract individual files or entire folders.
- **Deep Zlib Inspection**: For encrypted payloads, the inspector automatically decrypts (using your keys) and decompresses the `zlib` payload, displaying the raw hex of the serialized C-struct data alongside the raw bytes on disk.

### 🔄 Batch Repacker
- Fully unpacks `.psarc` archives.
- Deep-repacks all inner encrypted payloads using entirely new AES keys and randomly generated IVs.
- Re-assembles the `.psarc` using your new custom keys.
- Fast, automated batch processing.

## Project Structure

This repository is split into two components:
1. `backend/`: The core Python engine for parsing, unpacking, and packing `.psarc` containers and encrypted `zlib` payloads.
2. `frontend/`: A modern Tauri (Rust + React + Vite) application that provides a beautiful UI to interact with the backend.

## Requirements

### Backend Requirements
- Python 3.8+
- `pycryptodome` (for AES-128-CTR cryptography)

```bash
cd backend
pip install -r requirements.txt
```

### Frontend Requirements
- Node.js & npm
- Rust (cargo)

```bash
cd frontend
npm install
npm run tauri dev
```

## Legal Disclaimer

This software is a clean-room implementation meant for educational purposes, software interoperability, and archiving. The authors do not condone piracy or copyright infringement. Users are fully responsible for ensuring they have the legal right to access and modify the files they process with this tool.

No cryptographic keys are included in this software.
