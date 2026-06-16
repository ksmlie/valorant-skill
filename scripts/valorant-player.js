#!/usr/bin/env node

/**
 * Valorant player detail query script.
 *
 * Query priority:
 * 1. Direct VLR player URL
 * 2. Direct VLR player ID
 * 3. Optional local data/players.json lookup for aliases already stored locally
 */

const fs = require('fs');
const path = require('path');

const httpClient = require('./http-client');
const VLR_BASE = httpClient.VLR_BASE;
const fetchHtmlWithCache = httpClient.fetchHtmlWithCache;
const getResultCache = httpClient.getResultCache;
const getResultCacheAnyAge = httpClient.getResultCacheAnyAge;
const setResultCache = httpClient.setResultCache;
const buildDegradedMeta = httpClient.buildDegradedMeta;

const SCRIPT_NAME = 'scripts/valorant-player.js';
const DEFAULT_TIMESPAN = '90d';
const TEAM_REGIONS = ['AMERICAS', 'EMEA', 'PACIFIC', 'CHINA'];
const PLAYER_RESULT_CACHE_TTL_MS = 10 * 60 * 1000;
const PLAYER_RESULT_STALE_TTL_MS = 12 * 60 * 60 * 1000;

function loadPlayersSafe() {
  const file = path.join(__dirname, '..', 'data', 'players.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { version: null, updated_at: null, players: [] };
  }
}

function loadTeamsSafe() {
  const file = path.join(__dirname, '..', 'data', 'teams.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { version: null, updated_at: null, regions: {} };
  }
}

