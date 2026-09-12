//! Durable replacement choices. Selection never runs executable code; promotion
//! happens inside the already-authorized invocation, after runtime negotiation.
use super::*;
impl Broker {
    pub(super) async fn select_binding(&self, binding: &Binding) -> Result<(), Failure> {
        let (kind, id) = binding.scope.key();
        let mut tx = self.db.begin().await.map_err(database)?;
        // Acquire SQLite's write lock before inspecting the current selection.
        sqlx::query("DELETE FROM capability_binding_candidates WHERE scope_kind=? AND scope_id=? AND capability_id=? AND contract_version=?")
            .bind(kind).bind(id).bind(&binding.capability).bind(&binding.version).execute(&mut *tx).await.map_err(database)?;
        let current: Option<(String,String)> = sqlx::query_as("SELECT installation_id,contribution_id FROM capability_provider_bindings WHERE scope_kind=? AND scope_id=? AND capability_id=? AND contract_version=?")
            .bind(kind).bind(id).bind(&binding.capability).bind(&binding.version).fetch_optional(&mut *tx).await.map_err(database)?;
        if current.as_ref().is_some_and(|(installation, contribution)| installation != &binding.installation_id || contribution != &binding.contribution_id) {
            sqlx::query("INSERT INTO capability_binding_candidates(scope_kind,scope_id,capability_id,contract_version,candidate_id,installation_id,contribution_id) VALUES(?,?,?,?,?,?,?)")
                .bind(kind).bind(id).bind(&binding.capability).bind(&binding.version).bind(ulid::Ulid::new().to_string()).bind(&binding.installation_id).bind(&binding.contribution_id).execute(&mut *tx).await.map_err(database)?;
        } else {
            sqlx::query("INSERT INTO capability_provider_bindings(scope_kind,scope_id,capability_id,contract_version,installation_id,contribution_id,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(scope_kind,scope_id,capability_id,contract_version) DO UPDATE SET updated_at=excluded.updated_at")
                .bind(kind).bind(id).bind(&binding.capability).bind(&binding.version).bind(&binding.installation_id).bind(&binding.contribution_id).bind(crate::now_iso()).execute(&mut *tx).await.map_err(database)?;
        }
        tx.commit().await.map_err(database)
    }
    pub(super) async fn discard_candidate(&self, token: &str) -> Result<(), Failure> {
        sqlx::query("DELETE FROM capability_binding_candidates WHERE candidate_id=?").bind(token).execute(&self.db).await.map_err(database)?;
        Ok(())
    }
    pub(super) async fn promote_candidate(&self, token: &str) -> Result<(), Failure> {
        let mut tx = self.db.begin().await.map_err(database)?;
        let candidate: Option<(String,String,String,String,String,String)> = sqlx::query_as("DELETE FROM capability_binding_candidates WHERE candidate_id=? RETURNING scope_kind,scope_id,capability_id,contract_version,installation_id,contribution_id")
            .bind(token).fetch_optional(&mut *tx).await.map_err(database)?;
        let Some((kind,id,capability,version,installation,contribution)) = candidate else {
            return Err(fail("provider_unavailable", "Candidate selection changed during initialization; select the provider again"));
        };
        let changed = sqlx::query("UPDATE capability_provider_bindings SET installation_id=?,contribution_id=?,updated_at=? WHERE scope_kind=? AND scope_id=? AND capability_id=? AND contract_version=?")
            .bind(installation).bind(contribution).bind(crate::now_iso()).bind(kind).bind(id).bind(capability).bind(version).execute(&mut *tx).await.map_err(database)?;
        if changed.rows_affected() != 1 { return Err(fail("provider_unavailable", "Confirmed binding disappeared during initialization")); }
        tx.commit().await.map_err(database)
    }
}
