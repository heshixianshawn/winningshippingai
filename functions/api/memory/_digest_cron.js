// WINNING Shipping AI - Knowledge Digestion Cron
// Scheduled: daily at 02:00 (adjust via CF Dashboard → Triggers)
// Reads all data files, detects changes, digests new/changed data into D1 memory.
//
// Required bindings:
//   - DB: D1 database (memory-kb)
//   - DEEPSEEK_API_KEY_ENV: env secret
//   - ASSETS: Pages static assets binding (if needed)

import { digestData, saveMemory, getSourceTracking, updateSourceTracking } from './_memory_core.js';

// Data files to digest, ordered by priority (most important first)
const DATA_FILES = [
  { path: 'data/fleet_params.json', topicType: 'ship', splitKey: 'ships' },
  { path: 'data/ship_knowledge.json', topicType: 'ship', splitKey: 'by_ship' },
  { path: 'data/tech_index.json', topicType: 'equipment', splitKey: 'device_shards' },
  { path: 'data/hifleet_daily.json', topicType: 'ship', isDynamic: true },
];

const FILES_PER_RUN = 3;  // Max files to digest per cron run (avoid 30s timeout)
const CHUNK_SIZE = 100;    // Max items per digestion call (for large files)

export default {
  async scheduled(event, env, ctx) {
    const startTime = Date.now();
    const db = env.DB;
    const deepseekKey = env.DEEPSEEK_API_KEY_ENV;
    const baseUrl = env.PAGES_URL || 'https://winningshippingai.pages.dev';
    
    console.log('[Digest] Starting cron digestion...');
    let filesProcessed = 0;
    const log = [];
    
    if (!db) {
      console.error('[Digest] D1 binding "DB" not configured');
      return;
    }
    if (!deepseekKey) {
      console.error('[Digest] DEEPSEEK_API_KEY_ENV not configured');
      return;
    }
    
    for (const fileDef of DATA_FILES) {
      if (filesProcessed >= FILES_PER_RUN) {
        console.log('[Digest] Hit per-run limit, stopping');
        break;
      }
      if (Date.now() - startTime > 25000) {  // Buffer: leave 5s for writing
        console.log('[Digest] Approaching timeout, stopping');
        break;
      }
      
      try {
        const result = await processFile(db, fileDef, baseUrl, deepseekKey);
        if (result) {
          filesProcessed++;
          log.push({ file: fileDef.path, status: result.status, items: result.itemsProcessed });
          console.log(`[Digest] ${fileDef.path}: ${result.status} (${result.itemsProcessed} items)`);
        }
      } catch (e) {
        console.error(`[Digest] Error processing ${fileDef.path}:`, e.message);
        log.push({ file: fileDef.path, status: 'error', error: e.message });
      }
    }
    
    console.log(`[Digest] Done. Processed ${filesProcessed} files in ${Date.now() - startTime}ms`);
    
    // Log results back to D1
    try {
      await db.prepare(
        `INSERT INTO prompt_evolution (version, prompt_type, content, notes)
         VALUES (?, 'digest_log', ?, ?)`
      ).bind(
        `digest.${new Date().toISOString().slice(0, 10)}`,
        JSON.stringify(log),
        `Duration: ${Date.now() - startTime}ms, Files: ${filesProcessed}`
      ).run();
    } catch (e) {
      console.error('[Digest] Failed to write log:', e.message);
    }
  }
};

/**
 * Process a single data file: check for changes, digest if needed.
 */
