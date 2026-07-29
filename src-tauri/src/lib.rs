use std::{fs, path::{Path, PathBuf}, process::Command, thread, time::Duration};
use serde::Serialize;
use tauri::{AppHandle, Manager};

const RELEASE_API: &str = "https://api.github.com/repos/zhu18243351918-stack/dongni-market-studio/releases/latest";
const SUPPORTED_DROP_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "tif", "tiff", "psd", "psb", "json"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateResult {
    status: String,
    version: String,
}

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

#[tauri::command]
fn read_dropped_file(path: String) -> Result<tauri::ipc::Response, String> {
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err("拖入的文件不存在或无法读取".into());
    }
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if !SUPPORTED_DROP_EXTENSIONS.contains(&extension.as_str()) {
        return Err("暂不支持这个文件格式".into());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
async fn install_latest_update(app: AppHandle) -> Result<UpdateResult, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        return Err("当前仅支持 Windows 自动安装更新".into());
    }

    #[cfg(target_os = "windows")]
    {
        let client = reqwest::Client::builder()
            .user_agent("Dongni-Market-Studio-Updater")
            .build()
            .map_err(|error| error.to_string())?;
        let release: serde_json::Value = client
            .get(RELEASE_API)
            .send()
            .await
            .map_err(|error| format!("无法连接更新服务器：{error}"))?
            .error_for_status()
            .map_err(|error| format!("更新服务器返回错误：{error}"))?
            .json()
            .await
            .map_err(|error| format!("无法读取版本信息：{error}"))?;
        let tag = release.get("tag_name").and_then(|value| value.as_str()).ok_or("未找到最新版本号")?;
        let latest_version = tag.trim_start_matches('v').to_string();
        let current_version = app.package_info().version.to_string();
        if latest_version == current_version {
            return Ok(UpdateResult { status: "up-to-date".into(), version: latest_version });
        }
        let assets = release.get("assets").and_then(|value| value.as_array()).ok_or("最新版本没有可下载安装包")?;
        let setup = assets.iter().find(|asset| {
            asset.get("name").and_then(|value| value.as_str()) == Some("Dongni-Market-Studio-Setup-x64.exe")
        }).ok_or("未找到 Windows 安装版")?;
        let download_url = setup.get("browser_download_url").and_then(|value| value.as_str()).ok_or("安装包下载地址无效")?;
        let bytes = client
            .get(download_url)
            .send()
            .await
            .map_err(|error| format!("安装包下载失败：{error}"))?
            .error_for_status()
            .map_err(|error| format!("安装包下载失败：{error}"))?
            .bytes()
            .await
            .map_err(|error| format!("安装包读取失败：{error}"))?;
        let installer_path = std::env::temp_dir().join(format!("Dongni-Market-Studio-Setup-{latest_version}.exe"));
        fs::write(&installer_path, bytes).map_err(|error| format!("无法保存临时安装包：{error}"))?;
        Command::new(&installer_path)
            .arg("/UPDATE")
            .spawn()
            .map_err(|error| format!("无法启动安装程序：{error}"))?;
        let app_to_exit = app.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(1200));
            app_to_exit.exit(0);
        });
        Ok(UpdateResult { status: "installing".into(), version: latest_version })
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![write_asset_chunk, read_asset_chunks, delete_asset, local_storage_usage, save_export_file, read_dropped_file, install_latest_update])
        .run(tauri::generate_context!())
        .expect("error while running Dongni Market Studio");
}
