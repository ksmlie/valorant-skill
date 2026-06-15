#!/usr/bin/env node

/**
 * Valorant schedule query script.
 * MVP focus: today / tomorrow / date-filtered schedule output.
 */

function normalizeDateKeyword(text) {
  const q = String(text || '').trim().toLowerCase();
  if (!q) return 'today';
  if (q.includes('tomorrow') || q.includes('明天')) return 'tomorrow';
  if (q.includes('today') || q.includes('今天')) return 'today';
  return q;
}

function main() {
  const query = process.argv.slice(2).join(' ').trim();
  const normalized = normalizeDateKeyword(query);

  const output = {
    query_type: 'schedule_lookup',
    matched_script: 'scripts/valorant-schedule.js',
    normalized_query: query,
    filters: {
      date_keyword: normalized,
    },
    result: {
      match_count: 0,
      matches: [],
      status: 'mvp_stub',
    },
    source: {
      type: 'future_data_source',
      file: null,
    },
    notes: ['schedule_data_not_connected_yet'],
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
