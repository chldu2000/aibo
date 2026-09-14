//! Pure model metadata projection; no provider process or execution state.
use crate::SessionReasoningOption;
use serde_json::Value;
const THINKING_LEVELS: [&str; 7] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

pub(crate) fn reasoning_options(model: &Value) -> Vec<SessionReasoningOption> {
    let reasoning = model
        .get("reasoning")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let thinking_level_map = model.get("thinkingLevelMap");
    THINKING_LEVELS
        .iter()
        .filter(|level| {
            if !reasoning {
                return **level == "off";
            }
            let mapped = thinking_level_map.and_then(|map| map.get(*level));
            if mapped.is_some_and(Value::is_null) {
                return false;
            }
            if **level == "xhigh" || **level == "max" {
                return mapped.is_some();
            }
            true
        })
        .map(|level| SessionReasoningOption {
            id: (*level).to_owned(),
            label: (*level).to_owned(),
            description: None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn model_metadata_controls_available_reasoning_levels() {
        let levels = reasoning_options(&json!({"reasoning":true,"thinkingLevelMap":{"minimal":"low","xhigh":"xhigh","max":null}}));
        assert_eq!(levels.into_iter().map(|option|option.id).collect::<Vec<_>>(), ["off","minimal","low","medium","high","xhigh"]);
        assert_eq!(reasoning_options(&json!({"reasoning":false})).into_iter().map(|option|option.id).collect::<Vec<_>>(), ["off"]);
    }
}
