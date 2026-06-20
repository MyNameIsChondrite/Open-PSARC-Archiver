import os
import argparse
import tempfile
import shutil
import zlib
import struct
import secrets
import json
from pathlib import Path

try:
    from Crypto.Cipher import AES
    from Crypto.Util import Counter
except ImportError:
    AES = None

import psarc
import patcher
import hashlib

def derive_key(input_str: str, required_length: int) -> bytes:
    """If input is valid hex of the right length, use it. Otherwise, hash it to the required length."""
    try:
        b = bytes.fromhex(input_str)
        if len(b) in (16, 24, 32) and required_length == 32:
            return b
        if len(b) == 16 and required_length == 16:
            return b
    except ValueError:
        pass
    
    # Not valid hex or wrong length -> hash it to get deterministic bytes
    h = hashlib.sha256(input_str.encode('utf-8')).digest()
    return h[:required_length]

def process_c_struct(data: bytes, old_key: bytes, new_key: bytes, new_iv: bytes) -> bytes:
    if AES is None:
        raise RuntimeError("pycryptodome not installed")
    
    if len(data) < 24 + 56:
        # Not a valid SNG or already unencrypted/different format
        return data

    magic = data[0:4]
    if magic != b'J\x00\x00\x00':
        # Might not be a standard SNG or we're not dealing with the right file
        pass

    version = data[4:8]
    old_iv = data[8:24]
    encrypted_payload = data[24:-56]
    
    # Decrypt
    ctr = Counter.new(128, initial_value=int.from_bytes(old_iv, "big"))
    cipher = AES.new(old_key, AES.MODE_CTR, counter=ctr)
    decrypted_payload = cipher.decrypt(encrypted_payload)

    # Re-encrypt with new key and the provided IV
    new_ctr = Counter.new(128, initial_value=int.from_bytes(new_iv, "big"))
    new_cipher = AES.new(new_key, AES.MODE_CTR, counter=new_ctr)
    new_encrypted_payload = new_cipher.encrypt(decrypted_payload)

    # Reconstruct the SNG file
    signature = bytes(56) # 56 bytes of zero or copy old signature
    # Copying the old signature is safer to maintain exact byte sizes
    old_signature = data[-56:]
    
    return magic + version + new_iv + new_encrypted_payload + old_signature

def repack_psarc_deep(input_dir: str, output_dir: str, old_psarc_key: str, old_psarc_iv: str, new_psarc_key: str, new_psarc_iv: str, old_c_struct_key: str, new_c_struct_key: str, overwrite: bool):
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    old_pk = bytes.fromhex(old_psarc_key)
    old_piv = bytes.fromhex(old_psarc_iv)
    old_sk = bytes.fromhex(old_c_struct_key)
    
    new_pk = derive_key(new_psarc_key, 32)
    new_piv = derive_key(new_psarc_iv, 16)
    new_sk = derive_key(new_c_struct_key, 32)

    if input_path.is_file():
        psarc_files = [input_path]
    else:
        psarc_files = list(input_path.glob("*.psarc"))
        
    if not psarc_files:
        print(json.dumps({"type": "log", "message": f"No .psarc files found in {input_dir}"}))
        return

    print(json.dumps({"type": "progress", "total": len(psarc_files), "current": 0}))

    for idx, filepath in enumerate(psarc_files):
        out_file = output_path / filepath.name
        if out_file.exists() and not overwrite:
            print(json.dumps({"type": "log", "message": f"Skipping {filepath.name} (already exists)"}))
            print(json.dumps({"type": "progress", "total": len(psarc_files), "current": idx + 1}))
            continue

        print(json.dumps({"type": "log", "message": f"Processing {filepath.name}..."}))
        
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            
            # UNPACK PSARC
            psarc.ARC_KEY = old_pk
            psarc.ARC_IV = old_piv
            try:
                psarc.unpack_psarc(str(filepath), str(temp_path))
            except Exception as e:
                print(json.dumps({"type": "log", "message": f"Error unpacking {filepath.name}: {e}"}))
                print(json.dumps({"type": "progress", "total": len(psarc_files), "current": idx + 1}))
                continue

            # DEEP REPACK SNGs
            c_struct_count = 0
            for f in temp_path.rglob("*.c_struct"):
                try:
                    data = f.read_bytes()
                    # Generate a unique random IV for each SNG file
                    unique_c_struct_iv = secrets.token_bytes(16)
                    new_data = process_c_struct(data, old_sk, new_sk, unique_c_struct_iv)
                    f.write_bytes(new_data)
                    c_struct_count += 1
                except Exception as e:
                    print(json.dumps({"type": "log", "message": f"Error processing SNG {f.name}: {e}"}))
            
            print(json.dumps({"type": "log", "message": f"  Converted {c_struct_count} inner .c_struct files."}))

            # REPACK PSARC
            patcher.ARC_KEY = new_pk
            patcher.ARC_IV = new_piv
            
            try:
                patcher.pack_psarc(str(temp_path), str(out_file))
                print(json.dumps({"type": "log", "message": f"  Successfully repacked to {out_file.name}"}))
            except Exception as e:
                print(json.dumps({"type": "log", "message": f"Error packing {filepath.name}: {e}"}))
        
        print(json.dumps({"type": "progress", "total": len(psarc_files), "current": idx + 1}))

    print(json.dumps({"type": "done"}))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("-i", "--input", required=True)
    parser.add_argument("-o", "--output", required=True)
    parser.add_argument("--old-psarc-key", required=True)
    parser.add_argument("--old-psarc-iv", required=True)
    parser.add_argument("--new-psarc-key", required=True)
    parser.add_argument("--new-psarc-iv", required=True)
    parser.add_argument("--old-sng-key", required=True)
    parser.add_argument("--new-sng-key", required=True)
    parser.add_argument("--overwrite", action="store_true")
    
    args = parser.parse_args()
    
    try:
        repack_psarc_deep(
            input_dir=args.input,
            output_dir=args.output,
            old_psarc_key=args.old_psarc_key,
            old_psarc_iv=args.old_psarc_iv,
            new_psarc_key=args.new_psarc_key,
            new_psarc_iv=args.new_psarc_iv,
            old_c_struct_key=args.old_c_struct_key,
            new_c_struct_key=args.new_c_struct_key,
            overwrite=args.overwrite
        )
    except Exception as e:
        print(json.dumps({"type": "log", "message": f"Fatal error: {e}"}))