function normalize(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compact(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function normalizeNationality(value) {
  const text = compact(value)
    .replace(/^@[a-z0-9_.-]+\s+/i, '')
    .replace(/^(?:twitch|youtube|instagram|x|twitter)\S*\s+/i, '')
    .trim();
  if (!text) return null;
  if (/^taiwan$/i.test(text)) return 'China';
  if (/^hong\s*kong$/i.test(text) || /^hongkong$/i.test(text)) return 'China';
  return text;
}

function extractNationalityFromText(pageText) {
  const text = compact(pageText);
  if (!text) return null;

  const prefix = compact((text.match(/(.{0,200})\s+Overview\b/i)?.[1] || '').replace(/https?:\/\/\S+/gi, ' '));
  if (!prefix) return null;

  const knownNationalities = [
    'UNITED KINGDOM',
    'UNITED STATES',
    'SOUTH KOREA',
    'NORTH KOREA',
    'NEW ZEALAND',
    'SAUDI ARABIA',
    'COSTA RICA',
    'PUERTO RICO',
    'HONG KONG',
    'TAIWAN',
  ];

  const upperPrefix = prefix.toUpperCase();
  const knownMatch = knownNationalities.find((name) => upperPrefix.endsWith(name));
  if (knownMatch) return knownMatch;

  const genericMatch = prefix.match(/([A-Z][A-Z]+(?:\s+[A-Z][A-Z]+)*)\s*$/);
  if (genericMatch?.[1]) return compact(genericMatch[1]);

  return null;
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html) {
  return compact(
    decodeHtml(
      String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    )
  );
}

function toAbsoluteVlrUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${VLR_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
}

function slugify(text) {
  return normalize(text).replace(/\s+/g, '-');
}

function flattenTeams(data) {
  return TEAM_REGIONS.flatMap((region) => {
    const teams = Array.isArray(data?.regions?.[region]?.teams) ? data.regions[region].teams : [];
    return teams.map((team) => ({ ...team, region: team.region || region }));
  });
}

function findTeamByUrlOrName(teamUrl, teamName, teams) {
  const absoluteUrl = toAbsoluteVlrUrl(teamUrl || '');
  const teamIdFromUrl = Number(String(absoluteUrl || '').match(/\/team\/(\d+)/i)?.[1] || 0) || null;
  const normalizedName = normalize(teamName);
  const slugName = slugify(teamName);

  return (
    teams.find((team) => Number(team.vlr_team_id) && teamIdFromUrl && Number(team.vlr_team_id) === teamIdFromUrl) ||
    teams.find((team) => normalize(team.name) === normalizedName) ||
    teams.find((team) => normalize(team.short_name) === normalizedName) ||
    teams.find((team) => (team.aliases || []).some((alias) => normalize(alias) === normalizedName)) ||
    teams.find((team) => absoluteUrl && team.vlr_url === absoluteUrl) ||
    teams.find((team) => slugName && team.id === slugName) ||
    null
  );
}

function inferPlayerStatus(playerUrl, team) {
  const absolutePlayerUrl = toAbsoluteVlrUrl(playerUrl || '');
  const playerIdFromUrl = Number(String(absolutePlayerUrl || '').match(/\/player\/(\d+)/i)?.[1] || 0) || null;
  const roster = Array.isArray(team?.current_roster) ? team.current_roster : [];

  if (!roster.length) return null;
  if (playerIdFromUrl && roster.some((id) => Number(id) === playerIdFromUrl)) return 'active';

  const playerSlug = String(absolutePlayerUrl || '').match(/\/player\/\d+\/([^/?#]+)/i)?.[1] || null;
  if (playerSlug && roster.includes(playerSlug)) return 'active';

  return null;
}

async function fetchUrl(url, options = {}) {
  const response = await fetchHtmlWithCache(url, {
    cacheTtlMs: options.cacheTtlMs ?? 5 * 60 * 1000,
    staleTtlMs: options.staleTtlMs ?? 12 * 60 * 60 * 1000,
    retries: options.retries ?? 3,
    referer: options.referer || VLR_BASE,
    throttle: options.throttle,
    timeoutMs: options.timeoutMs ?? 15000,
  });
  return response;
}

function buildPlayerUrl(playerIdOrUrl) {
  const raw = String(playerIdOrUrl || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `${VLR_BASE}/player/${raw}`;
  return null;
}

function buildStatsUrl(vlrUrl, timespan = DEFAULT_TIMESPAN) {
  if (!vlrUrl) return null;
  const separator = vlrUrl.includes('?') ? '&' : '?';
  return `${vlrUrl}${separator}timespan=${encodeURIComponent(timespan)}`;
}

function matchPlayer(player, q) {
  const names = [player.id, player.name, player.short_name, ...(player.aliases || []), player.team_name].map(normalize);
  return names.some((name) => name && (name === q || name.includes(q) || q.includes(name)));
}

function resolvePlayerFromLocalIndex(query, players) {
  const q = normalize(query);
  if (!q) return { matched: [], selected: null };

  const matched = players.filter((player) => matchPlayer(player, q));
  const exact = matched.find((player) =>
    [player.id, player.name, player.short_name, ...(player.aliases || [])]
      .map(normalize)
      .some((name) => name === q)
  );

  return {
    matched,
    selected: exact || matched[0] || null,
  };
}

function resolveQuery(query, players) {
  const raw = String(query || '').trim();
  if (!raw) {
    return { mode: 'empty', url: null, matched: [], selected: null, playerId: null };
  }

  const directUrl = buildPlayerUrl(raw);
  if (directUrl) {
    const playerId = Number(String(directUrl).match(/\/player\/(\d+)/i)?.[1] || 0) || null;
    return {
      mode: /^https?:\/\//i.test(raw) ? 'direct_url' : 'direct_id',
      url: directUrl,
      matched: [],
      selected: null,
      playerId,
    };
  }

  const local = resolvePlayerFromLocalIndex(raw, players);
  if (local.selected?.vlr_url) {
    return {
      mode: 'local_index',
      url: local.selected.vlr_url,
      matched: local.matched,
      selected: local.selected,
      playerId: Number(local.selected.vlr_player_id) || Number(String(local.selected.vlr_url).match(/\/player\/(\d+)/i)?.[1] || 0) || null,
    };
  }

  return {
    mode: 'unresolved_keyword',
    url: null,
    matched: local.matched,
    selected: local.selected,
    playerId: null,
  };
}

function extractTitle(html) {
  return stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
    .replace(/\s*\|\s*VLR\.gg\s*$/i, '')
    .replace(/\s*-\s*VLR\.gg\s*$/i, '')
    .trim();
}

function parsePlayerHeader(html, fallback = {}, teams = []) {
  const title = extractTitle(html);
  const metaDescription = decodeHtml(html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)?.[1] || '');
  const pageText = stripTags(html);
  const headerText = compact(
    decodeHtml(
      html.match(/<div[^>]+class="wf-title-block"[\s\S]*?<div[^>]+class="text"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || ''
    )
  );

  const displayedName = compact(
    metaDescription.match(/^(.*?):\s*Valorant player/i)?.[1] ||
    metaDescription.match(/^(.*?)\s*\(/)?.[1] ||
    headerText.split('\n')[0] ||
    title.replace(/:\s*Valorant Player Profile$/i, '') ||
    fallback.name ||
    fallback.short_name ||
    ''
  ) || null;

  const pageIdentityMatch = displayedName
    ? pageText.match(
        new RegExp(
          `${displayedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s+(.+?)\s+(?:TAIWAN|HONG\s*KONG|UNITED\s+KINGDOM|UNITED\s+STATES|SOUTH\s+KOREA|NORTH\s+KOREA|NEW\s+ZEALAND|SAUDI\s+ARABIA|COSTA\s+RICA|PUERTO\s+RICO|[A-Z][A-Z]+(?:\s+[A-Z][A-Z]+)*)\s+Overview`,
          'i'
        )
      )
    : null;
  const realName = compact(
    pageIdentityMatch?.[1] ||
    metaDescription.match(/^[^(]+\((.*?)\)\s*Valorant player/i)?.[1] ||
    headerText.match(/\n([^(\n]+)\s*\(([^\n]+)\)\n/)?.[2] ||
    ''
  ) || null;
  const aliases = Array.from(
    new Set(
      [
        displayedName,
        realName,
        ...(headerText
          .split(/\n|\r/)
          .map((line) => compact(line).replace(/\s*\(.*\)\s*$/, ''))
          .filter(Boolean)),
        ...(fallback.aliases || []),
      ].filter(Boolean)
    )
  );
  const rawNationality = compact(decodeHtml(html.match(/<i[^>]+class="flag[^>]*"[^>]+title="([^"]+)"/i)?.[1] || ''));
  const inlineNationality = extractNationalityFromText(pageText);
  const nationality = normalizeNationality(rawNationality || inlineNationality || fallback.nationality || null);

  const teamUrl = toAbsoluteVlrUrl(html.match(/Current Teams[\s\S]*?<a[^>]+href="(\/team\/\d+\/[^"#?]+)"/i)?.[1] || '') || fallback.team_url || null;
  const teamName =
    compact(stripTags(html.match(/Current Teams[\s\S]*?<a[^>]+href="\/team\/\d+\/[^"#?]+"[^>]*>([\s\S]*?)<\/a>/i)?.[1] || ''))
      .replace(/\s+joined in\s+[A-Za-z]+\s+\d{4}$/i, '') ||
    fallback.team_name ||
    null;
  const vlrUrl = toAbsoluteVlrUrl(html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1] || fallback.vlr_url || '') || fallback.vlr_url || null;
  const vlrPlayerId = Number(String(vlrUrl || '').match(/\/player\/(\d+)/i)?.[1] || fallback.vlr_player_id || 0) || null;

  let age = fallback.age ?? null;
  const ageMatch = pageText.match(/\b(\d{1,2})\s*yrs?\b/i) || pageText.match(/\bage\s*(\d{1,2})\b/i);
  if (ageMatch) age = Number(ageMatch[1]);

  const matchedTeam = findTeamByUrlOrName(teamUrl, teamName, teams);
  const inferredStatus = inferPlayerStatus(vlrUrl, matchedTeam);

  return {
    id: fallback.id || (displayedName ? normalize(displayedName).replace(/\s+/g, '-') : null),
    name: displayedName,
    short_name: fallback.short_name || displayedName || null,
    aliases,
    nationality,
    age: Number.isFinite(age) ? age : null,
    team_id: matchedTeam?.id || fallback.team_id || null,
    team_name: matchedTeam?.name || teamName,
    region: matchedTeam?.region || fallback.region || null,
    vlr_url: vlrUrl,
    vlr_player_id: vlrPlayerId,
    status: inferredStatus || fallback.status || null,
    real_name: realName,
    team_url: matchedTeam?.vlr_url || teamUrl,
    source_page_title: title || null,
  };
}

function splitStatRow(line) {
  const text = compact(String(line || '').replace(/-->+/g, ' '));
  if (!text) return null;

  const tokens = text.split(' ');
  if (tokens.length < 17) return null;
  const useIndex = tokens.findIndex((token) => /^\(\d+\)$/.test(token));
  if (useIndex !== 0) return null;

  const numberOrNull = (value) => {
    const n = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  const values = tokens.slice(1, 17);
  if (values.length < 16) return null;

  return {
    agent: '',
    use: `${tokens[0]} ${tokens[1]}`,
    rnd: numberOrNull(values[1]),
    rating: numberOrNull(values[2]),
    acs: numberOrNull(values[3]),
    k_d: numberOrNull(values[4]),
    adr: numberOrNull(values[5]),
    kast: values[6] || null,
    kpr: numberOrNull(values[7]),
    apr: numberOrNull(values[8]),
    fkpr: numberOrNull(values[9]),
    fdpr: numberOrNull(values[10]),
    kills: numberOrNull(values[11]),
    deaths: numberOrNull(values[12]),
    assists: numberOrNull(values[13]),
    fk: numberOrNull(values[14]),
    fd: numberOrNull(values[15]),
  };
}

function parseStats(html, timespan = DEFAULT_TIMESPAN) {
  const text = stripTags(html);
  const start = text.indexOf('Agents');
  if (start < 0) return { timespan, by_agent: [] };

  const slice = text.slice(start, start + 7000);
  const stopCandidates = [
    slice.indexOf('Recent Results'),
    slice.indexOf('Latest News'),
    slice.indexOf('Event Placements'),
    slice.indexOf('Past Teams'),
    slice.indexOf('Current Teams'),
    slice.indexOf('Latest Results'),
    slice.indexOf('Match History'),
  ].filter((index) => index > 0);
  const stopIndex = stopCandidates.length ? Math.min(...stopCandidates) : slice.length;
  const block = compact(slice.slice(0, stopIndex).replace(/-->+/g, ' --> '));

  const segments = [];
  const rowStartRegex = /\(\d+\)\s+\d+%\s+/g;
  let rowStart;
  const startIndexes = [];
  while ((rowStart = rowStartRegex.exec(block))) {
    startIndexes.push(rowStart.index);
  }

  startIndexes.forEach((index, idx) => {
    const end = idx + 1 < startIndexes.length ? startIndexes[idx + 1] : block.length;
    const segment = compact(block.slice(index, end).replace(/-->+/g, ' '));
    if (/^\(\d+\)\s+\d+%\s+/.test(segment)) segments.push(segment);
  });

  const byAgent = segments.map(splitStatRow).filter(Boolean);

  return {
    timespan,
    by_agent: byAgent,
  };
}

function buildInfoResult(playerHeader) {
  return {
    player_profile: playerHeader,
    team: playerHeader.team_name
      ? {
          team_id: playerHeader.team_id,
          team_name: playerHeader.team_name,
          team_url: playerHeader.team_url || null,
          region: playerHeader.region,
        }
      : null,
    role: null,
    recent_results: [],
    recent_form: null,
    notes: [],
  };
}

function buildStatsResult(playerHeader, stats) {
  return {
    player_id: playerHeader.id,
    player_name: playerHeader.name,
    vlr_player_id: playerHeader.vlr_player_id,
    timespan: stats.timespan,
    by_agent: stats.by_agent,
  };
}

function buildDetailResult(info, stats) {
  return { info, stats };
}

function usage() {
  return {
    query_type: 'player_usage',
    matched_script: SCRIPT_NAME,
    commands: [
      'node scripts/valorant-player.js info <playerKeyword|vlrPlayerId|vlrPlayerUrl>',
      'node scripts/valorant-player.js stats <playerKeyword|vlrPlayerId|vlrPlayerUrl> [timespan]',
      'node scripts/valorant-player.js detail <playerKeyword|vlrPlayerId|vlrPlayerUrl> [tab]',
      'node scripts/valorant-player.js <playerKeyword|vlrPlayerId|vlrPlayerUrl>',
    ],
    result: { status: 'usage' },
    notes: ['default_timespan_90d', 'direct_vlr_url_and_player_id_supported'],
  };
}

function notFound(command, query, reason, extra = {}) {
  return {
    query_type: `player_${command}`,
    matched_script: SCRIPT_NAME,
    normalized_query: query,
    filters: {
      command,
      player_keyword: query || null,
      timespan: extra.timespan || null,
    },
    result: {
      found: false,
      status: extra.status || 'not_found',
      reason,
      stale: Boolean(extra.stale),
      degraded: Boolean(extra.degraded),
      data: extra.data || null,
    },
    source: {
      type: extra.sourceType || 'vlr_player_page',
      file: extra.file || 'data/players.json',
      url: extra.url || null,
      stats_url: extra.statsUrl || null,
      degrade_meta: extra.degradeMeta || null,
    },
    notes: extra.notes?.length ? extra.notes : [reason],
  };
}

async function run(command, query, arg3) {
  if (!query) return usage();

  const data = loadPlayersSafe();
  const teamsData = loadTeamsSafe();
  const players = data.players || [];
  const teams = flattenTeams(teamsData);
  const resolved = resolveQuery(query, players);
  if (!resolved.url) {
    return {
      query_type: `player_${command}`,
      matched_script: SCRIPT_NAME,
      normalized_query: query,
      filters: {
        command,
        player_keyword: query || null,
        timespan: null,
      },
      result: {
        found: false,
        status: 'not_found',
        reason: 'player_keyword_requires_vlr_player_id_or_url_when_not_in_local_index',
        hint: '请使用选手id或VLR选手URL进行查询',
      },
      source: {
        type: 'local_index + vlr_player_page',
        file: 'data/players.json',
        url: null,
        stats_url: null,
      },
      notes: [
        'direct_vlr_url_and_numeric_player_id_supported',
        'keyword_search_without_local_index_is_not_supported',
      ],
    };
  }

  const detailTab = command === 'detail' ? arg3 || 'all' : null;
  const timespan = command === 'stats' ? arg3 || DEFAULT_TIMESPAN : DEFAULT_TIMESPAN;
  const infoUrl = resolved.url;
  const statsUrl = buildStatsUrl(infoUrl, timespan);
  const cacheKey = JSON.stringify({ command, query, arg3: arg3 || null, resolvedUrl: infoUrl, timespan, detailTab });
  const cached = getResultCache('player', cacheKey, PLAYER_RESULT_CACHE_TTL_MS);
  if (cached?.value) return cached.value;

  const staleCached = getResultCacheAnyAge('player', cacheKey);

  try {
    const [infoResponse, statsResponse] = await Promise.all([
      fetchUrl(infoUrl, { referer: VLR_BASE }),
      fetchUrl(statsUrl, { referer: infoUrl }),
    ]);
    const playerHeader = parsePlayerHeader(
      infoResponse.body,
      resolved.selected || { vlr_url: infoUrl, vlr_player_id: resolved.playerId },
      teams
    );
    const info = buildInfoResult(playerHeader);
    const stats = buildStatsResult(playerHeader, parseStats(statsResponse.body, timespan));
    const detail = buildDetailResult(info, stats);

    let resultData = info;
    if (command === 'stats') resultData = stats;
    if (command === 'detail') {
      resultData = detailTab === 'info' ? info : detailTab === 'stats' ? stats : detail;
    }

    const notes = ['only_vlr_visible_page_data_used'];
    if (resolved.mode === 'direct_url') notes.unshift('player_resolved_by_direct_vlr_url');
    if (resolved.mode === 'direct_id') notes.unshift('player_resolved_by_direct_vlr_player_id');
    if (resolved.mode === 'local_index') notes.unshift('player_resolved_by_local_index_then_fetched_from_vlr');
    if (resolved.matched.length > 1) notes.unshift('multiple_players_matched_local_index');
    if (infoResponse.degraded || statsResponse.degraded) notes.unshift('stale_html_cache_used_for_partial_live_recovery');

    const output = {
      query_type: `player_${command}`,
      matched_script: SCRIPT_NAME,
      normalized_query: query,
      filters: {
        command,
        player_keyword: query,
        timespan: command === 'stats' || command === 'detail' ? timespan : null,
      },
      result: {
        found: true,
        matched_count: resolved.mode === 'local_index' ? resolved.matched.length : null,
        status: infoResponse.degraded || statsResponse.degraded ? 'resolved_stale' : 'resolved',
        stale: Boolean(infoResponse.degraded || statsResponse.degraded),
        degraded: Boolean(infoResponse.degraded || statsResponse.degraded),
        data: resultData,
      },
      source: {
        type: resolved.mode === 'local_index' ? 'vlr_player_page + optional_local_index' : 'vlr_player_page',
        file: 'data/players.json',
        version: data.version || null,
        updated_at: data.updated_at || null,
        url: playerHeader.vlr_url || infoUrl,
        stats_url: statsUrl,
        resolve_mode: resolved.mode,
        html_cache: {
          info: infoResponse.cache,
          stats: statsResponse.cache,
        },
      },
      notes,
    };

    setResultCache('player', cacheKey, output, {
      query,
      command,
      timespan,
      detail_tab: detailTab,
      stale: Boolean(output.result.stale),
    });

    return output;
  } catch (error) {
    if (staleCached?.value && Date.now() - Date.parse(staleCached.cached_at || 0) <= PLAYER_RESULT_STALE_TTL_MS) {
      const fallback = {
        ...staleCached.value,
        result: {
          ...(staleCached.value.result || {}),
          status: 'resolved_stale',
          stale: true,
          degraded: true,
        },
        source: {
          ...(staleCached.value.source || {}),
          degrade_meta: buildDegradedMeta('player', cacheKey, { url: infoUrl, stats_url: statsUrl }, staleCached, error),
        },
        notes: Array.from(new Set([...(staleCached.value.notes || []), 'result_cache_stale_fallback_used', String(error.message || error)])),
      };
      return fallback;
    }

    return notFound(command, query, 'vlr_player_page_unavailable_or_not_found', {
      timespan: command === 'stats' || command === 'detail' ? timespan : null,
      sourceType: resolved.mode === 'local_index' ? 'vlr_player_page + optional_local_index' : 'vlr_player_page',
      url: infoUrl,
      statsUrl,
      status: 'upstream_unavailable',
      degraded: false,
      stale: false,
      degradeMeta: buildDegradedMeta('player', cacheKey, { url: infoUrl, stats_url: statsUrl }, staleCached, error),
      notes: [String(error.message || error)],
    });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = ['info', 'stats', 'detail'].includes(args[0]) ? args[0] : 'info';
  const query = ['info', 'stats', 'detail'].includes(args[0]) ? args[1] : args[0];
  const arg3 = ['info', 'stats', 'detail'].includes(args[0]) ? args[2] : args[1];
  const output = await run(command, query, arg3);
  console.log(JSON.stringify(output, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.log(JSON.stringify(notFound('info', process.argv.slice(2).join(' '), 'unexpected_error', { notes: [String(error.message || error)] }), null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  fetchUrl,
  buildPlayerUrl,
  buildStatsUrl,
  parsePlayerHeader,
  parseStats,
  resolveQuery,
  run,
};