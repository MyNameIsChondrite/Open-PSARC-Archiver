use tauri::{AppHandle, Emitter};
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use std::thread;
use std::fs;

const INSPECTOR_SCRIPT: &str = r"..\backend\psarc_inspector.py";
const REPACKER_SCRIPT: &str = r"..\backend\deep_repacker.py";

#[tauri::command]
async fn list_psarc(
    file_path: String,
    key: String,
    iv: String,
) -> Result<String, String> {
    let output = Command::new("python")
        .arg(INSPECTOR_SCRIPT)
        .arg("list")
        .arg("--file").arg(&file_path)
        .arg("--key").arg(&key)
        .arg("--iv").arg(&iv)
        .output()
        .map_err(|e| format!("Failed to run inspector: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Inspector error: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
async fn inspect_entry(
    file_path: String,
    entry_name: String,
    key: String,
    iv: String,
    sng_key: String,
) -> Result<String, String> {
    let output = Command::new("python")
        .arg(INSPECTOR_SCRIPT)
        .arg("inspect")
        .arg("--file").arg(&file_path)
        .arg("--entry").arg(&entry_name)
        .arg("--key").arg(&key)
        .arg("--iv").arg(&iv)
        .arg("--sng-key").arg(&sng_key)
        .output()
        .map_err(|e| format!("Failed to run inspector: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Inspector error: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
async fn run_repacker(
    app: AppHandle,
    input_dir: String,
    output_dir: String,
    old_psarc_key: String,
    old_psarc_iv: String,
    new_psarc_key: String,
    new_psarc_iv: String,
    old_sng_key: String,
    new_sng_key: String,
    overwrite: bool,
) -> Result<(), String> {
    let mut cmd = Command::new("python");
    cmd.arg(REPACKER_SCRIPT)
        .arg("-i").arg(&input_dir)
        .arg("-o").arg(&output_dir)
        .arg("--old-psarc-key").arg(&old_psarc_key)
        .arg("--old-psarc-iv").arg(&old_psarc_iv)
        .arg("--new-psarc-key").arg(&new_psarc_key)
        .arg("--new-psarc-iv").arg(&new_psarc_iv)
        .arg("--old-sng-key").arg(&old_sng_key)
        .arg("--new-sng-key").arg(&new_sng_key);
        
    if overwrite {
        cmd.arg("--overwrite");
    }

    let mut child = match cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return Err(format!("Failed to start python script: {}", e)),
    };

    let stdout = child.stdout.take().expect("Failed to open stdout");

    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line_str) = line {
                let _ = app.emit("repacker-progress", line_str);
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn read_file_contents(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

#[tauri::command]
async fn write_file_contents(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, &contents).map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[tauri::command]
async fn extract_single_file(
    archive_path: String,
    entry_name: String,
    key: String,
    iv: String,
    output_path: String,
) -> Result<(), String> {
    let output = Command::new("python")
        .arg(INSPECTOR_SCRIPT)
        .arg("extract")
        .arg("--file").arg(&archive_path)
        .arg("--entry").arg(&entry_name)
        .arg("--key").arg(&key)
        .arg("--iv").arg(&iv)
        .arg("--output").arg(&output_path)
        .output()
        .map_err(|e| format!("Failed to run inspector: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Extract error: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.contains("error") {
        return Err(stdout.to_string());
    }

    Ok(())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            run_repacker, list_psarc, inspect_entry,
            read_file_contents, write_file_contents,
            extract_single_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
