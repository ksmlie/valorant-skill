#!/usr/bin/env node

/**
 * Valorant team detail query script.
 * Reads structured team records from data/teams.json and links to players.json.
 */

const fs = require('fs');
const path = require('path');

function loadJSON(filename) {
  const file = path.join(__dirname, '..', 'data', filename);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalize(text) {
  return String(text || '').trim().toLowerCase();
}

function flattenTeams(regions) {
  return Object.values(regions || {}).flatMap((region) => region.teams || []);
}

function main() {
  const query = process.argv.slice(2).join(' ').trim();
  const teamsData = loadJSON('teams.json');
  const playersData = loadJSON('players.json');
  const teams = flattenTeams(teamsData.regions);
  const players = playersData.players || [];
  const q = normalize(query);

  const matched = !q
    ? []
    : teams.filter((team) => {
        const names = [team.name, team.short_name, ...(team.aliases || [])].map(normalize);
        return names.some((name) => name.includes(q));
      });

  const team = matched[0] || null;
  const roster = team
    ? (team.current_roster || [])
        .map((playerId) => players.find((player) => player.id === playerId))
        .filter(Boolean)
    : [];

  const output = {
    query_type: 'team_detail',
    matched_script: 'scripts/valorant-team.js',
    normalized_query: query,
    filters: { team_keyword: query || null },
    result: {
      matched_count: matched.length,
      team: team
        ? {
            ...team,
            roster
          }
        : null,
      recent_results: [],
      recent_form: null,
      status: matched.length ? 'resolved' : 'not_found'
    },
    source: {
      type: 'static_json',
      file: 'data/teams.json + data/players.json',
      team_version: teamsData.version,
      player_version: playersData.version,
      updated_at: teamsData.updated_at
    },
    notes: matched.length > 1 ? ['multiple_teams_matched'] : matched.length ? [] : ['team_not_found']
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
