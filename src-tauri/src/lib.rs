use std::{fs, path::{Path, PathBuf}};
use tauri::{AppHandle, Manager};

fn safe_component(value: &str) -> Result<String, String> {
    if value.is_empty() || !value.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')) {
        return Err("本地资源标识无效".into());
    }
    Ok(value.to_string())
}

fn asset_directory(app: &AppHandle, user_id: &str, project_id: &str, asset_id: &str) -> Result<PathBuf, String> {
    let root = app.path().app_data_dir().map_err(|error| error.to_string())?;
    Ok(root
        .join("users")
        .join(safe_component(user_id)?)
        .join("projects")
        .join(safe_component(project_id)?)
        .join("assets")
        .join(safe_component(asset_id)?))
}

fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else { return 0; };
    entries.flatten().map(|entry| {
        let path = entry.path();
        if path.is_dir() { directory_size(&path) } else { entry.metadata().map(|value| value.len()).unwrap_or(0) }
    }).sum()
}

#[tauri::command]
fn write_asset_chunk(
    app: AppHandle,
    user_id: String,
    project_id: String,
    asset_id: String,
    chunk_index: u32,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let directory = asset_directory(&app, &user_id, &project_id, &asset_id)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let temporary = directory.join(format!("{chunk_index:08}.part"));
    let final_path = directory.join(format!("{chunk_index:08}.chunk"));
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    fs::rename(temporary, final_path).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_asset_chunks(
    app: AppHandle,
    user_id: String,
    project_id: String,
    asset_id: String,
) -> Result<Vec<u8>, String> {
    let directory = asset_directory(&app, &user_id, &project_id, &asset_id)?;
    let mut paths = fs::read_dir(directory).map_err(|error| error.to_string())?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("chunk"))
        .collect::<Vec<_>>();
    paths.sort();
    let mut output = Vec::new();
    for path in paths {
        output.extend(fs::read(path).map_err(|error| error.to_string())?);
    }
    Ok(output)
}

#[tauri::command]
fn delete_asset(
    app: AppHandle,
    user_id: String,
    project_id: String,
    asset_id: String,
) -> Result<(), String> {
    let directory = asset_directory(&app, &user_id, &project_id, &asset_id)?;
    if directory.exists() {
        fs::remove_dir_all(directory).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn local_storage_usage(app: AppHandle, user_id: String) -> Result<u64, String> {
    let root = app.path().app_data_dir().map_err(|error| error.to_string())?
        .join("users")
        .join(safe_component(&user_id)?);
    Ok(directory_size(&root))
}

#[tauri::command]
fn save_export_file(suggested_name: String, bytes: Vec<u8>) -> Result<Option<String>, String> {
    let file_name = Path::new(&suggested_name)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("dongni-export.png");
    let Some(path) = rfd::FileDialog::new().set_file_name(file_name).save_file() else {
        return Ok(None);
    };
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![write_asset_chunk, read_asset_chunks, delete_asset, local_storage_usage, save_export_file])
        .run(tauri::generate_context!())
        .expect("error while running Dongni Market Studio");
}
