#!/usr/bin/env node

/**
 * Valorant team list / directory query script.
 * MVP focus: list teams, search by keyword, and return structured records.
 */

const fs = require('fs');
const path = require('path');

function loadTeams() {
  const file = path.join(__dirname, '..', 'data', 'teams.json');
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function normalize(text) {
  return String(text || '').trim().toLowerCase();
}

function main() {
  const query = process.argv.slice(2).join(' ').trim();
  const data = loadTeams();
  const teams = data.teams || [];
  const q = normalize(query);

  const results = !q
    ? teams
    : teams.filter((team) => {
        const haystack = [team.name, team.short_name, ...(team.aliases || [])].map(normalize);
        return haystack.some((item) => item.includes(q));
      });

  const output = {
    query_type: 'team_directory',
    matched_script: 'scripts/valorant-teams.js',
    normalized_query: query,
    filters: { keyword: query || null },
    result: {
      total: results.length,
      teams: results,
    },
    source: {
      type: 'static_json',
      file: 'data/teams.json',
      version: data.version,
      updated_at: data.updated_at,
    },
    notes: results.length ? [] : ['no_teams_matched'],
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
