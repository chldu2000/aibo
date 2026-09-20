//! Clipboard images are immutable host-owned attachments, never workspace files.
use crate::{ContextAttachment, CoreError};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::{io::Write, path::Path};

const MAX_IMAGE: usize = 10 * 1024 * 1024;
const MAX_TOTAL: usize = 20 * 1024 * 1024;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ImageInput {
    media_type: String,
    data: String,
}
fn invalid(message: impl Into<String>) -> CoreError {
    CoreError::InvalidWorkspacePath(message.into())
}
fn extension(mime: &str, bytes: &[u8]) -> Result<&'static str, CoreError> {
    match mime {
        "image/png" if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => Ok("png"),
        "image/jpeg" if bytes.starts_with(&[0xff, 0xd8, 0xff]) => Ok("jpg"),
        "image/gif" if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") => Ok("gif"),
        "image/webp" if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") => {
            Ok("webp")
        }
        _ => Err(invalid("图片格式无效；支持 PNG、JPEG、WebP 和 GIF。")),
    }
}
pub(crate) async fn register(
    db: &SqlitePool,
    data_dir: &Path,
    session_id: &str,
    images: Vec<ImageInput>,
) -> Result<Vec<ContextAttachment>, CoreError> {
    let session = crate::session_by_id(db, session_id).await?;
    if session.archived {
        return Err(invalid("已归档会话不能添加图片。"));
    }
    if images.is_empty() || images.len() > 8 {
        return Err(invalid("一次最多粘贴 8 张图片。"));
    }
    let mut total = 0;
    let mut decoded = Vec::new();
    for image in images {
        if image.data.len() > (MAX_IMAGE + 2) / 3 * 4 {
            return Err(invalid("单张图片不能超过 10 MiB。"));
        }
        let bytes = STANDARD
            .decode(&image.data)
            .map_err(|_| invalid("无效的图片编码。"))?;
        total += bytes.len();
        if bytes.len() > MAX_IMAGE || total > MAX_TOTAL {
            return Err(invalid("粘贴图片超过大小上限。"));
        }
        let suffix = extension(&image.media_type, &bytes)?;
        decoded.push((image.media_type, bytes, suffix));
    }
    let directory = data_dir.join("clipboard-images");
    std::fs::create_dir_all(&directory).map_err(|e| invalid(e.to_string()))?;
    let directory = std::fs::canonicalize(directory).map_err(|e| invalid(e.to_string()))?;
    let mut created = vec![];
    let result: Result<Vec<ContextAttachment>, CoreError> = async {
        let mut tx = db.begin().await?;
        let archived: bool = sqlx::query_scalar("SELECT archived FROM sessions WHERE id=?").bind(session_id).fetch_one(&mut *tx).await?;
        if archived { return Err(invalid("已归档会话不能添加图片。")); }
        let mut attachments = vec![];
        for (mime, bytes, suffix) in decoded {
            let id = ulid::Ulid::new().to_string();
            let name = format!("clipboard-{id}.{suffix}");
            let path = directory.join(&name);
            let mut options = std::fs::OpenOptions::new(); options.write(true).create_new(true);
            #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
            let mut file = options.open(&path).map_err(|e| invalid(e.to_string()))?;
            created.push(path.clone());
            file.write_all(&bytes).map_err(|e| invalid(e.to_string()))?;
            let hash = format!("sha256:{:x}", Sha256::digest(&bytes));
            let inline = serde_json::json!({"schema":"aibo.clipboard-image/v1","path":path}).to_string();
            let now = crate::now_iso();
            sqlx::query("INSERT INTO attachments(id,workspace_id,session_id,path,content_hash,size,media_type,source,send_strategy,created_at,inline_context) VALUES(?,?,?,?,?,?,?,'manual','inline',?,?)")
                .bind(&id).bind(&session.workspace_id).bind(session_id).bind(&name).bind(&hash).bind(bytes.len() as i64).bind(&mime).bind(&now).bind(&inline).execute(&mut *tx).await?;
            attachments.push(ContextAttachment { schema:"aibo.context-attachment/v1".into(), id, workspace_id:session.workspace_id.clone(), session_id:session_id.into(), turn_id:None, path:name, content_hash:Some(hash), size:Some(bytes.len() as i64), media_type:mime, source:"manual".into(), send_strategy:"inline".into(), inline_context:Some(inline), created_at:now });
        }
        tx.commit().await?;
        Ok(attachments)
    }.await;
    if result.is_err() {
        for path in created {
            let _ = std::fs::remove_file(path);
        }
    }
    result
}
/// Only persisted host records are expanded into native image inputs. Renderer
/// payloads never get to supply paths to a provider.
pub(crate) fn turn_attachment(
    row: &sqlx::sqlite::SqliteRow,
    capabilities: &[String],
) -> Result<serde_json::Value, String> {
    let id: String = row.get("id");
    let mime: String = row.get("media_type");
    if !mime.starts_with("image/") {
        return Ok(serde_json::json!({"attachmentId":id}));
    }
    if !capabilities.iter().any(|cap| cap == "image.input") {
        return Err("当前 Agent 不支持图片输入。".into());
    }
    let inline: Option<String> = row.get("inline_context");
    let stored: serde_json::Value = serde_json::from_str(
        inline
            .as_deref()
            .ok_or("图片尚未导入，请从剪贴板重新粘贴。")?,
    )
    .map_err(|_| "图片附件元数据无效。")?;
    if stored["schema"] != "aibo.clipboard-image/v1" {
        return Err("图片附件元数据无效。".into());
    }
    let path = stored["path"].as_str().ok_or("图片附件路径缺失。")?;
    let metadata = std::fs::symlink_metadata(path).map_err(|_| "图片附件已丢失，请重新粘贴。")?;
    if !metadata.is_file() || metadata.len() > MAX_IMAGE as u64 {
        return Err("图片附件无效或过大。".into());
    }
    let bytes = std::fs::read(path).map_err(|_| "无法读取图片附件。")?;
    let hash: Option<String> = row.get("content_hash");
    if hash.as_deref() != Some(format!("sha256:{:x}", Sha256::digest(&bytes)).as_str()) {
        return Err("图片附件已变化，请重新粘贴。".into());
    }
    extension(&mime, &bytes).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"attachmentId":id,"type":"image","path":path,"mimeType":mime}))
}

