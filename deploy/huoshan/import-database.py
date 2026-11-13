"""Import a D1 snapshot once, only while the application is stopped."""
import json
import sqlite3
import sys
from pathlib import Path

state, dump = map(Path, sys.argv[1:])
paths = [p for p in state.glob("d1/**/*.sqlite") if p.name != "metadata.sqlite"]
if len(paths) != 1:
    raise SystemExit(f"Expected one initialized database, found {len(paths)}")
db = sqlite3.connect(paths[0])
if db.execute("SELECT name FROM sqlite_master WHERE name='shops'").fetchone():
    raise SystemExit("Refusing to overwrite existing application data")
db.executescript("BEGIN;\n" + dump.read_text() + "\nCOMMIT;")
assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert not db.execute("PRAGMA foreign_key_check").fetchall()
tables = ["shops", "offers", "product_groups", "shop_daily_snapshots", "sync_runs", "d1_migrations"]
print(json.dumps({t: db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}))
db.close()
