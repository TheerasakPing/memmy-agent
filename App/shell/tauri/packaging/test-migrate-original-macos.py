#!/usr/bin/env python3
import importlib.util
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest

script = Path(__file__).with_name('migrate-original-macos.py')
spec = importlib.util.spec_from_file_location('memmy_migration', script)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class OriginalProfileSnapshotTests(unittest.TestCase):
    def test_wal_aware_snapshot_and_no_overwrite(self):
        with tempfile.TemporaryDirectory(prefix='memmy-legacy-db-test-') as root:
            home = Path(root)
            src = home / 'Library/Application Support/Memmy'
            memory = home / '.memmy/memory-service'
            src.mkdir(parents=True); memory.mkdir(parents=True)
            app_db = src / 'app.sqlite'; mem_db = memory / 'memory.sqlite'
            for path in (app_db, mem_db):
                db = sqlite3.connect(path)
                db.execute('PRAGMA journal_mode=WAL')
                db.execute('CREATE TABLE contents (id INTEGER PRIMARY KEY, value TEXT)')
                db.execute('INSERT INTO contents(value) VALUES (?)',('old value',))
                db.commit()
                # Include recent WAL writes; snapshot should include them.
                db.execute('INSERT INTO contents(value) VALUES (?)',('new WAL value',))
                db.commit()
                db.close()
            config=(home/'.memmy/config.yaml')
            config.write_text('memmyMemory:\n  agentAccess:\n    autoScanKnownAgents: true\n')
            target=home/'Library/Application Support/com.theerasakping.memmy.turbo.preview'
            # Reject nested destinations inside either Original profile, even in dry-run.
            for unsafe in (src/'nested/preview', home/'.memmy/preview'):
                with self.assertRaisesRegex(RuntimeError, 'Original profile'):
                    mod.migrate(home,unsafe,False)
                self.assertFalse(unsafe.exists())
            plan=mod.migrate(home,target,False)
            self.assertEqual(plan['apply'],False)
            self.assertFalse(target.exists())
            snapshot=mod.migrate(home,target,True)
            self.assertEqual(len(snapshot['snapshots']),2)
            for path in (target/'memory.sqlite',target/'app-state.sqlite'):
                db=sqlite3.connect(path)
                self.assertEqual(db.execute('SELECT count(*) FROM contents').fetchone()[0],2)
                self.assertEqual(db.execute('PRAGMA quick_check(1)').fetchone()[0],'ok')
                db.close()
                self.assertEqual(path.stat().st_mode & 0o777,0o600)
            self.assertEqual(config.read_text(),'memmyMemory:\n  agentAccess:\n    autoScanKnownAgents: true\n')
            self.assertIn('autoScanKnownAgents: false',(target/'config.yaml').read_text())
            self.assertFalse(list(target.glob('.*.tmp*')))
            with self.assertRaises(RuntimeError):mod.migrate(home,target,True)

if __name__=='__main__': unittest.main()
