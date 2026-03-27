const fs = require("fs");
const path = require("path");
require("dotenv").config();

const DB_PATH = path.resolve(process.env.DB_PATH || "./invitewala.db");

let _db = null;

async function initDb() {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(fileBuffer);
  } else {
    _db = new SQL.Database();
  }

  _db.run("PRAGMA foreign_keys = ON");
  initSchema();
}

function saveDb() {
  const data = _db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function initSchema() {
  _db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT UNIQUE NOT NULL,
      password    TEXT NOT NULL,
      created_at  INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);
  _db.run(`
    CREATE TABLE IF NOT EXISTS invites (
      id            TEXT PRIMARY KEY,
      user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
      occasion_id   TEXT NOT NULL,
      occasion_name TEXT NOT NULL,
      sender_name   TEXT NOT NULL,
      recip_name    TEXT,
      event_date    TEXT,
      event_time    TEXT,
      location      TEXT,
      note          TEXT,
      language      TEXT NOT NULL DEFAULT 'en',
      template_id   TEXT NOT NULL DEFAULT 'luxe',
      generated_text TEXT,
      created_at    INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);
}

// Compatibility shim matching the better-sqlite3 synchronous API
function getDb() {
  if (!_db) throw new Error("Database not initialized. Await initDb() first.");

  return {
    exec(sql) {
      _db.run(sql);
      saveDb();
    },
    prepare(sql) {
      return {
        get(...params) {
          const stmt = _db.prepare(sql);
          stmt.bind(params);
          if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
          }
          stmt.free();
          return undefined;
        },
        all(...params) {
          const stmt = _db.prepare(sql);
          stmt.bind(params);
          const rows = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          stmt.free();
          return rows;
        },
        run(...params) {
          _db.run(sql, params);
          const changes = _db.getRowsModified();
          saveDb();
          return { changes };
        },
      };
    },
  };
}

module.exports = { getDb, initDb };
