"""PSARC Inspector — list contents, extract individual files, deep-inspect zlib payloads."""
import sys
import os
import json
import struct
import zlib
import base64

# Add the slopsmith lib to path so we can import psarc
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

import psarc

def cmd_list(filepath: str, key: str, iv: str):
    """List all entries inside a PSARC archive."""
    psarc.ARC_KEY = bytes.fromhex(key) if key else b""
    psarc.ARC_IV = bytes.fromhex(iv) if iv else b""

    try:
        with open(filepath, "rb") as f:
            entries, filenames, block_sizes, block_size = psarc._parse_toc(f)

        file_list = []
        for entry, filename in zip(entries[1:], filenames):
            filename = filename.strip()
            if not filename:
                continue
            ext = os.path.splitext(filename)[1].lower()
            file_list.append({
                "name": filename,
                "size": entry["length"],
                "ext": ext,
                "is_zlib": ext in (".c_struct", ".json", ".xml", ".hsan", ".manifest"),
            })

        print(json.dumps({"type": "file_list", "files": file_list, "archive": filepath}))
    except Exception as e:
        print(json.dumps({"type": "error", "message": str(e)}))


def cmd_inspect(filepath: str, entry_name: str, key: str, iv: str, c_struct_key: str = ""):
    """Extract and inspect a single file from a PSARC."""
    psarc.ARC_KEY = bytes.fromhex(key) if key else b""
    psarc.ARC_IV = bytes.fromhex(iv) if iv else b""

    try:
        result = psarc.read_psarc_entries(filepath, patterns=[entry_name])
        if not result:
            print(json.dumps({"type": "error", "message": f"Entry '{entry_name}' not found"}))
            return

        data = list(result.values())[0]
        name = list(result.keys())[0]
        ext = os.path.splitext(name)[1].lower()

        info = {
            "type": "inspect_result",
            "name": name,
            "raw_size": len(data),
            "ext": ext,
            "hex_preview": data[:256].hex(),
            "is_text": False,
            "text_content": "",
            "is_c_struct": ext == ".c_struct",
            "c_struct_info": None,
        }

        # Try to decode as text
        if ext in (".xml", ".json", ".hsan", ".manifest", ".txt", ".ini", ".cfg"):
            try:
                text = data.decode("utf-8", errors="replace")
                info["is_text"] = True
                info["text_content"] = text[:8192]  # Cap at 8KB for the UI
            except Exception:
                pass

        # Deep inspect .c_struct files (AES-CTR encrypted zlib payloads)
        if ext == ".c_struct" and c_struct_key and len(data) > 80:
            try:
                from Crypto.Cipher import AES as AES_Mod
                from Crypto.Util import Counter

                c_struct_key_bytes = bytes.fromhex(c_struct_key)
                iv_bytes = data[8:24]
                encrypted = data[24:-56]

                ctr = Counter.new(128, initial_value=int.from_bytes(iv_bytes, "big"))
                cipher = AES_Mod.new(c_struct_key_bytes, AES_Mod.MODE_CTR, counter=ctr)
                decrypted = cipher.decrypt(encrypted)

                # First 4 bytes = uncompressed size, then zlib
                uncomp_size = struct.unpack(">I", decrypted[:4])[0]
                try:
                    decompressed = zlib.decompress(decrypted[4:])
                    info["c_struct_info"] = {
                        "encrypted_size": len(encrypted),
                        "iv": iv_bytes.hex(),
                        "uncompressed_size": uncomp_size,
                        "actual_decompressed": len(decompressed),
                        "hex_preview": decompressed[:256].hex(),
                        "signature": data[-56:].hex(),
                    }
                except zlib.error as ze:
                    info["c_struct_info"] = {
                        "encrypted_size": len(encrypted),
                        "iv": iv_bytes.hex(),
                        "error": f"zlib decompression failed: {ze}",
                    }
            except Exception as e:
                info["c_struct_info"] = {"error": str(e)}

        print(json.dumps(info))
    except Exception as e:
        print(json.dumps({"type": "error", "message": str(e)}))


def cmd_extract(filepath: str, entry_name: str, key: str, iv: str, output_path: str):
    """Extract a single file from a PSARC and save it to disk."""
    psarc.ARC_KEY = bytes.fromhex(key) if key else b""
    psarc.ARC_IV = bytes.fromhex(iv) if iv else b""

    try:
        result = psarc.read_psarc_entries(filepath, patterns=[entry_name])
        if not result:
            print(json.dumps({"type": "error", "message": f"Entry '{entry_name}' not found"}))
            return

        data = list(result.values())[0]
        os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else ".", exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(data)
        print(json.dumps({"type": "success", "message": f"Extracted {len(data)} bytes to {output_path}"}))
    except Exception as e:
        print(json.dumps({"type": "error", "message": str(e)}))


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command")

    p_list = sub.add_parser("list")
    p_list.add_argument("--file", required=True)
    p_list.add_argument("--key", default="")
    p_list.add_argument("--iv", default="")

    p_inspect = sub.add_parser("inspect")
    p_inspect.add_argument("--file", required=True)
    p_inspect.add_argument("--entry", required=True)
    p_inspect.add_argument("--key", default="")
    p_inspect.add_argument("--iv", default="")
    p_inspect.add_argument("--sng-key", default="")

    p_extract = sub.add_parser("extract")
    p_extract.add_argument("--file", required=True)
    p_extract.add_argument("--entry", required=True)
    p_extract.add_argument("--key", default="")
    p_extract.add_argument("--iv", default="")
    p_extract.add_argument("--output", required=True)

    args = parser.parse_args()
    if args.command == "list":
        cmd_list(args.file, args.key, args.iv)
    elif args.command == "inspect":
        cmd_inspect(args.file, args.entry, args.key, args.iv, args.c_struct_key)
    elif args.command == "extract":
        cmd_extract(args.file, args.entry, args.key, args.iv, args.output)
    else:
        parser.print_help()
