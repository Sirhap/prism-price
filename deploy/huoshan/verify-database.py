"""Print a deterministic row digest for every migrated application table."""
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

source = Path(sys.argv[1])
if source.suffix == '.sql':
    db = sqlite3.connect(':memory:')
    db.executescript(source.read_text())
else:
    db = sqlite3.connect(f'file:{source}?mode=ro', uri=True)
report = {}
for table in ['shops', 'offers', 'product_groups', 'shop_daily_snapshots', 'sync_runs', 'd1_migrations']:
    rows = db.execute(f'SELECT * FROM "{table}" ORDER BY 1, 2').fetchall()
    digest = hashlib.sha256(json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    report[table] = {'rows': len(rows), 'sha256': digest}
assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
assert not db.execute('PRAGMA foreign_key_check').fetchall()
print(json.dumps(report, indent=2, ensure_ascii=False))
db.close()
