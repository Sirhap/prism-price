"""Online SQLite backup; includes committed WAL data without stopping the app."""
from datetime import datetime, timezone
from pathlib import Path
import sqlite3

root = Path('/var/lib/ldxp-cf-demo')
paths = [p for p in (root / 'd1').glob('**/*.sqlite') if p.name != 'metadata.sqlite']
if len(paths) != 1:
    raise SystemExit('Expected exactly one application database')
backup_dir = root / 'backups'
backup_dir.mkdir(mode=0o700, exist_ok=True)
name = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.sqlite'
with sqlite3.connect(f'file:{paths[0]}?mode=ro', uri=True) as source:
    with sqlite3.connect(backup_dir / name) as target:
        source.backup(target)
        assert target.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
print(backup_dir / name)
for old in sorted(backup_dir.glob('*.sqlite'))[:-14]:
    old.unlink()
