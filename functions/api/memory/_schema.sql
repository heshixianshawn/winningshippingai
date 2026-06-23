-- WINNING Shipping AI - Knowledge Memory System
-- D1 Database Schema

-- Memory entries: DeepSeek-digested knowledge chunks
CREATE TABLE IF NOT EXISTS memory_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Source tracking
  source_file TEXT NOT NULL,          -- e.g. 'data/fleet_params.json', 'data/tech_shards/锅炉.json'
  source_updated_at TEXT,             -- timestamp of source file at time of digestion
  source_type TEXT NOT NULL DEFAULT 'json',  -- 'json', 'pdf', 'xlsx', etc.
  
  -- Content
  topic TEXT NOT NULL,                -- 'SUNNY BOFFA', '锅炉', '压载水系统', etc.
  topic_type TEXT NOT NULL DEFAULT 'ship',  -- 'ship', 'equipment', 'regulation', 'system'
  summary TEXT NOT NULL,              -- DeepSeek-digested markdown summary
  key_facts TEXT,                     -- JSON array of strings: ["接管日期: 2017-12-04", ...]
  raw_data_sample TEXT,               -- Small sample of original data for context (first 500 chars)
  
  -- Conflict tracking
  has_conflict INTEGER DEFAULT 0,     -- 1 if this entry conflicts with another
  conflict_ids TEXT,                  -- JSON array of conflicting entry IDs
  conflict_note TEXT,                 -- Human-readable conflict description
  
  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Memory dependencies: which memory entries depend on which source files
-- When a source file is updated, we know which memories need refresh
CREATE TABLE IF NOT EXISTS memory_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id INTEGER NOT NULL,
  source_file TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memory_entries(id)
);

-- Source file tracking: last time each file was digested
CREATE TABLE IF NOT EXISTS source_tracking (
  file_path TEXT PRIMARY KEY,
  last_digested_at TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  hash TEXT,                          -- Simple content hash to detect changes
  doc_count INTEGER DEFAULT 0         -- Number of documents/records in the file
);

-- System prompt evolution: track how prompts change over time
CREATE TABLE IF NOT EXISTS prompt_evolution (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,              -- e.g. 'ships.v1', 'ships.v2'
  prompt_type TEXT NOT NULL,          -- 'ships', 'tech', 'regulations', etc.
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
);

-- Query log: track what users ask and whether memory helped
CREATE TABLE IF NOT EXISTS query_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  module TEXT NOT NULL,
  question TEXT NOT NULL,
  memory_topics_used TEXT,            -- JSON array of topic names matched
  memory_count INTEGER DEFAULT 0,
  reply_preview TEXT,
  helpful INTEGER DEFAULT NULL        -- NULL=unknown, 1=helpful, 0=not helpful
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_memory_topic ON memory_entries(topic);
CREATE INDEX IF NOT EXISTS idx_memory_topic_type ON memory_entries(topic_type);
CREATE INDEX IF NOT EXISTS idx_memory_source ON memory_entries(source_file);
CREATE INDEX IF NOT EXISTS idx_memory_conflict ON memory_entries(has_conflict);
CREATE INDEX IF NOT EXISTS idx_dep_source ON memory_dependencies(source_file);
CREATE INDEX IF NOT EXISTS idx_dep_memory ON memory_dependencies(memory_id);
CREATE INDEX IF NOT EXISTS idx_query_time ON query_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_query_module ON query_log(module);
