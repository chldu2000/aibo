-- Old turns deliberately have no row: absence means unknown, never not_sent.
CREATE TABLE turn_delivery (
    turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK(state IN ('not_sent','possibly_sent','responded'))
);
