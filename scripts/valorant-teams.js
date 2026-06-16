#!/usr/bin/env node

/**
 * Valorant team directory query script.
 *
 * Supported commands:
 * - list                         List all 48 teams
 * - region <name>                List teams in a region
 * - find <name>                  Resolve one team by exact name/short_name/alias, fallback to fuzzy
 * - search <keyword>             Fuzzy search teams by keyword
 * - info                         Show dataset summary
 *
 * Default behavior:
 * - no args                      Same as list
 * - unknown command / raw text   Same as search <raw text>
 */

const fs = require('fs');
const path = require('path');

const SCRIPT_NAME = 'scripts/valorant-teams.js';
const DATA_FILE = path.join(__dirname, '..', 'data', 'teams.json');
const REGION_KEYS = ['AMERICAS', 'EMEA', 'PACIFIC', 'CHINA'];
const REGION_ALIASES = {
  americas: 'AMERICAS',
  america: 'AMERICAS',
  emea: 'EMEA',
  europe: 'EMEA',
  pacific: 'PACIFIC',
  apac: 'PACIFIC',
  china: 'CHINA',
  cn: 'CHINA',
};

function loadTeams() {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(raw);
}

function compact(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function stripDiacritics(text) {
  return String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function normalize(text) {
  return stripDiacritics(String(text || ''))
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function flattenTeams(data) {
  return REGION_KEYS.flatMap((region) => {
    const regionData = data?.regions?.[region];
    const teams = Array.isArray(regionData?.teams) ? regionData.teams : [];
    return teams.map((team) => ({ ...team, region: team.region || region }));
  });
}

function normalizeRegion(regionInput) {
  const key = normalize(regionInput).replace(/\s+/g, '');
  return REGION_ALIASES[key] || null;
}

function getTeamSearchTerms(team) {
  return [team.id, team.name, team.short_name, ...(team.aliases || [])]
    .map((item) => compact(item))
    .filter(Boolean);
}

function formatTeam(team) {
  return {
    team_id: team.id,
    team_name: team.name,
    short_name: team.short_name,
    region: team.region,
    aliases: team.aliases || [],
    status: team.status || null,
    vlr_url: team.vlr_url || null,
    vlr_team_id: team.vlr_team_id || null,
    current_roster: team.current_roster || [],
  };
}

function uniqueTeams(teams) {
  const seen = new Set();
  return teams.filter((team) => {
    if (!team?.id || seen.has(team.id)) return false;
    seen.add(team.id);
    return true;
  });
}

function sortTeams(teams) {
  return [...teams].sort((a, b) => {
    const regionCompare = String(a.region || '').localeCompare(String(b.region || ''));
    if (regionCompare !== 0) return regionCompare;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function searchTeams(teams, query) {
  const q = normalize(query);
  if (!q) return sortTeams(uniqueTeams(teams));

  const exact = [];
  const fuzzy = [];

  for (const team of teams) {
    const terms = getTeamSearchTerms(team);
    const normalizedTerms = terms.map(normalize).filter(Boolean);

    if (normalizedTerms.some((term) => term === q)) {
      exact.push(team);
      continue;
    }

    if (normalizedTerms.some((term) => term.includes(q) || q.includes(term))) {
      fuzzy.push(team);
    }
  }

  return sortTeams(uniqueTeams([...exact, ...fuzzy]));
}

function findTeams(teams, query) {
  const q = normalize(query);
  if (!q) return [];

  const exactName = teams.filter((team) => normalize(team.name) === q);
  if (exactName.length) return sortTeams(uniqueTeams(exactName));

  const exactShort = teams.filter((team) => normalize(team.short_name) === q);
  if (exactShort.length) return sortTeams(uniqueTeams(exactShort));

  const exactAlias = teams.filter((team) => (team.aliases || []).some((alias) => normalize(alias) === q));
  if (exactAlias.length) return sortTeams(uniqueTeams(exactAlias));

  return searchTeams(teams, query);
}

function baseSource(data) {
  return {
    type: 'static_json',
    file: 'data/teams.json',
    version: data.version || null,
    updated_at: data.updated_at || null,
  };
}

function print(output) {
  console.log(JSON.stringify(output, null, 2));
}

function buildListOutput(data, teams, rawArgs) {
  const formatted = teams.map(formatTeam);
  return {
    query_type: 'team_list',
    matched_script: SCRIPT_NAME,
    normalized_query: rawArgs || 'list',
    filters: { region: null, keyword: null },
    result: {
      total: formatted.length,
      regions: REGION_KEYS,
      teams: formatted,
    },
    source: baseSource(data),
    notes: formatted.length === 48 ? [] : ['team_count_not_48'],
  };
}

function buildRegionOutput(data, region, teams, rawArgs) {
  if (!region) {
    return {
      query_type: 'team_region',
      matched_script: SCRIPT_NAME,
      normalized_query: rawArgs,
      filters: { region: rawArgs || null },
      result: null,
      source: baseSource(data),
      notes: ['invalid_region'],
    };
  }

  const formatted = teams.map(formatTeam);
  return {
    query_type: 'team_region',
    matched_script: SCRIPT_NAME,
    normalized_query: rawArgs,
    filters: { region, keyword: null },
    result: {
      region,
      label: data?.regions?.[region]?.label || region,
      total: formatted.length,
      teams: formatted,
    },
    source: baseSource(data),
    notes: formatted.length ? [] : ['no_teams_matched'],
  };
}

function buildFindOutput(data, query, matched) {
  const formatted = matched.map(formatTeam);
  return {
    query_type: 'team_find',
    matched_script: SCRIPT_NAME,
    normalized_query: query,
    filters: { keyword: query || null },
    result: formatted.length === 1
      ? formatted[0]
      : {
          total: formatted.length,
          teams: formatted,
        },
    source: baseSource(data),
    notes: formatted.length === 0 ? ['no_teams_matched'] : formatted.length > 1 ? ['multiple_teams_matched'] : [],
  };
}

function buildSearchOutput(data, query, matched) {
  const formatted = matched.map(formatTeam);
  return {
    query_type: 'team_search',
    matched_script: SCRIPT_NAME,
    normalized_query: query,
    filters: { keyword: query || null },
    result: formatted.length
      ? {
          total: formatted.length,
          teams: formatted,
        }
      : null,
    source: baseSource(data),
    notes: formatted.length ? [] : ['no_teams_matched'],
  };
}

function buildInfoOutput(data, teams) {
  const regionSummary = REGION_KEYS.map((region) => ({
    region,
    label: data?.regions?.[region]?.label || region,
    total: Array.isArray(data?.regions?.[region]?.teams) ? data.regions[region].teams.length : 0,
  }));

  return {
    query_type: 'team_info',
    matched_script: SCRIPT_NAME,
    normalized_query: 'info',
    filters: {},
    result: {
      version: data.version || null,
      updated_at: data.updated_at || null,
      scope: data.scope || null,
      regions: regionSummary,
      total_regions: regionSummary.length,
      total_teams: teams.length,
      source_strategy: data.source_strategy || null,
    },
    source: baseSource(data),
    notes: teams.length === 48 ? [] : ['team_count_not_48'],
  };
}

function main() {
  const args = process.argv.slice(2);
  const command = normalize(args[0] || 'list');
  const rest = args.slice(1).join(' ').trim();
  const rawInput = args.join(' ').trim();

  const data = loadTeams();
  const allTeams = flattenTeams(data);

  if (!args.length || command === 'list') {
    print(buildListOutput(data, sortTeams(allTeams), rawInput));
    return;
  }

  if (command === 'region') {
    const region = normalizeRegion(rest);
    const teams = region ? sortTeams(allTeams.filter((team) => team.region === region)) : [];
    print(buildRegionOutput(data, region, teams, rest));
    return;
  }

  if (command === 'find') {
    const matched = findTeams(allTeams, rest);
    print(buildFindOutput(data, rest, matched));
    return;
  }

  if (command === 'search') {
    const matched = searchTeams(allTeams, rest);
    print(buildSearchOutput(data, rest, matched));
    return;
  }

  if (command === 'info') {
    print(buildInfoOutput(data, allTeams));
    return;
  }

  const matched = searchTeams(allTeams, rawInput);
  print(buildSearchOutput(data, rawInput, matched));
}

main();
