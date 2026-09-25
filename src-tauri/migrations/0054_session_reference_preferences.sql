CREATE TABLE session_reference_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    message_limit INTEGER CHECK (message_limit IS NULL OR message_limit BETWEEN 1 AND 10000)
);
INSERT INTO session_reference_preferences (id, message_limit) VALUES (1, 12);
