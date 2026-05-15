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
struct CreateResourceInput {
    id: String,
    parent_id: Option<String>,
    name: String,
    #[serde(rename = "type")]
    r#type: String,
    color: Option<String>,
    workspace_id: String,
    timestamp: i64,
    activity_id: String,
    actor_user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameResourceInput {
    id: String,
    name: String,
    timestamp: i64,
    activity_id: String,
    actor_user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetResourceColorInput {
    id: String,
    color: Option<String>,
    timestamp: i64,
    activity_id: String,
    actor_user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SoftDeleteSubtreeInput {
    id: String,
    timestamp: i64,
    activity_id: String,
    actor_user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiftChildrenAndDeleteInput {
    id: String,
    timestamp: i64,
    activity_id: String,
    actor_user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DetachChildrenAsProjectsInput {
    id: String,
    timestamp: i64,
    activity_id: String,
    actor_user_id: Option<String>,
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
struct UpdateEventInput {
    id: String,
    date: String,
    minutes: i64,
    goal: Option<String>,
    topics: Option<String>,
    notes: Option<String>,
    report: Option<String>,
    timestamp: i64,
    activity_id: String,
    actor_user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteEventInput {
    id: String,
    timestamp: i64,
    activity_id: String,
    actor_user_id: Option<String>,
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

#[derive(Debug, Serialize, sqlx::FromRow)]
struct AssignmentRow {
    id: String,
    resource_id: String,
    user_id: String,
    workspace_id: String,
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

fn resource_label(resource_type: &str) -> &str {
    match resource_type {
        "project" => "projekt",
        "stage" => "etap",
        "substage" => "podetap",
        "task" => "zadanie",
        _ => "zasob",
    }
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

async fn fetch_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
) -> Result<Option<EventRow>, String> {
    sqlx::query_as::<_, EventRow>(
        "SELECT id, workspace_id, resource_id, date, minutes, goal, topics, notes, report, user_id, created_at, updated_at, deleted_at
         FROM events WHERE id = ? LIMIT 1",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| e.to_string())
}

async fn fetch_assignment(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
) -> Result<Option<AssignmentRow>, String> {
    sqlx::query_as::<_, AssignmentRow>(
        "SELECT id, resource_id, user_id, workspace_id, created_at, updated_at, deleted_at
         FROM assignments WHERE id = ? LIMIT 1",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| e.to_string())
}

async fn fetch_direct_children(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    parent_id: &str,
) -> Result<Vec<ResourceRow>, String> {
    sqlx::query_as::<_, ResourceRow>(
        "SELECT id, workspace_id, parent_id, name, type, color, path, cached_minutes, created_at, updated_at, deleted_at
         FROM resources WHERE parent_id = ? AND deleted_at IS NULL",
    )
    .bind(parent_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| e.to_string())
}

async fn fetch_descendants(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    path: &str,
) -> Result<Vec<ResourceRow>, String> {
    let like_path = format!("{}/%", path);
    sqlx::query_as::<_, ResourceRow>(
        "SELECT id, workspace_id, parent_id, name, type, color, path, cached_minutes, created_at, updated_at, deleted_at
         FROM resources WHERE path LIKE ?",
    )
    .bind(like_path)
    .fetch_all(&mut **tx)
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
async fn create_resource_tx(app: AppHandle, input: CreateResourceInput) -> Result<(), String> {
    let mut conn = connect(&app).await?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;

    let path = if let Some(parent_id) = &input.parent_id {
        let parent = fetch_resource(&mut tx, parent_id)
            .await?
            .ok_or("Parent not found")?;
        format!("{}/{}", parent.path, input.id)
    } else {
        input.id.clone()
    };

    sqlx::query(
        "INSERT INTO resources
           (id, parent_id, name, type, color, path, cached_minutes, workspace_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
    )
    .bind(&input.id)
    .bind(&input.parent_id)
    .bind(&input.name)
    .bind(&input.r#type)
    .bind(&input.color)
    .bind(&path)
    .bind(&input.workspace_id)
    .bind(input.timestamp)
    .bind(input.timestamp)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    let resource = fetch_resource(&mut tx, &input.id)
        .await?
        .ok_or("Resource not found after create")?;
    if !is_local_workspace(&mut tx, &input.workspace_id).await? {
        enqueue_payload(
            &mut tx,
            "resource",
            &input.id,
            &resource,
            input.timestamp,
            input.actor_user_id.as_deref(),
        )
        .await?;
    }

    insert_activity(
        &mut tx,
        ActivityRow {
            id: input.activity_id,
            workspace_id: input.workspace_id.clone(),
            user_id: input.actor_user_id.clone(),
            action: "resource.create".to_string(),
            entity_type: "resource".to_string(),
            entity_id: Some(input.id.clone()),
            entity_name: Some(input.name.clone()),
            summary: format!(
                "Dodano {} \"{}\"",
                resource_label(&input.r#type),
                input.name
            ),
            metadata: Some(
                json!({
                    "type": input.r#type,
                    "parent_id": input.parent_id
                })
                .to_string(),
            ),
            created_at: input.timestamp,
            updated_at: input.timestamp,
            deleted_at: None,
        },
        input.actor_user_id.as_deref(),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn rename_resource_tx(app: AppHandle, input: RenameResourceInput) -> Result<(), String> {
    let mut conn = connect(&app).await?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;
    let previous = fetch_resource(&mut tx, &input.id)
        .await?
        .ok_or("Resource not found")?;

    sqlx::query("UPDATE resources SET name = ?, updated_at = ? WHERE id = ?")
        .bind(&input.name)
        .bind(input.timestamp)
        .bind(&input.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let updated = fetch_resource(&mut tx, &input.id)
        .await?
        .ok_or("Resource not found after rename")?;
    if !is_local_workspace(&mut tx, &updated.workspace_id).await? {
        enqueue_payload(
            &mut tx,
            "resource",
            &input.id,
            &updated,
            input.timestamp,
            input.actor_user_id.as_deref(),
        )
        .await?;
    }

    insert_activity(
        &mut tx,
        ActivityRow {
            id: input.activity_id,
            workspace_id: updated.workspace_id.clone(),
            user_id: input.actor_user_id.clone(),
            action: "resource.rename".to_string(),
            entity_type: "resource".to_string(),
            entity_id: Some(input.id.clone()),
            entity_name: Some(input.name.clone()),
            summary: format!(
                "Zmieniono nazwe \"{}\" na \"{}\"",
                previous.name, input.name
            ),
            metadata: Some(json!({ "from": previous.name, "to": input.name }).to_string()),
            created_at: input.timestamp,
            updated_at: input.timestamp,
            deleted_at: None,
        },
        input.actor_user_id.as_deref(),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_resource_color_tx(app: AppHandle, input: SetResourceColorInput) -> Result<(), String> {
    let mut conn = connect(&app).await?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;
    let previous = fetch_resource(&mut tx, &input.id)
        .await?
        .ok_or("Resource not found")?;

    sqlx::query("UPDATE resources SET color = ?, updated_at = ? WHERE id = ?")
        .bind(&input.color)
        .bind(input.timestamp)
        .bind(&input.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let updated = fetch_resource(&mut tx, &input.id)
        .await?
        .ok_or("Resource not found after color update")?;
    if !is_local_workspace(&mut tx, &updated.workspace_id).await? {
        enqueue_payload(
            &mut tx,
            "resource",
            &input.id,
            &updated,
            input.timestamp,
            input.actor_user_id.as_deref(),
        )
        .await?;
    }

    let summary = if input.color.is_some() {
        format!("Zmieniono kolor \"{}\"", updated.name)
    } else {
        format!("Wyczyszczono kolor \"{}\"", updated.name)
    };
    insert_activity(
        &mut tx,
        ActivityRow {
            id: input.activity_id,
            workspace_id: updated.workspace_id.clone(),
            user_id: input.actor_user_id.clone(),
            action: "resource.color".to_string(),
            entity_type: "resource".to_string(),
            entity_id: Some(input.id.clone()),
            entity_name: Some(updated.name.clone()),
            summary,
            metadata: Some(json!({ "from": previous.color, "to": input.color }).to_string()),
            created_at: input.timestamp,
            updated_at: input.timestamp,
            deleted_at: None,
        },
        input.actor_user_id.as_deref(),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn soft_delete_subtree_tx(
    app: AppHandle,
    input: SoftDeleteSubtreeInput,
) -> Result<(), String> {
    let mut conn = connect(&app).await?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;
    let root = fetch_resource(&mut tx, &input.id)
        .await?
        .ok_or("Resource not found")?;
    let path_like = format!("{}/%", root.path);

    let resource_ids: Vec<String> =
        sqlx::query("SELECT id FROM resources WHERE path = ? OR path LIKE ?")
            .bind(&root.path)
            .bind(&path_like)
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|row| row.try_get::<String, _>("id").map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?;

    let event_ids: Vec<String> = sqlx::query(
        "SELECT e.id
           FROM events e
           JOIN resources r ON r.id = e.resource_id
          WHERE r.path = ? OR r.path LIKE ?",
    )
    .bind(&root.path)
    .bind(&path_like)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .map(|row| row.try_get::<String, _>("id").map_err(|e| e.to_string()))
    .collect::<Result<Vec<_>, _>>()?;

    let assignment_ids: Vec<String> = sqlx::query(
        "SELECT a.id
           FROM assignments a
           JOIN resources r ON r.id = a.resource_id
          WHERE (r.path = ? OR r.path LIKE ?)
            AND a.deleted_at IS NULL",
    )
    .bind(&root.path)
    .bind(&path_like)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .map(|row| row.try_get::<String, _>("id").map_err(|e| e.to_string()))
    .collect::<Result<Vec<_>, _>>()?;

    sqlx::query(
        "UPDATE resources SET deleted_at = ?, updated_at = ? WHERE path = ? OR path LIKE ?",
    )
    .bind(input.timestamp)
    .bind(input.timestamp)
    .bind(&root.path)
    .bind(&path_like)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE events
            SET deleted_at = ?, updated_at = ?
          WHERE resource_id IN (
            SELECT id FROM resources WHERE path = ? OR path LIKE ?
          )",
    )
    .bind(input.timestamp)
    .bind(input.timestamp)
    .bind(&root.path)
    .bind(&path_like)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE assignments
            SET deleted_at = ?, updated_at = ?
          WHERE resource_id IN (
            SELECT id FROM resources WHERE path = ? OR path LIKE ?
          )
            AND deleted_at IS NULL",
    )
    .bind(input.timestamp)
    .bind(input.timestamp)
    .bind(&root.path)
    .bind(&path_like)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    if !is_local_workspace(&mut tx, &root.workspace_id).await? {
        for resource_id in &resource_ids {
            if let Some(resource) = fetch_resource(&mut tx, resource_id).await? {
                enqueue_payload(
                    &mut tx,
                    "resource",
                    resource_id,
                    &resource,
                    input.timestamp,
                    input.actor_user_id.as_deref(),
                )
                .await?;
            }
        }
        for event_id in &event_ids {
            if let Some(event) = fetch_event(&mut tx, event_id).await? {
                enqueue_payload(
                    &mut tx,
                    "event",
                    event_id,
                    &event,
                    input.timestamp,
                    input.actor_user_id.as_deref(),
                )
                .await?;
            }
        }
        for assignment_id in &assignment_ids {
            if let Some(assignment) = fetch_assignment(&mut tx, assignment_id).await? {
                enqueue_payload(
                    &mut tx,
                    "assignment",
                    assignment_id,
                    &assignment,
                    input.timestamp,
                    input.actor_user_id.as_deref(),
                )
                .await?;
            }
        }
    }

    insert_activity(
        &mut tx,
        ActivityRow {
            id: input.activity_id,
            workspace_id: root.workspace_id.clone(),
            user_id: input.actor_user_id.clone(),
            action: "resource.delete_subtree".to_string(),
            entity_type: "resource".to_string(),
            entity_id: Some(input.id.clone()),
            entity_name: Some(root.name.clone()),
            summary: format!("Usunieto \"{}\" i jego zawartosc", root.name),
            metadata: Some(
                json!({
                    "resource_count": resource_ids.len(),
                    "event_count": event_ids.len(),
                    "assignment_count": assignment_ids.len()
                })
                .to_string(),
            ),
            created_at: input.timestamp,
            updated_at: input.timestamp,
            deleted_at: None,
        },
        input.actor_user_id.as_deref(),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn lift_children_and_delete_tx(
    app: AppHandle,
    input: LiftChildrenAndDeleteInput,
) -> Result<(), String> {
    let mut conn = connect(&app).await?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;
    let node = match fetch_resource(&mut tx, &input.id).await? {
        Some(node) => node,
        None => {
            tx.commit().await.map_err(|e| e.to_string())?;
            return Ok(());
        }
    };

    let children = fetch_direct_children(&mut tx, &input.id).await?;
    let new_parent_path_prefix = if let Some(parent_id) = &node.parent_id {
        let parent = fetch_resource(&mut tx, parent_id)
            .await?
            .ok_or("Parent not found")?;
        format!("{}/", parent.path)
    } else {
        String::new()
    };

    let mut affected_ids: Vec<String> = Vec::new();
    for child in &children {
        let new_path = format!("{}{}", new_parent_path_prefix, child.id);
        let descendants = fetch_descendants(&mut tx, &child.path).await?;

        sqlx::query("UPDATE resources SET parent_id = ?, path = ?, updated_at = ? WHERE id = ?")
            .bind(&node.parent_id)
            .bind(&new_path)
            .bind(input.timestamp)
            .bind(&child.id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

        for descendant in &descendants {
            let rewritten = format!("{}{}", new_path, &descendant.path[child.path.len()..]);
            sqlx::query("UPDATE resources SET path = ?, updated_at = ? WHERE id = ?")
                .bind(rewritten)
                .bind(input.timestamp)
                .bind(&descendant.id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }

        affected_ids.push(child.id.clone());
        affected_ids.extend(descendants.iter().map(|d| d.id.clone()));
    }

    sqlx::query("UPDATE resources SET deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(input.timestamp)
        .bind(input.timestamp)
        .bind(&input.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    affected_ids.push(input.id.clone());

    if !is_local_workspace(&mut tx, &node.workspace_id).await? {
        for resource_id in &affected_ids {
            if let Some(resource) = fetch_resource(&mut tx, resource_id).await? {
                enqueue_payload(
                    &mut tx,
                    "resource",
                    resource_id,
                    &resource,
                    input.timestamp,
                    input.actor_user_id.as_deref(),
                )
                .await?;
            }
        }
    }

    insert_activity(
        &mut tx,
        ActivityRow {
            id: input.activity_id,
            workspace_id: node.workspace_id.clone(),
            user_id: input.actor_user_id.clone(),
            action: "resource.lift_delete".to_string(),
            entity_type: "resource".to_string(),
            entity_id: Some(input.id.clone()),
            entity_name: Some(node.name.clone()),
            summary: format!("Usunieto \"{}\" i podniesiono jego dzieci", node.name),
            metadata: Some(json!({ "children_count": children.len() }).to_string()),
            created_at: input.timestamp,
            updated_at: input.timestamp,
            deleted_at: None,
        },
        input.actor_user_id.as_deref(),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn detach_children_as_projects_tx(
    app: AppHandle,
    input: DetachChildrenAsProjectsInput,
) -> Result<(), String> {
    let mut conn = connect(&app).await?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;
    let node = match fetch_resource(&mut tx, &input.id).await? {
        Some(node) => node,
        None => {
            tx.commit().await.map_err(|e| e.to_string())?;
            return Ok(());
        }
    };

    let children = fetch_direct_children(&mut tx, &input.id).await?;
    let mut affected_ids: Vec<String> = Vec::new();

    for child in &children {
        let descendants = fetch_descendants(&mut tx, &child.path).await?;

        sqlx::query(
            "UPDATE resources SET parent_id = NULL, type = 'project', path = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&child.id)
        .bind(input.timestamp)
        .bind(&child.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        for descendant in &descendants {
            let rewritten = format!("{}{}", child.id, &descendant.path[child.path.len()..]);
            sqlx::query("UPDATE resources SET path = ?, updated_at = ? WHERE id = ?")
                .bind(rewritten)
                .bind(input.timestamp)
                .bind(&descendant.id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }

        affected_ids.push(child.id.clone());
        affected_ids.extend(descendants.iter().map(|d| d.id.clone()));
    }

    sqlx::query("UPDATE resources SET deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(input.timestamp)
        .bind(input.timestamp)
        .bind(&input.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    affected_ids.push(input.id.clone());

    if !is_local_workspace(&mut tx, &node.workspace_id).await? {
        for resource_id in &affected_ids {
            if let Some(resource) = fetch_resource(&mut tx, resource_id).await? {
                enqueue_payload(
                    &mut tx,
                    "resource",
                    resource_id,
                    &resource,
                    input.timestamp,
                    input.actor_user_id.as_deref(),
                )
                .await?;
            }
        }
    }

    insert_activity(
        &mut tx,
        ActivityRow {
            id: input.activity_id,
            workspace_id: node.workspace_id.clone(),
            user_id: input.actor_user_id.clone(),
            action: "resource.detach_delete".to_string(),
            entity_type: "resource".to_string(),
            entity_id: Some(input.id.clone()),
            entity_name: Some(node.name.clone()),
            summary: format!("Usunieto \"{}\" i zamieniono dzieci na projekty", node.name),
            metadata: Some(json!({ "children_count": children.len() }).to_string()),
            created_at: input.timestamp,
            updated_at: input.timestamp,
            deleted_at: None,
        },
        input.actor_user_id.as_deref(),
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
async fn update_event_tx(app: AppHandle, input: UpdateEventInput) -> Result<(), String> {
    let mut conn = connect(&app).await?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;
    let previous = fetch_event(&mut tx, &input.id)
        .await?
        .ok_or("Event not found")?;

    sqlx::query(
        "UPDATE events
            SET date = ?, minutes = ?, goal = ?, topics = ?, notes = ?, report = ?, updated_at = ?
          WHERE id = ?",
    )
    .bind(&input.date)
    .bind(input.minutes)
    .bind(&input.goal)
    .bind(&input.topics)
    .bind(&input.notes)
    .bind(&input.report)
    .bind(input.timestamp)
    .bind(&input.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    if previous.minutes != input.minutes || previous.date != input.date {
        let resource = fetch_resource(&mut tx, &previous.resource_id)
            .await?
            .ok_or("Resource not found")?;
        recalc_ancestor_chain(&mut tx, &resource.path).await?;
    }

    let updated = fetch_event(&mut tx, &input.id)
        .await?
        .ok_or("Event not found after update")?;
    if !is_local_workspace(&mut tx, &updated.workspace_id).await? {
        enqueue_payload(
            &mut tx,
            "event",
            &input.id,
            &updated,
            input.timestamp,
            input.actor_user_id.as_deref(),
        )
        .await?;
    }

    let resource = fetch_resource(&mut tx, &updated.resource_id)
        .await?
        .ok_or("Resource not found")?;
    insert_activity(
        &mut tx,
        ActivityRow {
            id: input.activity_id,
            workspace_id: updated.workspace_id.clone(),
            user_id: input.actor_user_id.clone(),
            action: "event.update".to_string(),
            entity_type: "event".to_string(),
            entity_id: Some(input.id.clone()),
            entity_name: Some(resource.name.clone()),
            summary: format!("Edytowano wpis czasu w \"{}\"", resource.name),
            metadata: Some(
                json!({
                    "resource_id": updated.resource_id,
                    "before": { "date": previous.date, "minutes": previous.minutes },
                    "after": { "date": updated.date, "minutes": updated.minutes }
                })
                .to_string(),
            ),
            created_at: input.timestamp,
            updated_at: input.timestamp,
            deleted_at: None,
        },
        input.actor_user_id.as_deref(),
    )
    .await?;

    tx.commit().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_event_tx(app: AppHandle, input: DeleteEventInput) -> Result<(), String> {
    let mut conn = connect(&app).await?;
    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;
    let previous = fetch_event(&mut tx, &input.id)
        .await?
        .ok_or("Event not found")?;

    sqlx::query("UPDATE events SET deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(input.timestamp)
        .bind(input.timestamp)
        .bind(&input.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let resource = fetch_resource(&mut tx, &previous.resource_id)
        .await?
        .ok_or("Resource not found")?;
    recalc_ancestor_chain(&mut tx, &resource.path).await?;

    let deleted = fetch_event(&mut tx, &input.id)
        .await?
        .ok_or("Event not found after delete")?;
    if !is_local_workspace(&mut tx, &deleted.workspace_id).await? {
        enqueue_payload(
            &mut tx,
            "event",
            &input.id,
            &deleted,
            input.timestamp,
            input.actor_user_id.as_deref(),
        )
        .await?;
    }

    insert_activity(
        &mut tx,
        ActivityRow {
            id: input.activity_id,
            workspace_id: previous.workspace_id.clone(),
            user_id: input.actor_user_id.clone(),
            action: "event.delete".to_string(),
            entity_type: "event".to_string(),
            entity_id: Some(input.id.clone()),
            entity_name: Some(resource.name.clone()),
            summary: format!(
                "Usunieto wpis {} min z \"{}\"",
                previous.minutes, resource.name
            ),
            metadata: Some(
                json!({
                    "resource_id": previous.resource_id,
                    "date": previous.date,
                    "minutes": previous.minutes
                })
                .to_string(),
            ),
            created_at: input.timestamp,
            updated_at: input.timestamp,
            deleted_at: None,
        },
        input.actor_user_id.as_deref(),
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
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            create_workspace_tx,
            create_resource_tx,
            rename_resource_tx,
            set_resource_color_tx,
            soft_delete_subtree_tx,
            lift_children_and_delete_tx,
            detach_children_as_projects_tx,
            create_event_tx,
            update_event_tx,
            delete_event_tx,
            move_resource_tx
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
