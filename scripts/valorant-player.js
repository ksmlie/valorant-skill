#!/usr/bin/env node

/**
 * Valorant player detail query script.
 * Reads structured player records from data/players.json.
 */

const fs = require('fs');
const path = require('path');

function loadPlayers() {
  const file = path.join(__dirname, '..', 'data', 'players.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalize(text) {
  return String(text || '').trim().toLowerCase();
}

function main() {
  const query = process.argv.slice(2).join(' ').trim();
  const data = loadPlayers();
  const players = data.players || [];
  const q = normalize(query);

  const matched = !q
    ? []
    : players.filter((player) => {
        const names = [player.name, player.short_name, ...(player.aliases || [])].map(normalize);
        return names.some((name) => name.includes(q));
      });

  const output = {
    query_type: 'player_detail',
    matched_script: 'scripts/valorant-player.js',
    normalized_query: query,
    filters: {
      player_keyword: query || null,
    },
    result: {
      matched_count: matched.length,
      player: matched[0] || null,
      recent_results: matched[0]?.stats ? [matched[0].stats] : [],
      recent_form: null,
      status: matched.length ? 'resolved' : 'not_found',
    },
    source: {
      type: 'static_json',
      file: 'data/players.json',
      version: data.version,
      updated_at: data.updated_at,
    },
    notes: matched.length > 1 ? ['multiple_players_matched'] : matched.length ? [] : ['player_not_found'],
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