/// Deleting a draft attachment releases its owned file; never delete paths
/// outside the host image directory or follow a replaced symbolic link.
pub(crate) fn remove_file(data_dir: &Path, context: &str) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(context) else {
        return;
    };
    if value["schema"] != "aibo.clipboard-image/v1" {
        return;
    }
    let Some(path) = value["path"].as_str().map(Path::new) else {
        return;
    };
    let Ok(root) = std::fs::canonicalize(data_dir.join("clipboard-images")) else {
        return;
    };
    if path.parent() == Some(root.as_path())
        && std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_file())
    {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=";
    fn image() -> ImageInput {
        ImageInput {
            media_type: "image/png".into(),
            data: PNG.into(),
        }
    }
    #[tokio::test]
    async fn clipboard_images_persist_outside_workspace_and_resolve_only_validated_images() {
        let root = std::env::temp_dir().join(format!("aibo-paste-{}", ulid::Ulid::new()));
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let db = crate::open_database(&root.join("host.db")).await.unwrap();
        sqlx::query("INSERT INTO workspaces(id,path,label,trusted,created_at,updated_at) VALUES('w',?,'test',0,'now','now')").bind(workspace.to_string_lossy().as_ref()).execute(&db).await.unwrap();
        sqlx::query("INSERT INTO sessions(id,workspace_id,agent,label,state,archived,created_at,updated_at) VALUES('s','w','plugin','test','idle',0,'now','now')").execute(&db).await.unwrap();
        let attachments = register(&db, &root.join("data"), "s", vec![image(), image()])
            .await
            .unwrap();
        assert_eq!(attachments.len(), 2);
        assert_ne!(attachments[0].id, attachments[1].id);
        assert_eq!(std::fs::read_dir(&workspace).unwrap().count(), 0);
        let rows = sqlx::query("SELECT id,media_type,inline_context,content_hash FROM attachments WHERE session_id='s' ORDER BY id").fetch_all(&db).await.unwrap();
        assert!(turn_attachment(&rows[0], &[]).is_err());
        let input = turn_attachment(&rows[0], &["image.input".into()]).unwrap();
        assert_eq!(input["type"], "image");
        assert_eq!(input["mimeType"], "image/png");
        assert_eq!(
            std::fs::read(input["path"].as_str().unwrap()).unwrap(),
            STANDARD.decode(PNG).unwrap()
        );
        std::fs::write(input["path"].as_str().unwrap(), b"changed").unwrap();
        assert!(turn_attachment(&rows[0], &["image.input".into()]).is_err());
        let bad = ImageInput {
            media_type: "image/png".into(),
            data: STANDARD.encode(b"not an image"),
        };
        assert!(register(&db, &root.join("data"), "s", vec![image(), bad])
            .await
            .is_err());
        assert_eq!(
            std::fs::read_dir(root.join("data/clipboard-images"))
                .unwrap()
                .count(),
            2
        );
        assert!(register(&db, &root, "missing", vec![image()])
            .await
            .is_err());
        sqlx::query("UPDATE sessions SET archived=1 WHERE id='s'")
            .execute(&db)
            .await
            .unwrap();
        assert!(register(&db, &root, "s", vec![image()]).await.is_err());
        db.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}
