#!/usr/bin/env python3
"""Copy consistent SQLite snapshots from Original Electron Memmy into isolated Tauri preview.
Never opens/updates the original source DB for writing. No direct shared live writes.
"""

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import sqlite3
import stat
import sys
import uuid
import yaml

def secure_dir(folder: Path):
    if folder.is_symlink(): raise RuntimeError(f'Refusing symlinked target: {folder}')
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not folder.is_dir() or folder.is_symlink(): raise RuntimeError('Unsafe destination directory')
    os.chmod(folder, 0o700)

def clone_sqlite(source: Path, dest: Path):
    if not source.is_file() or source.is_symlink(): raise RuntimeError(f'Original SQLite unavailable or unsafe: {source}')
    if dest.exists() or dest.is_symlink(): raise RuntimeError(f'Destination already exists; refusing overwrite: {dest}')
    temp=dest.with_name(f'.{dest.name}.{uuid.uuid4().hex}.tmp')
    uri=source.as_uri()+'?mode=ro'
    src=sqlite3.connect(uri, uri=True, timeout=45)
    db=None
    try:
        db=sqlite3.connect(str(temp), timeout=45)
        os.chmod(temp, 0o600)
        src.backup(db, pages=4096, sleep=0.1)
        db.close();db=None
        check=sqlite3.connect(temp.as_uri()+'?mode=ro',uri=True)
        try:
            ok=check.execute('PRAGMA quick_check(1)').fetchone()
            if ok != ('ok',): raise RuntimeError(f'SQLite snapshot integrity: {ok}')
            tables=check.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
        finally:check.close()
        os.replace(temp,dest)
        os.chmod(dest,0o600)
        return {'database':dest.name,'bytes':dest.stat().st_size,'tables':tables,'quickCheck':'ok'}
    finally:
        if db:db.close()
        src.close()
        if temp.exists(): temp.unlink()
        for suffix in ('-wal','-shm'):
            journal=Path(str(temp)+suffix)
            if journal.exists() and journal.is_file() and not journal.is_symlink():journal.unlink()

def migrate(home:Path,target:Path,apply:bool):
    if not home.is_dir(): raise RuntimeError('User HOME is missing')
    legacy=home/'Library/Application Support/Memmy/app.sqlite'
    memmy=home/'.memmy'
    memory=memmy/'memory-service/memory.sqlite'
    config=memmy/'config.yaml'
    if not legacy.is_file() or not memory.is_file(): raise RuntimeError('Original Memmy app.sqlite or Memory SQLite missing')
    resolved_target = target.resolve()
    original_roots = (legacy.parent.resolve(), memmy.resolve())
    if any(resolved_target == root or resolved_target.is_relative_to(root) for root in original_roots):
        raise RuntimeError('Refusing to write inside an Original profile')
    filemap=[(legacy,target/'app-state.sqlite'),(memory,target/'memory.sqlite')]
    for _,dest in filemap:
        if dest.exists() or dest.is_symlink(): raise RuntimeError(f'Existing Tauri data found; will not overwrite: {dest}')
    if (target/'config.yaml').exists(): raise RuntimeError('Existing Tauri configuration found; refusing overwrite')
    plan={'mode':'snapshot-not-shared','originalAppDatabaseBytes':legacy.stat().st_size,
          'originalMemoryDatabaseBytes':memory.stat().st_size,
          'target':str(target),'originalPreserved':True,'apply':apply}
    if not apply:return plan
    secure_dir(target)
    try:
        results=[clone_sqlite(src,dest) for src,dest in filemap]
        if config.is_file() and not config.is_symlink():
            original=yaml.safe_load(config.read_text('utf8')) or {}
            if not isinstance(original,dict):raise RuntimeError('Original config has unsupported format')
            # Never scan/inject into the original app automatically from the new instance.
            mem=original.setdefault('memmyMemory',{})
            if not isinstance(mem,dict):raise RuntimeError('Original Memory config has unsupported format')
            access=mem.setdefault('agentAccess',{})
            if not isinstance(access,dict):raise RuntimeError('Original Memory access config has unsupported format')
            access.update(autoScanKnownAgents=False,watchFileChanges=False,autoInjectSkill=False)
            # Rebound to the isolated Tauri-owned SQLite; do not write into Original.
            storage=mem.get('storage')
            if isinstance(storage,dict):storage['sqlitePath']=str(target/'memory.sqlite')
            tmp=target/f'.config-{uuid.uuid4().hex}.tmp'
            flags=os.O_CREAT|os.O_EXCL|os.O_WRONLY
            fd=os.open(tmp,flags,0o600)
            with os.fdopen(fd,'w',encoding='utf8') as f:
                yaml.safe_dump(original,f,allow_unicode=True,sort_keys=False)
                f.flush();os.fsync(f.fileno())
            os.replace(tmp,target/'config.yaml')
        plan['snapshots']=results
        plan['configImported']=config.is_file()
        return plan
    except:
        # No real Original files have been opened writable or changed.
        # Keep any completed isolated snapshots for manual forensic/recovery.
        raise

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--home',type=Path,default=Path.home())
    parser.add_argument('--target',type=Path,default=Path.home()/'Library/Application Support/com.theerasakping.memmy.turbo.preview')
    parser.add_argument('--apply',action='store_true')
    opt=parser.parse_args()
    try:print(json.dumps(migrate(opt.home.expanduser(),opt.target.expanduser(),opt.apply),ensure_ascii=False))
    except Exception as e:
        print(f'ERROR: {e}',file=sys.stderr);sys.exit(1)
