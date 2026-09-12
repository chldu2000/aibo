//! Invocation-scoped streaming and controls share the Broker's pinned runtime.
//! Neither stream producers nor control callers can replace invocation authority.
use super::*;

#[derive(Clone)]
pub(super) struct Interaction {
    pub runtime: PluginRuntime,
    pub instance_id: String,
    pub invocation_id: String,
    pub scope: Scope,
    pub provider: Provider,
    pub permissions: Vec<String>,
    pub deadline: Instant,
    pub control_permit: Arc<Semaphore>,
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct Control {
    pub request_id: String,
    pub capability: String,
    pub version: String,
    pub input: Value,
}

impl Broker {
    /// Caller is supplied by the host, and request_id refers to its live invocation.
    pub(crate) async fn control(&self, caller: &str, control: CapabilityControl) -> Result<Response,Failure> {
        let key = (caller.to_owned(),control.request_id);
        let interaction = self.flights.lock().await.get(&key)
            .filter(|flight|!*flight.cancel.borrow())
            .and_then(|flight|flight.interaction.clone())
            .ok_or_else(||fail("provider_unavailable","No interactive invocation belongs to this caller"))?;
        let _permit = interaction.control_permit.clone().try_acquire_owned().map_err(|_|fail("busy","Another control is pending"))?;
        Self::identity(&interaction.scope,&control.capability,&control.version)?;
        self.workspace(&interaction.scope).await?;
        if control.input.to_string().len() > input_limit(&control.capability) { return Err(fail("invalid_input","Control input exceeds limit")); }
        let provider = self.offers(&interaction.scope,&control.capability,&control.version,Some(&interaction.provider.installation_id)).await?
            .into_iter().find(|provider|provider.contribution_id == interaction.provider.contribution_id)
            .ok_or_else(||fail("unsupported","The pinned provider does not offer this control"))?;
        if provider.digest != interaction.provider.digest || provider.operation["effect"] != "read"
            || provider.operation["permissions"].as_array().unwrap().iter().any(|permission|!interaction.permissions.iter().any(|allowed|permission == allowed)) {
            return Err(fail("permission_denied","Control exceeds the running invocation's authority"));
        }
        if !jsonschema::options().build(&provider.operation["inputSchema"]).map_err(database)?.is_valid(&control.input) {
            return Err(fail("invalid_input","Control input does not match its contract"));
        }
        let (_,_,digest) = plugin_registry::inspect(&provider.directory).map_err(|_|fail("provider_unavailable","Control package is unavailable"))?;
        if digest != provider.digest { return Err(fail("provider_unavailable","Control package changed")); }
        let live = self.flights.lock().await.get(&key).is_some_and(|flight|
            !*flight.cancel.borrow() && flight.interaction.as_ref().is_some_and(|current|current.invocation_id == interaction.invocation_id));
        if !live || interaction.runtime.was_stopped() || interaction.runtime.has_exited() || Instant::now() >= interaction.deadline {
            return Err(fail("cancelled","Interactive invocation has ended"));
        }
        let timeout = interaction.deadline.saturating_duration_since(Instant::now()).min(Duration::from_millis(provider.operation["timeoutMs"].as_u64().unwrap()));
        let raw = interaction.runtime.request("capability.control",json!({
            "instanceId":interaction.instance_id,"generationId":interaction.runtime.generation_id,
            "contributionId":provider.contribution_id,"invocationId":interaction.invocation_id,
            "capability":control.capability,"contractVersion":control.version,"operationId":provider.operation["id"],"input":control.input
        }),timeout).await.map_err(transport)?;
        if raw["invocationId"] != interaction.invocation_id || raw["generationId"] != interaction.runtime.generation_id
            || raw["output"].to_string().len() > MAX_OUTPUT || !raw.as_object().is_some_and(|value|value.len()==3 && value.contains_key("output"))
            || !jsonschema::options().build(&provider.operation["outputSchema"]).map_err(database)?.is_valid(&raw["output"]) {
            return Err(fail("invalid_output","Control returned an invalid result"));
        }
        Ok(Response {instance_id:interaction.instance_id,invocation_id:interaction.invocation_id,installation_id:provider.installation_id,generation_id:interaction.runtime.generation_id,output:raw["output"].clone()})
    }
}

pub(super) struct StreamCursor { sequence: u64, bytes: usize }
impl StreamCursor {
    pub fn new() -> Self { Self {sequence:0,bytes:0} }
    pub fn accept(&mut self, message: &Value, instance: &str, generation: &str, contribution: &str, invocation: &str) -> Result<Value,Failure> {
        if !crate::plugin_contract::contracts().capability_interactive.is_valid(message) || message["method"] != "capability.event" {
            return Err(fail("invalid_output","Invalid capability stream envelope"));
        }
        let p = &message["params"];
        let bytes = p["event"].to_string().len();
        if p["instanceId"] != instance || p["generationId"] != generation || p["contributionId"] != contribution || p["invocationId"] != invocation
            || p["sequence"].as_u64() != Some(self.sequence+1) || bytes > MAX_OUTPUT || self.bytes+bytes > 64*1024*1024 {
            return Err(fail("invalid_output","Stale, unordered or oversized capability stream"));
        }
        self.sequence += 1;
        self.bytes += bytes;
        Ok(p.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stream_cursor_rejects_stale_duplicate_and_out_of_order_events() {
        let event = json!({"jsonrpc":"2.0","method":"capability.event","params":{"instanceId":"instance","generationId":"generation","contributionId":"contribution","invocationId":"invocation","sequence":1,"event":{"text":"hello"}}});
        let mut cursor=StreamCursor::new();
        for (key,value) in [("instanceId",json!("other")),("generationId",json!("old")),("invocationId",json!("other")),("contributionId",json!("other")),("sequence",json!(2))] {
            let mut invalid=event.clone();invalid["params"][key]=value;
            assert!(cursor.accept(&invalid,"instance","generation","contribution","invocation").is_err());
        }
        assert!(cursor.accept(&event,"instance","generation","contribution","invocation").is_ok());
        assert!(cursor.accept(&event,"instance","generation","contribution","invocation").is_err());
        let mut next=event.clone();next["params"]["sequence"]=json!(2);
        assert!(cursor.accept(&next,"instance","generation","contribution","invocation").is_ok());
    }
}
