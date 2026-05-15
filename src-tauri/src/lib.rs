use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode},
    Connection, Row, SqliteConnection,
};
use std::{path::PathBuf, str::FromStr};
use tauri::{AppHandle, Manager};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateWorkspaceInput {
    id: String,
    name: String,
    owner_id: String,
    timestamp: i64,
    activity_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateEventInput {
    id: String,
    resource_id: String,
    date: String,
    minutes: i64,
    goal: Option<String>,
    topics: Option<String>,
    notes: Option<String>,
    report: Option<String>,
    workspace_id: String,
    user_id: Option<String>,
    timestamp: i64,
    activity_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveResourceInput {
    id: String,
    new_parent_id: Option<String>,
    timestamp: i64,
    activity_id: String,
    user_id: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct WorkspaceRow {
    id: String,
    name: String,
    owner_id: String,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct MembershipRow {
    workspace_id: String,
    user_id: String,
    role: String,
    joined_at: i64,
    display_role: Option<String>,
    display_role_updated_at: Option<i64>,
    deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
struct ResourceRow {
    id: String,
    workspace_id: String,
    parent_id: Option<String>,
    name: String,
    r#type: String,
    color: Option<String>,
    path: String,
    cached_minutes: i64,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct EventRow {
    id: String,
    workspace_id: String,
    resource_id: String,
    date: String,
    minutes: i64,
    goal: Option<String>,
    topics: Option<String>,
    notes: Option<String>,
    report: Option<String>,
    user_id: Option<String>,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
}

#[derive(Debug, Serialize)]
struct ActivityRow {
    id: String,
    workspace_id: String,
    user_id: Option<String>,
    action: String,
    entity_type: String,
    entity_id: Option<String>,
    entity_name: Option<String>,
    summary: String,
    metadata: Option<String>,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
    Ok(app_data.join("tracker.db"))
}

async fn connect(app: &AppHandle) -> Result<SqliteConnection, String> {
    let options = SqliteConnectOptions::from_str(&db_path(app)?.to_string_lossy())
        .map_err(|e| e.to_string())?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal);
    let mut conn = SqliteConnection::connect_with(&options)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&mut conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

async fn is_local_workspace(
    executor: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    workspace_id: &str,
) -> Result<bool, String> {
    let row = sqlx::query("SELECT owner_id FROM workspaces WHERE id = ? LIMIT 1")
        .bind(workspace_id)
        .fetch_optional(&mut **executor)
        .await
        .map_err(|e| e.to_string())?;
    Ok(row
        .and_then(|r| r.try_get::<String, _>("owner_id").ok())
        .as_deref()
        == Some("local"))
}

async fn enqueue_payload<T: Serialize>(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    entity: &str,
    entity_id: &str,
    payload: &T,
    enqueued_at: i64,
    user_id: Option<&str>,
) -> Result<(), String> {
    let payload = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO sync_outbox (entity, entity_id, op, payload, enqueued_at, user_id)
         VALUES (?, ?, 'upsert', ?, ?, ?)",
    )
    .bind(entity)
    .bind(entity_id)
    .bind(payload)
    .bind(enqueued_at)
    .bind(user_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

async fn insert_activity(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    row: ActivityRow,
    outbox_user_id: Option<&str>,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO activity_log
           (id, workspace_id, user_id, action, entity_type, entity_id, entity_name, summary, metadata, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&row.id)
    .bind(&row.workspace_id)
    .bind(&row.user_id)
    .bind(&row.action)
    .bind(&row.entity_type)
    .bind(&row.entity_id)
    .bind(&row.entity_name)
    .bind(&row.summary)
    .bind(&row.metadata)
    .bind(row.created_at)
    .bind(row.updated_at)
    .bind(row.deleted_at)
    .execute(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;

    if !is_local_workspace(tx, &row.workspace_id).await? {
        enqueue_payload(
            tx,
            "activity_log",
            &row.id,
            &row,
            row.created_at,
            outbox_user_id,
        )
        .await?;
    }
    Ok(())
}

fn can_parent(parent_type: &str, child_type: &str) -> bool {
    match parent_type {
        "project" => matches!(child_type, "project" | "stage" | "task"),
        "stage" => matches!(child_type, "substage" | "task"),
        "substage" => child_type == "task",
        "task" => child_type == "task",
        _ => false,
    }
}

fn is_descendant_path(path: &str, possible_descendant_path: &str) -> bool {
    possible_descendant_path.starts_with(&format!("{}/", path))
}

async fn fetch_resource(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
) -> Result<Option<ResourceRow>, String> {
    sqlx::query_as::<_, ResourceRow>(
        "SELECT id, workspace_id, parent_id, name, type, color, path, cached_minutes, created_at, updated_at, deleted_at
         FROM resources WHERE id = ? LIMIT 1",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| e.to_string())
}

async fn recalc_ancestor_chain(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    path: &str,
) -> Result<(), String> {
    for id in path.split('/') {
        let target = fetch_resource(tx, id).await?;
        let Some(target) = target else { continue };
        let like_path = format!("{}/%", target.path);
        let total: i64 = sqlx::query(
            "SELECT COALESCE(SUM(e.minutes), 0) AS total
             FROM events e
             JOIN resources r ON r.id = e.resource_id
             WHERE (r.path = ? OR r.path LIKE ?)
               AND e.deleted_at IS NULL
               AND r.deleted_at IS NULL",
        )
        .bind(&target.path)
        .bind(like_path)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| e.to_string())?
        .try_get("total")
        .map_err(|e| e.to_string())?;

        sqlx::query("UPDATE resources SET cached_minutes = ? WHERE id = ?")
            .bind(total)
            .bind(id)
            .execute(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn create_workspace_tx(app: AppHandle, input: CreateWorkspaceInput) -> Result<(), String> {
    let mut conn = connect(&app).await?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO workspaces (id, name, owner_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&input.id)
    .bind(&input.name)
    .bind(&input.owner_id)
    .bind(input.timestamp)
    .bind(input.timestamp)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO workspace_memberships
           (workspace_id, user_id, role, joined_at, display_role, display_role_updated_at, deleted_at)
         VALUES (?, ?, 'owner', ?, NULL, NULL, NULL)",
    )
    .bind(&input.id)
    .bind(&input.owner_id)
    .bind(input.timestamp)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let workspace = WorkspaceRow {
        id: input.id.clone(),
        name: input.name.clone(),
        owner_id: input.owner_id.clone(),
        created_at: input.timestamp,
        updated_at: input.timestamp,
        deleted_at: None,
    };
    let membership = MembershipRow {
        workspace_id: input.id.clone(),
        user_id: input.owner_id.clone(),
        role: "owner".to_string(),
        joined_at: input.timestamp,
        display_role: None,
        display_role_updated_at: None,
        deleted_at: None,
    };

    enqueue_payload(
        &mut tx,
        "workspace",
        &input.id,
        &workspace,
        input.timestamp,
        Some(&input.owner_id),
    )
    .await?;
    enqueue_payload(
        &mut tx,
        "workspace_membership",
        &format!("{}:{}", input.id, input.owner_id),
        &membership,
        input.timestamp,
        Some(&input.owner_id),
    )
    .await?;

    insert_activity(
        &mut tx,
        ActivityRow {
            id: input.activity_id,
            workspace_id: input.id.clone(),
            user_id: Some(input.owner_id.clone()),
            action: "workspace.create".to_string(),
            entity_type: "workspace".to_string(),
            entity_id: Some(input.id.clone()),
            entity_name: Some(input.name.clone()),
            summary: format!("Utworzono workspace \"{}\"", input.name),
            metadata: Some(json!({ "owner_id": input.owner_id }).to_string()),
            created_at: input.timestamp,
            updated_at: input.timestamp,
            deleted_at: None,
        },
        Some(&input.owner_id),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_event_tx(app: AppHandle, input: CreateEventInput) -> Result<(), String> {
    let mut conn = connect(&app).await?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO events
           (id, resource_id, date, minutes, goal, topics, notes, report, workspace_id, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&input.id)
    .bind(&input.resource_id)
    .bind(&input.date)
    .bind(input.minutes)
    .bind(&input.goal)
    .bind(&input.topics)
    .bind(&input.notes)
    .bind(&input.report)
    .bind(&input.workspace_id)
    .bind(&input.user_id)
    .bind(input.timestamp)
    .bind(input.timestamp)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let event_resource = fetch_resource(&mut tx, &input.resource_id)
        .await?
        .ok_or("Resource not found")?;
    recalc_ancestor_chain(&mut tx, &event_resource.path).await?;

    let event = sqlx::query_as::<_, EventRow>(
        "SELECT id, workspace_id, resource_id, date, minutes, goal, topics, notes, report, user_id, created_at, updated_at, deleted_at
         FROM events WHERE id = ?",
    )
    .bind(&input.id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    if !is_local_workspace(&mut tx, &input.workspace_id).await? {
        enqueue_payload(
            &mut tx,
            "event",
            &input.id,
            &event,
            input.timestamp,
            input.user_id.as_deref(),
        )
        .await?;
    }

    insert_activity(
        &mut tx,
        ActivityRow {
            id: input.activity_id,
            workspace_id: input.workspace_id.clone(),
            user_id: input.user_id.clone(),
            action: "event.create".to_string(),
            entity_type: "event".to_string(),
            entity_id: Some(input.id.clone()),
            entity_name: Some(event_resource.name.clone()),
            summary: format!(
                "Zalogowano {} min do \"{}\"",
                input.minutes, event_resource.name
            ),
            metadata: Some(
                json!({
                    "resource_id": input.resource_id,
                    "date": input.date,
                    "minutes": input.minutes
                })
                .to_string(),
            ),
            created_at: input.timestamp,
            updated_at: input.timestamp,
            deleted_at: None,
        },
        input.user_id.as_deref(),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn move_resource_tx(app: AppHandle, input: MoveResourceInput) -> Result<(), String> {
    let mut conn = connect(&app).await?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;
    let node = fetch_resource(&mut tx, &input.id)
        .await?
        .ok_or("Resource not found")?;
    if node.parent_id == input.new_parent_id {
        tx.commit().await.map_err(|e| e.to_string())?;
        return Ok(());
    }

    let new_path = if let Some(parent_id) = &input.new_parent_id {
        let parent = fetch_resource(&mut tx, parent_id)
            .await?
            .ok_or("New parent not found")?;
        if is_descendant_path(&node.path, &parent.path) {
            return Err("Nie mozna przeniesc wezla pod jego wlasne dziecko".to_string());
        }
        if !can_parent(&parent.r#type, &node.r#type) {
            return Err(format!(
                "Typ {} nie moze byc dzieckiem {}",
                node.r#type, parent.r#type
            ));
        }
        format!("{}/{}", parent.path, input.id)
    } else {
        if node.r#type != "project" {
            return Err("Tylko projekt moze byc na najwyzszym poziomie".to_string());
        }
        input.id.clone()
    };

    let descendant_like = format!("{}/%", node.path);
    let descendants: Vec<ResourceRow> = sqlx::query_as::<_, ResourceRow>(
        "SELECT id, workspace_id, parent_id, name, type, color, path, cached_minutes, created_at, updated_at, deleted_at
         FROM resources WHERE path LIKE ?",
    )
    .bind(&descendant_like)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query("UPDATE resources SET parent_id = ?, path = ?, updated_at = ? WHERE id = ?")
        .bind(&input.new_parent_id)
        .bind(&new_path)
        .bind(input.timestamp)
        .bind(&input.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    for descendant in &descendants {
        let rewritten = format!("{}{}", new_path, &descendant.path[node.path.len()..]);
        sqlx::query("UPDATE resources SET path = ?, updated_at = ? WHERE id = ?")
            .bind(rewritten)
            .bind(input.timestamp)
            .bind(&descendant.id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    recalc_ancestor_chain(&mut tx, &node.path).await?;
    recalc_ancestor_chain(&mut tx, &new_path).await?;

    if !is_local_workspace(&mut tx, &node.workspace_id).await? {
        let mut affected_ids = vec![input.id.clone()];
        affected_ids.extend(descendants.iter().map(|d| d.id.clone()));
        for resource_id in affected_ids {
            let resource = fetch_resource(&mut tx, &resource_id)
                .await?
                .ok_or("Resource not found after move")?;
            enqueue_payload(
                &mut tx,
                "resource",
                &resource_id,
                &resource,
                input.timestamp,
                input.user_id.as_deref(),
            )
            .await?;
        }
    }

    let moved = fetch_resource(&mut tx, &input.id)
        .await?
        .ok_or("Resource not found after move")?;
    insert_activity(
        &mut tx,
        ActivityRow {
            id: input.activity_id,
            workspace_id: moved.workspace_id.clone(),
            user_id: input.user_id.clone(),
            action: "resource.move".to_string(),
            entity_type: "resource".to_string(),
            entity_id: Some(input.id.clone()),
            entity_name: Some(moved.name.clone()),
            summary: format!("Przeniesiono \"{}\"", moved.name),
            metadata: Some(
                json!({
                    "from_parent_id": node.parent_id,
                    "to_parent_id": input.new_parent_id
                })
                .to_string(),
            ),
            created_at: input.timestamp,
            updated_at: input.timestamp,
            deleted_at: None,
        },
        input.user_id.as_deref(),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            create_workspace_tx,
            create_event_tx,
            move_resource_tx
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