async function processFile(db, fileDef, baseUrl, deepseekKey) {
  const { path, topicType, splitKey, isDynamic } = fileDef;
  
  // Fetch the current file
  const resp = await fetch(`${baseUrl}/${path}`);
  if (!resp.ok) {
    return { status: 'fetch_failed', itemsProcessed: 0 };
  }
  
  const data = await resp.json();
  const contentStr = JSON.stringify(data);
  const contentHash = simpleHash(contentStr);
  const contentSize = contentStr.length;
  
  // Check if this file was already digested with same hash
  const tracking = await getSourceTracking(db, path);
  if (tracking && tracking.hash === contentHash) {
    return { status: 'unchanged', itemsProcessed: 0 };
  }
  
  // Hash changed or new file: need to digest
  console.log(`[Digest] ${path}: ${tracking ? 'hash changed' : 'new file'}, starting digestion...`);
  
  // Extract items to digest individually
  let items = [];
  let docCount = 0;
  
  if (splitKey && data[splitKey]) {
    const rawItems = data[splitKey];
    if (Array.isArray(rawItems)) {
      items = rawItems;
      docCount = rawItems.length;
    } else if (typeof rawItems === 'object') {
      items = Object.entries(rawItems).map(([key, val]) => ({ key, ...val }));
      docCount = Object.keys(rawItems).length;
    }
  } else if (Array.isArray(data)) {
    items = data;
    docCount = data.length;
  } else {
    // Treat entire file as one item
    items = [{ _key: 'root', _data: data }];
    docCount = 1;
  }
  
  if (isDynamic) {
    // Dynamic data (AIS positions) — digest as single entry, not per-ship
    items = [{ _key: 'fleet_dynamic', _data: data }];
  }
  
  // Mark existing memories for this source as stale
  await markStaleMemories(db, path);
  
  // Batch digest in chunks
  let totalDigested = 0;
  const currentTime = new Date().toISOString();
  
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    if (Date.now() - Date.now() > 20000) break;  // Safety brake
    if (totalDigested >= 50) {
      console.log(`[Digest] ${path}: Hit item limit (50), ${items.length - totalDigested} remaining`);
      break;
    }
    
    const chunk = items.slice(i, i + CHUNK_SIZE);
    
    for (const item of chunk) {
      const topic = item.key || item.name_en || item.name || path.split('/').pop().replace('.json', '');
      if (!topic || topic === 'root') continue;
      
      // Check if memory already exists for this topic from this source
      const existingStmt = db.prepare(
        `SELECT id, summary, source_file, source_updated_at FROM memory_entries 
         WHERE topic = ? AND source_file = ?`
      );
      const { results: existing } = await existingStmt.bind(topic, path).all();
      
      const itemData = item._data || item;
      const itemJson = JSON.stringify(itemData).slice(0, 6000);
      
      try {
        const result = await digestData({
          data: itemJson,
          topic,
          topicType,
          sourceFile: path,
          deepseekKey,
          existingEntries: existing.length > 0 ? existing : null
        });
        
        await saveMemory(db, {
          sourceFile: path,
          sourceUpdatedAt: currentTime,
          sourceType: 'json',
          topic,
          topicType,
          summary: result.summary,
          keyFacts: result.keyFacts,
          hasConflict: result.hasConflict,
          conflictIds: result.conflictIds,
          conflictNote: result.conflictNote,
          rawDataSample: itemJson.slice(0, 500)
        });
        
        totalDigested++;
      } catch (e) {
        console.error(`[Digest] Failed to digest ${path}/${topic}:`, e.message);
        // Continue with next item
      }
    }
  }
  
  // Update source tracking
  await updateSourceTracking(db, path, contentSize, contentHash, docCount);
  
  return { status: 'digested', itemsProcessed: totalDigested };
}

/**
 * Mark memory entries for a source file as outdated.
 */
async function markStaleMemories(db, sourceFile) {
  try {
    // For now, old entries will be overwritten by INSERT OR REPLACE in saveMemory
    // We just need to clean up dependencies
    const stmt = db.prepare('DELETE FROM memory_dependencies WHERE source_file = ?');
    await stmt.bind(sourceFile).run();
  } catch (e) {
    console.error('[Digest] Failed to mark stale memories:', e.message);
  }
}

/**
 * Simple content hash for change detection (not cryptographic).
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// Also handle HTTP triggers for manual digestion
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
  // Simple auth check
  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${env.DIGEST_KEY || ''}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  if (request.method === 'POST') {
    // Trigger digestion manually
    const result = await scheduled(null, env, {});
    return new Response(JSON.stringify({ status: 'ok', result }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // GET: view current tracking info
  const db = env.DB;
  if (db && request.method === 'GET') {
    const { results } = await db.prepare('SELECT * FROM source_tracking').all();
    return new Response(JSON.stringify(results), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return new Response('Method not allowed', { status: 405 });
}
