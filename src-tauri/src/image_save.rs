//! Save targets come exclusively from the native dialog, never from renderer paths.
use std::{io::Write, path::{Path, PathBuf}};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use crate::{AppState, ui_i18n::{self, HostMessage}};

fn initial_directory(preferences: &Path, fallback: Option<PathBuf>) -> Option<PathBuf> {
    std::fs::read(preferences).ok()
        .and_then(|bytes| serde_json::from_slice::<PathBuf>(&bytes).ok())
        .filter(|path| path.is_dir())
        .or_else(|| fallback.filter(|path| path.is_dir()))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| std::io::Error::other("Missing parent directory"))?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    file.write_all(bytes)?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|error| error.error)?;
    Ok(())
}

fn save_error(error: impl std::fmt::Display) -> HostMessage {
    HostMessage::new("native.image.saveError", serde_json::json!({"error":error.to_string()}))
}

#[tauri::command]
pub(crate) async fn save_session_attachment_image(window: tauri::WebviewWindow, state: State<'_, AppState>, session_id: String, attachment_id: String) -> Result<Option<String>, HostMessage> {
    let (name, _, _) = crate::clipboard_images::read_image(&state.db, &session_id, &attachment_id).await?;
    let preferences = state.data_dir.join("image-save-directory.json");
    let directory = initial_directory(&preferences, window.app_handle().path().download_dir().ok());
    let mut dialog = window.app_handle().dialog().file().set_parent(&window).set_file_name(&name)
        .set_title(ui_i18n::message(ui_i18n::window_locale(&window), "attachments.saveAs", &serde_json::json!({})));
    if let Some(directory) = directory { dialog = dialog.set_directory(directory); }
    let (send, receive) = tokio::sync::oneshot::channel();
    dialog.save_file(move |path| { let _ = send.send(path); });
    let Some(path) = receive.await.map_err(save_error)? else { return Ok(None); };
    let path = path.into_path().map_err(save_error)?;
    // A dialog may stay open while the attachment is removed or its source changes.
    let (_, _, bytes) = crate::clipboard_images::read_image(&state.db, &session_id, &attachment_id).await?;
    tauri::async_runtime::spawn_blocking(move || {
        write_atomic(&path, &bytes).map_err(save_error)?;
        if let Some(parent) = path.parent() {
            let remembered = serde_json::to_vec(parent).map_err(std::io::Error::other)
                .and_then(|bytes| write_atomic(&preferences, &bytes));
            if let Err(error) = remembered {
                tracing::warn!(%error, "Image saved, but could not remember save directory");
            }
        }
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(save_error)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_save_directory_survives_restart_and_falls_back_when_missing() {
        let root = tempfile::tempdir().unwrap();
        let prefs = root.path().join("preferences.json");
        let chosen = root.path().join("chosen");
        std::fs::create_dir(&chosen).unwrap();
        let fallback = Some(root.path().to_owned());
        assert_eq!(initial_directory(&prefs, fallback.clone()), fallback);
        write_atomic(&prefs, &serde_json::to_vec(&chosen).unwrap()).unwrap();
        assert_eq!(initial_directory(&prefs, fallback.clone()), Some(chosen.clone()));
        std::fs::remove_dir(chosen).unwrap();
        assert_eq!(initial_directory(&prefs, fallback.clone()), fallback);
    }

    #[test]
    fn image_save_replaces_selected_file_and_preserves_it_on_failure() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("image.png");
        std::fs::write(&path, b"old").unwrap();
        write_atomic(&path, b"new image").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new image");
        assert!(write_atomic(&path.join("invalid"), b"bad").is_err());
        assert_eq!(std::fs::read(path).unwrap(), b"new image");
    }
}
