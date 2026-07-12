CREATE TRIGGER findings_no_update
BEFORE UPDATE ON findings
BEGIN
  SELECT RAISE(ABORT, 'findings is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER findings_no_delete
BEFORE DELETE ON findings
WHEN (SELECT count(*) FROM pragma_table_list WHERE schema = 'temp' AND name = '_mara_purge') = 0
BEGIN
  SELECT RAISE(ABORT, 'findings is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER review_events_no_update
BEFORE UPDATE ON review_events
BEGIN
  SELECT RAISE(ABORT, 'review_events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER review_events_no_delete
BEFORE DELETE ON review_events
WHEN (SELECT count(*) FROM pragma_table_list WHERE schema = 'temp' AND name = '_mara_purge') = 0
BEGIN
  SELECT RAISE(ABORT, 'review_events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER dispatches_no_update
BEFORE UPDATE ON dispatches
BEGIN
  SELECT RAISE(ABORT, 'dispatches is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER dispatches_no_delete
BEFORE DELETE ON dispatches
WHEN (SELECT count(*) FROM pragma_table_list WHERE schema = 'temp' AND name = '_mara_purge') = 0
BEGIN
  SELECT RAISE(ABORT, 'dispatches is append-only');
END;
--> statement-breakpoint
CREATE VIEW v_current_findings AS
SELECT * FROM findings AS f
WHERE NOT EXISTS (
  SELECT 1 FROM findings AS s WHERE s.supersedes_id = f.id
);
