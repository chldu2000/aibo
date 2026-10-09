-- Mark only messages identified by persisted host control events and exact generated content.
-- Preserve text, identity, timestamps, existing metadata, and ambiguous/unknown history.
WITH control_events AS (
    SELECT *, CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END AS document
    FROM agent_events WHERE event_type = 'session.control_changed'
), candidates AS (
    SELECT m.id, json_object('schema', 'aibo.host-message/v1',
        'key', CASE WHEN json_extract(e.document, '$.payload.contextReset') = 1
                    THEN 'native.session.controlResetChanged' ELSE 'native.session.controlChanged' END,
        'params', json_object('label', json_extract(e.document, '$.payload.label'))) AS display
    FROM messages m JOIN control_events e ON e.session_id = m.session_id AND e.turn_id = m.turn_id
        AND m.id = e.turn_id || ':control:' || json_extract(e.document, '$.payload.requestId')
    WHERE m.role = 'system' AND m.localized_content_json IS NULL
        AND json_type(e.document, '$.payload.requestId') = 'text'
        AND json_type(e.document, '$.payload.label') = 'text'
        AND m.content = CASE WHEN json_extract(e.document, '$.payload.contextReset') = 1
            THEN '审批后清空上下文并切换到 ' ELSE '审批后切换到 ' END || json_extract(e.document, '$.payload.label')
)
UPDATE messages SET localized_content_json = (SELECT display FROM candidates WHERE candidates.id = messages.id)
WHERE id IN (SELECT id FROM candidates GROUP BY id HAVING COUNT(*) = 1);

WITH control_events AS (
    SELECT *, CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END AS document
    FROM agent_events WHERE event_type = 'session.control_changed'
)
UPDATE messages SET localized_content_json = json_object('schema', 'aibo.host-message/v1',
    'key', 'native.session.contextResetResumed', 'params', json_object())
WHERE role = 'system' AND turn_id IS NULL AND localized_content_json IS NULL
    AND content = '会话已恢复。之前批准计划时清空过上下文，恢复后 Agent 的上下文可能不包含清空之后的对话与操作；时间线保留了完整记录。'
    AND EXISTS (SELECT 1 FROM control_events e WHERE e.session_id = messages.session_id
        AND messages.id = e.session_id || ':context-reset-resumed:' || e.event_id
        AND json_extract(e.document, '$.payload.contextReset') = 1);
