-- Raw capability events remain durable audit history. Search keeps one summary
-- per invocation instead of indexing every lifecycle/stream envelope.
-- Drop the derived FTS first: deleting millions of documents through its old
-- triggers would create needless delete postings before rebuilding it anyway.
DROP TRIGGER search_capability_event_insert;
DROP TRIGGER search_capability_event_delete;
DROP TRIGGER search_documents_insert;
DROP TRIGGER search_documents_delete;
DROP TRIGGER search_documents_update;
DROP TABLE search_fts;

DELETE FROM search_documents WHERE source='capability-event';

CREATE VIRTUAL TABLE search_fts USING fts5(title,body,content='search_documents',content_rowid='rowid',tokenize='trigram');
INSERT INTO search_fts(search_fts) VALUES('rebuild');

CREATE TRIGGER search_documents_insert AFTER INSERT ON search_documents BEGIN
  INSERT INTO search_fts(rowid,title,body) VALUES(NEW.rowid,NEW.title,NEW.body);
END;
CREATE TRIGGER search_documents_delete AFTER DELETE ON search_documents BEGIN
  INSERT INTO search_fts(search_fts,rowid,title,body) VALUES('delete',OLD.rowid,OLD.title,OLD.body);
END;
CREATE TRIGGER search_documents_update AFTER UPDATE OF title,body ON search_documents
WHEN OLD.title IS NOT NEW.title OR OLD.body IS NOT NEW.body BEGIN
  INSERT INTO search_fts(search_fts,rowid,title,body) VALUES('delete',OLD.rowid,OLD.title,OLD.body);
  INSERT INTO search_fts(rowid,title,body) VALUES(NEW.rowid,NEW.title,NEW.body);
END;
