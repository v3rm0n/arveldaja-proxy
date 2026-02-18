import sqlite3 from 'sqlite3';
import { PendingChange, Changeset } from '../types';

let db: sqlite3.Database | null = null;

export async function initDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database('./pending_changes.db', (err) => {
      if (err) {
        reject(err);
        return;
      }

      db!.run('PRAGMA foreign_keys = ON', (pragmaErr) => {
        if (pragmaErr) {
          reject(pragmaErr);
          return;
        }

        db!.exec(`
        CREATE TABLE IF NOT EXISTS changesets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          resolved_at TEXT,
          resolved_by TEXT
        );

        CREATE TABLE IF NOT EXISTS pending_changes (
          id TEXT PRIMARY KEY,
          changeset_id TEXT,
          method TEXT NOT NULL,
          path TEXT NOT NULL,
          original_url TEXT NOT NULL,
          headers TEXT NOT NULL,
          body TEXT,
          query TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          resolved_at TEXT,
          resolved_by TEXT,
          response TEXT,
          error TEXT,
          FOREIGN KEY (changeset_id) REFERENCES changesets(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_status ON pending_changes(status);
        CREATE INDEX IF NOT EXISTS idx_created_at ON pending_changes(created_at);
        CREATE INDEX IF NOT EXISTS idx_changeset_id ON pending_changes(changeset_id);
        CREATE INDEX IF NOT EXISTS idx_changeset_status ON changesets(status);
      `, (err) => {
          if (err) {
            reject(err);
          } else {
            console.log('Database initialized with changesets');
            resolve();
          }
        });
      });
    });
  });
}

// Changeset operations
export async function createChangeset(changeset: Changeset): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    
    db.run(
      `INSERT INTO changesets 
       (id, name, description, status, created_at, resolved_at, resolved_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        changeset.id,
        changeset.name,
        changeset.description || null,
        changeset.status,
        changeset.createdAt,
        changeset.resolvedAt,
        changeset.resolvedBy,
      ],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

export async function getChangesets(status?: 'pending' | 'approved' | 'rejected'): Promise<(Changeset & { changesCount: number })[]> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    
    let query = `
      SELECT c.*, COUNT(pc.id) as changes_count 
      FROM changesets c
      LEFT JOIN pending_changes pc ON c.id = pc.changeset_id
    `;
    const params: string[] = [];
    
    if (status) {
      query += ' WHERE c.status = ?';
      params.push(status);
    }
    
    query += ' GROUP BY c.id ORDER BY c.created_at DESC';
    
    db.all(query, params, (err, rows: any[]) => {
      if (err) {
        reject(err);
        return;
      }
      
      resolve(rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        status: row.status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
        resolvedBy: row.resolved_by,
        changesCount: row.changes_count || 0,
      })));
    });
  });
}

export async function getChangesetById(id: string): Promise<Changeset | null> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    
    db.get('SELECT * FROM changesets WHERE id = ?', id, (err, row: any) => {
      if (err) {
        reject(err);
        return;
      }
      
      if (!row) {
        resolve(null);
        return;
      }
      
      resolve({
        id: row.id,
        name: row.name,
        description: row.description,
        status: row.status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
        resolvedBy: row.resolved_by,
      });
    });
  });
}

export async function getChangesetWithChanges(id: string): Promise<{ changeset: Changeset; changes: PendingChange[] } | null> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    
    db.get('SELECT * FROM changesets WHERE id = ?', id, (err, changesetRow: any) => {
      if (err) {
        reject(err);
        return;
      }
      
      if (!changesetRow) {
        resolve(null);
        return;
      }
      
      const changeset: Changeset = {
        id: changesetRow.id,
        name: changesetRow.name,
        description: changesetRow.description,
        status: changesetRow.status,
        createdAt: changesetRow.created_at,
        resolvedAt: changesetRow.resolved_at,
        resolvedBy: changesetRow.resolved_by,
      };
      
      db!.all('SELECT * FROM pending_changes WHERE changeset_id = ? ORDER BY created_at ASC', id, (err, changeRows: any[]) => {
        if (err) {
          reject(err);
          return;
        }
        
        const changes: PendingChange[] = changeRows.map(row => ({
          id: row.id,
          changesetId: row.changeset_id,
          method: row.method,
          path: row.path,
          originalUrl: row.original_url,
          headers: JSON.parse(row.headers),
          body: row.body,
          query: JSON.parse(row.query),
          status: row.status,
          createdAt: row.created_at,
          resolvedAt: row.resolved_at,
          resolvedBy: row.resolved_by,
          response: row.response,
          error: row.error,
        }));
        
        resolve({ changeset, changes });
      });
    });
  });
}

export async function updateChangesetStatus(
  id: string,
  status: 'approved' | 'rejected',
  resolvedBy: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    
    db.run(
      `UPDATE changesets 
       SET status = ?, resolved_at = ?, resolved_by = ?
       WHERE id = ?`,
      [status, new Date().toISOString(), resolvedBy, id],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

// Change operations
export async function createPendingChange(change: PendingChange): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    
    db.run(
      `INSERT INTO pending_changes 
       (id, changeset_id, method, path, original_url, headers, body, query, status, created_at, resolved_at, resolved_by, response, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        change.id,
        change.changesetId || null,
        change.method,
        change.path,
        change.originalUrl,
        JSON.stringify(change.headers),
        change.body,
        JSON.stringify(change.query),
        change.status,
        change.createdAt,
        change.resolvedAt,
        change.resolvedBy,
        change.response,
        change.error,
      ],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

export async function getPendingChanges(status?: 'pending' | 'approved' | 'rejected', changesetId?: string): Promise<PendingChange[]> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    
    let query = 'SELECT * FROM pending_changes';
    const params: (string | null)[] = [];
    const conditions: string[] = [];
    
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    
    if (changesetId !== undefined) {
      conditions.push('changeset_id = ?');
      params.push(changesetId);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY created_at DESC';
    
    db.all(query, params, (err, rows: any[]) => {
      if (err) {
        reject(err);
        return;
      }
      
      resolve(rows.map(row => ({
        id: row.id,
        changesetId: row.changeset_id,
        method: row.method,
        path: row.path,
        originalUrl: row.original_url,
        headers: JSON.parse(row.headers),
        body: row.body,
        query: JSON.parse(row.query),
        status: row.status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
        resolvedBy: row.resolved_by,
        response: row.response,
        error: row.error,
      })));
    });
  });
}

export async function getPendingChangeById(id: string): Promise<PendingChange | null> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    
    db.get('SELECT * FROM pending_changes WHERE id = ?', id, (err, row: any) => {
      if (err) {
        reject(err);
        return;
      }
      
      if (!row) {
        resolve(null);
        return;
      }
      
      resolve({
        id: row.id,
        changesetId: row.changeset_id,
        method: row.method,
        path: row.path,
        originalUrl: row.original_url,
        headers: JSON.parse(row.headers),
        body: row.body,
        query: JSON.parse(row.query),
        status: row.status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
        resolvedBy: row.resolved_by,
        response: row.response,
        error: row.error,
      });
    });
  });
}

export async function updatePendingChangeStatus(
  id: string,
  status: 'approved' | 'rejected',
  resolvedBy: string,
  response?: string,
  error?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    
    db.run(
      `UPDATE pending_changes 
       SET status = ?, resolved_at = ?, resolved_by = ?, response = ?, error = ?
       WHERE id = ?`,
      [status, new Date().toISOString(), resolvedBy, response || null, error || null, id],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

export async function deletePendingChange(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    
    db.run('DELETE FROM pending_changes WHERE id = ?', id, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function deleteChangeset(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    
    // Changes will be deleted automatically due to ON DELETE CASCADE
    db.run('DELETE FROM changesets WHERE id = ?', id, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function deleteChangesets(status?: 'pending' | 'approved' | 'rejected'): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }

    const query = status
      ? 'DELETE FROM changesets WHERE status = ?'
      : 'DELETE FROM changesets';
    const params = status ? [status] : [];

    db.run(query, params, function (err) {
      if (err) {
        reject(err);
        return;
      }

      resolve(this.changes ?? 0);
    });
  });
}

export async function moveChangesToChangeset(changeIds: string[], changesetId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    
    // Create placeholders for the IN clause
    const placeholders = changeIds.map(() => '?').join(',');
    
    db.run(
      `UPDATE pending_changes SET changeset_id = ? WHERE id IN (${placeholders})`,
      [changesetId, ...changeIds],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}
