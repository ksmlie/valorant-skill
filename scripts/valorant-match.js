#!/usr/bin/env node

/**
 * Valorant match detail query script.
 *
 * Data source: VLR.gg public match pages only.
 * Static links:
 * - event_id maps to data/events.json id
 * - team_a.id / team_b.id map to data/teams.json id
 * - player ids, when detected in page links, map to data/players.json id
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

const SCRIPT_NAME = 'scripts/valorant-match.js';
const KNOWN_MAPS = ['Ascent', 'Bind', 'Breeze', 'Fracture', 'Haven', 'Icebox', 'Lotus', 'Pearl', 'Split', 'Sunset', 'Abyss', 'Corrode'];
const PLAYER_CACHE_FILE = path.join(__dirname, '..', 'data', 'player-page-cache.json');
const PLAYER_PAGE_CACHE_VERSION = 1;
const MATCH_RESULT_CACHE_VERSION = 2;
const MATCH_RESULT_CACHE_TTL_MS = 10 * 60 * 1000;
const MATCH_RESULT_STALE_TTL_MS = 12 * 60 * 60 * 1000;
const playerPageRequestCache = new Map();
let playerPageDiskCache = null;

function loadJSON(filename, fallback) {
  const file = path.join(__dirname, '..', 'data', filename);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function flattenTeams(regions) {
  return Object.values(regions || {}).flatMap((region) => region.teams || []);
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

function extractHeaderLines(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '\n')
    .split(/\r?\n/)
    .map((line) => compact(decodeHtml(line)))
    .filter(Boolean);
}

function extractHeaderMeta(html) {
  const text = decodeHtml(String(html || '').replace(/<br\s*\/?>/gi, '\n'));
  const lines = text
    .split(/\r?\n/)
    .map((line) => compact(line))
    .filter(Boolean);

  return {
    nationality: normalizeNationality(lines.find((line) => /^(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*|TAIWAN|HONG\s*KONG|UNITED\s+KINGDOM|UNITED\s+STATES|SOUTH\s+KOREA|NORTH\s+KOREA|NEW\s+ZEALAND|SAUDI\s+ARABIA|COSTA\s+RICA|PUERTO\s+RICO)$/i.test(line)) || null),
    handle: lines.find((line) => /^@/.test(line) || /^(?:x\.com|twitter\.com|twitch\.tv|youtube\.com|instagram\.com)\//i.test(line)) || null,
  };
}

function normalizeNationality(value) {
  const text = compact(value);
  if (!text) return null;
  if (/^taiwan$/i.test(text)) return 'China';
  if (/^hong\s*kong$/i.test(text) || /^hongkong$/i.test(text)) return 'China';
  return text;
}

function extractNationalityFromText(text) {
  const candidates = String(text || '')
    .split(/\r?\n/)
    .map((line) => compact(line).toUpperCase())
    .filter(Boolean);

  const blocked = new Set(['OVERVIEW', 'MATCH HISTORY', 'PAST', 'AGENTS', 'RECENT RESULTS', 'LATEST NEWS', 'EVENT PLACEMENTS']);
  const multiWordCountries = [
    'UNITED KINGDOM',
    'UNITED STATES',
    'SOUTH KOREA',
    'NORTH KOREA',
    'NEW ZEALAND',
    'SAUDI ARABIA',
    'COSTA RICA',
    'PUERTO RICO',
    'HONG KONG',
  ];

  for (const line of candidates) {
    if (blocked.has(line)) continue;
    if (line.startsWith('@')) continue;
    if (/^[A-Z0-9_.-]+$/.test(line) && !line.includes(' ')) continue;
    if (/^(?:X\.COM|TWITCH\.TV|YOUTUBE\.COM|INSTAGRAM\.COM)\//.test(line)) continue;
    if (multiWordCountries.includes(line)) return line;
    if (/^[A-Z][A-Z]+(?:\s+[A-Z][A-Z]+)*$/.test(line) && line.length >= 4 && line.length <= 32) return line;
  }

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

function buildMatchUrl(matchIdOrUrl) {
  const raw = String(matchIdOrUrl || '').trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const id = raw.match(/\d+/)?.[0];
  return id ? `${VLR_BASE}/${id}` : null;
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

function loadPlayerPageCache() {
  if (playerPageDiskCache) return playerPageDiskCache;

  try {
    const raw = JSON.parse(fs.readFileSync(PLAYER_CACHE_FILE, 'utf8'));
    const entries = raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object' ? raw.entries : {};
    playerPageDiskCache = {
      version: raw?.version || PLAYER_PAGE_CACHE_VERSION,
      updated_at: raw?.updated_at || null,
      entries,
    };
  } catch (error) {
    playerPageDiskCache = {
      version: PLAYER_PAGE_CACHE_VERSION,
      updated_at: null,
      entries: {},
    };
  }

  return playerPageDiskCache;
}

function getCachedPlayerPageContext(vlrUrl) {
  if (!vlrUrl) return null;
  const cache = loadPlayerPageCache();
  const entry = cache.entries[vlrUrl];
  if (!entry || typeof entry !== 'object') return null;
  return {
    nationality: normalizeNationality(entry.nationality || null),
    status: entry.status || null,
    aliases: Array.isArray(entry.aliases) ? entry.aliases.filter(Boolean) : [],
  };
}

function setCachedPlayerPageContext(vlrUrl, context) {
  if (!vlrUrl || !context) return;
  const cache = loadPlayerPageCache();
  cache.entries[vlrUrl] = {
    nationality: normalizeNationality(context.nationality || null),
    status: context.status || null,
    aliases: Array.from(new Set((context.aliases || []).filter(Boolean))),
    cached_at: new Date().toISOString(),
  };
  cache.updated_at = new Date().toISOString();

  try {
    fs.writeFileSync(PLAYER_CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  } catch (error) {
    // ignore cache write failures and continue with live data
  }
}

function findTeamByName(name, teams) {
  const q = normalize(name);
  if (!q) return null;

  return (
    teams.find((team) => normalize(team.name) === q || normalize(team.short_name) === q) ||
    teams.find((team) => (team.aliases || []).some((alias) => normalize(alias) === q)) ||
    teams.find((team) => normalize(team.name).includes(q) || q.includes(normalize(team.name))) ||
    null
  );
}

function findEventByText(text, events) {
  const q = normalize(text);
  if (!q) return null;

  return (
    events.find((event) => normalize(event.name) === q || normalize(event.short_name) === q) ||
    events.find((event) => (event.aliases || []).some((alias) => normalize(alias) === q)) ||
    events.find((event) => q.includes(normalize(event.name)) || normalize(event.name).includes(q)) ||
    null
  );
}

function findPlayerByVlrId(vlrPlayerId, players) {
  const id = Number(vlrPlayerId);
  return players.find((player) => Number(player.vlr_player_id) === id) || null;
}

function findPlayerBySlug(slug, players) {
  const q = normalize(slug);
  if (!q) return null;
  return players.find((player) => normalize(player.id) === q || normalize(player.name) === q || normalize(player.short_name) === q || (player.aliases || []).some((alias) => normalize(alias) === q)) || null;
}

function parseMatchId(url) {
  return Number(String(url || '').match(/vlr\.gg\/(\d+)/i)?.[1] || String(url || '').match(/\/(\d+)/)?.[1] || 0) || null;
}

function parseTitle(html) {
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  return title.replace(/\s*\|\s*VLR\.gg\s*$/i, '').replace(/\s*-\s*VLR\.gg\s*$/i, '').trim();
}

function parseStatus(text) {
  const q = normalize(text);
  if (q.includes('final') || q.includes('completed')) return 'finished';
  if (q.includes('live') || q.includes('ongoing')) return 'live';
  if (q.includes('upcoming') || q.includes('scheduled')) return 'upcoming';
  return 'unknown';
}

function parseTeamsFromLinks(html, teams) {
  const found = [];
  const re = /<a[^>]+href="\/team\/(\d+)\/([^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    const vlrTeamId = Number(match[1]);
    const slug = match[2];
    const visibleName = stripTags(match[3]) || slug.replace(/-/g, ' ');
    const known = teams.find((team) => Number(team.vlr_team_id) === vlrTeamId) || findTeamByName(visibleName, teams) || teams.find((team) => normalize(team.vlr_url || '').includes(`/${slug}`));
    const item = {
      id: known?.id || null,
      name: known?.name || visibleName,
      short_name: known?.short_name || null,
      region: known?.region || null,
      aliases: known?.aliases || [],
      vlr_team_id: vlrTeamId,
      vlr_url: `${VLR_BASE}/team/${vlrTeamId}/${slug}`,
      score: null,
      result: null,
    };
    if (!found.some((team) => team.vlr_team_id === vlrTeamId || (team.id && team.id === item.id))) {
      found.push(item);
    }
  }
  return found.slice(0, 2);
}

function parseTeamsFromTitle(title, teams) {
  const parts = String(title || '')
    .split(/\s+vs\.?\s+|\s+v\s+/i)
    .map(compact)
    .filter(Boolean);
  if (parts.length < 2) return [];
  return parts.slice(0, 2).map((name) => {
    const known = findTeamByName(name, teams);
    return {
      id: known?.id || null,
      name: known?.name || name,
      short_name: known?.short_name || null,
      vlr_team_id: known?.vlr_team_id || null,
      vlr_url: known?.vlr_url || null,
      score: null,
      result: null,
    };
  });
}

function parseHeaderScore(html, teamA, teamB) {
  const text = stripTags(html);
  const teamAName = teamA?.name ? teamA.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null;
  const teamBName = teamB?.name ? teamB.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null;
  if (teamAName && teamBName) {
    const direct = text.match(new RegExp(`${teamAName}\\s+final\\s+(\\d+)\\s*:\\s*(\\d+)\\s+vs\\.\\s+Bo\\d+\\s+${teamBName}`, 'i'));
    if (direct) return { team_a: Number(direct[1]), team_b: Number(direct[2]), text: `${Number(direct[1])}-${Number(direct[2])}` };
  }

  const finalMatch = text.match(/\bfinal\s+(\d+)\s*:\s*(\d+)\s+vs\.\s+Bo\d+/i);
  if (finalMatch) return { team_a: Number(finalMatch[1]), team_b: Number(finalMatch[2]), text: `${Number(finalMatch[1])}-${Number(finalMatch[2])}` };

  const upcomingMatch = text.match(/\bupcoming\s+(\d+)\s*:\s*(\d+)\s+vs\.\s+Bo\d+/i);
  if (upcomingMatch) return { team_a: Number(upcomingMatch[1]), team_b: Number(upcomingMatch[2]), text: `${Number(upcomingMatch[1])}-${Number(upcomingMatch[2])}` };

  return { team_a: null, team_b: null, text: null };
}

function parseEvent(html, title, events) {
  const eventLinks = [];
  const re = /<a[^>]+href="(\/event\/(\d+)\/[^"#?]+(?:\/[^"#?]+)?)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    eventLinks.push({ url: toAbsoluteVlrUrl(match[1]), vlr_event_id: Number(match[2]), text: stripTags(match[3]) });
  }

  const linked = eventLinks.find((link) => events.some((event) => Number(event.vlr_event_id) === link.vlr_event_id));
  const known = linked ? events.find((event) => Number(event.vlr_event_id) === linked.vlr_event_id) : findEventByText(title, events);
  const first = linked || eventLinks[0] || null;

  return {
    event_id: known?.id || null,
    event_name: known?.name || first?.text || null,
    event_url: known?.vlr_url || first?.url || null,
    vlr_event_id: known?.vlr_event_id || first?.vlr_event_id || null,
  };
}

function parseStage(html, event) {
  if (!event?.event_url) return null;
  const escaped = event.event_url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/^https:\/\/www\.vlr\.gg/, '');
  const re = new RegExp(`<a[^>]+href="(${escaped}/[^"#?]+)"[^>]*>([\\s\\S]*?)<\\/a>`, 'i');
  const match = html.match(re);
  return match ? stripTags(match[2]) : null;
}

function parseDatetime(html) {
  const datetime = html.match(/data-utc-ts="([^"]+)"/i)?.[1] || html.match(/datetime="([^"]+)"/i)?.[1] || null;
  return datetime || null;
}

function parseMaps(html) {
  const pageText = stripTags(html);
  const mapNames = [];
  const mapRegex = /\b(Ascent|Bind|Breeze|Fracture|Haven|Icebox|Lotus|Pearl|Split|Sunset|Abyss|Corrode)\b\s*(?:PICK)?\s*\d{1,2}:\d{2}/gi;
  let match;
  while ((match = mapRegex.exec(pageText))) {
    const mapName = match[1];
    if (!mapNames.includes(mapName)) mapNames.push(mapName);
  }

  if (!mapNames.length) {
    const vetoLine = pageText.match(/\b(?:pick|ban|remains)\b[\s\S]{0,240}?Maps\/Stats/i)?.[0] || '';
    const names = vetoLine.match(/\b(Ascent|Bind|Breeze|Fracture|Haven|Icebox|Lotus|Pearl|Split|Sunset|Abyss|Corrode)\b/gi) || [];
    names.forEach((name) => {
      const normalized = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
      if (!mapNames.includes(normalized)) mapNames.push(normalized);
    });
  }

  return mapNames.map((mapName, index) => ({
    field: `map_${index + 1}`,
    map_number: index + 1,
    map_name: mapName,
  }));
}

function parsePlayers(html, players) {
  const found = [];
  const re = /<a[^>]+href="\/player\/(\d+)\/([^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    const vlrPlayerId = Number(match[1]);
    const slug = match[2];
    const known = findPlayerByVlrId(vlrPlayerId, players) || findPlayerBySlug(slug, players);
    const id = known?.id || slug || null;
    if (id && !found.includes(id)) found.push(id);
  }

  const teamA = found.slice(0, 5);
  const teamB = found.slice(5, 10);
  const extras = found.slice(10);

  return {
    players: found,
    team_a_players: teamA,
    team_b_players: teamB,
    extras,
  };
}

async function fetchPlayerPageContext(vlrUrl) {
  if (!vlrUrl) return { nationality: null, status: null, aliases: [] };

  const cached = getCachedPlayerPageContext(vlrUrl);
  if (cached) return cached;

  if (!playerPageRequestCache.has(vlrUrl)) {
    playerPageRequestCache.set(
      vlrUrl,
      (async () => {
        try {
          const htmlResponse = await fetchUrl(vlrUrl, { referer: VLR_BASE });
          const html = htmlResponse.body;
          const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
            .replace(/\s*\|\s*VLR\.gg\s*$/i, '')
            .replace(/\s*-\s*VLR\.gg\s*$/i, '')
            .trim();
          const metaDescription = decodeHtml(html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)?.[1] || '');
          const pageText = stripTags(html);
          const headerBlock = html.match(/<div[^>]+class="wf-title-block"[\s\S]*?<div[^>]+class="text"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
          const headerLines = extractHeaderLines(headerBlock);
          const headerText = headerLines.join('\n');
          const headerMeta = extractHeaderMeta(headerBlock);
          const displayedName = compact(
            metaDescription.match(/^(.*?):\s*Valorant player/i)?.[1] ||
            metaDescription.match(/^(.*?)\s*\(/)?.[1] ||
            headerLines[0] ||
            title.replace(/:\s*Valorant Player Profile$/i, '') ||
            ''
          ) || null;
          const overviewIndex = headerLines.findIndex((line) => /^overview$/i.test(line));
          const infoLines = (overviewIndex >= 0 ? headerLines.slice(0, overviewIndex) : headerLines).filter(
            (line) => !displayedName || normalize(line) !== normalize(displayedName)
          );
          const rawNationality = compact(decodeHtml(html.match(/<i[^>]+class="flag[^>]*"[^>]+title="([^"]+)"/i)?.[1] || ''));
          const inlineNationality = headerMeta.nationality || extractNationalityFromText(headerText) || extractNationalityFromText(pageText);
          const nationality = normalizeNationality(rawNationality || inlineNationality || null);
          const realName =
            infoLines.find((line) => line !== nationality && line !== headerMeta.handle && !/^@/.test(line) && !/twitch\.tv\//i.test(line) && !/^https?:\/\//i.test(line)) ||
            compact(metaDescription.match(/^[^(]+\((.*?)\)\s*Valorant player/i)?.[1] || '') ||
            null;
          const hasCurrentTeam = /Current Teams/i.test(html) || /Current Roster/i.test(html) || /Current Team/i.test(pageText);
          const status = hasCurrentTeam ? 'active' : 'inactive';
          const aliases = Array.from(
            new Set(
              [displayedName, realName, ...infoLines]
                .map((line) => compact(line).replace(/\s*\(.*\)\s*$/, ''))
                .filter((line) => line && line !== nationality && line !== headerMeta.handle && !/^@/.test(line) && !/twitch\.tv\//i.test(line) && !/^https?:\/\//i.test(line))
            )
          );
          const context = { nationality, status, aliases };
          setCachedPlayerPageContext(vlrUrl, context);
          return context;
        } catch (error) {
          return { nationality: null, status: null, aliases: [] };
        } finally {
          playerPageRequestCache.delete(vlrUrl);
        }
      })()
    );
  }

  return playerPageRequestCache.get(vlrUrl);
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const text = compact(String(value)).replace(/,/g, '');
  if (!text || text === '-' || text === '—') return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function parsePercentOrText(value) {
  const text = compact(String(value || ''));
  return text || null;
}

function splitCells(rowHtml) {
  const cells = [];
  const regex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let match;
  while ((match = regex.exec(rowHtml))) {
    cells.push(match[1]);
  }
  return cells;
}

function detectMapName(text, fallbackMap) {
  const found = KNOWN_MAPS.find((mapName) => new RegExp(`\\b${mapName}\\b`, 'i').test(text));
  return found || fallbackMap?.map_name || null;
}

function enrichPlayerReference(vlrPlayerId, slug, players) {
  const known = findPlayerByVlrId(vlrPlayerId, players) || findPlayerBySlug(slug, players);
  const fallbackName = compact(slug || '').replace(/-/g, ' ');
  return {
    player_id: known?.id || slug || null,
    player_name: known?.name || fallbackName || null,
    short_name: known?.short_name || fallbackName?.toUpperCase?.() || null,
    team_id: known?.team_id || null,
    team_name: known?.team_name || null,
    vlr_player_id: Number(vlrPlayerId) || null,
    nationality: known?.nationality || null,
    region: known?.region || null,
    vlr_url: known?.vlr_url || `${VLR_BASE}/player/${vlrPlayerId}/${slug}`,
    aliases: known?.aliases || [],
    status: known?.status || null,
  };
}

function buildEmptyPlayerStat(playerRef, team) {
  return {
    player_id: playerRef?.player_id || null,
    player_name: playerRef?.player_name || null,
    short_name: playerRef?.short_name || null,
    team_id: team?.id || playerRef?.team_id || null,
    team_name: team?.name || playerRef?.team_name || null,
    vlr_player_id: playerRef?.vlr_player_id || null,
    nationality: playerRef?.nationality || null,
    region: playerRef?.region || null,
    vlr_url: playerRef?.vlr_url || null,
    aliases: playerRef?.aliases || [],
    status: playerRef?.status || null,
    agent: null,
    rating: null,
    acs: null,
    k_d: null,
    adr: null,
    kast: null,
    kpr: null,
    apr: null,
    fkpr: null,
    fdpr: null,
    kills: null,
    deaths: null,
    assists: null,
    fk: null,
    fd: null,
    hs_percent: null,
    plus_minus: null,
    source: {
      type: 'vlr_match_page',
      parser: 'players_fallback',
      confidence: 'low',
    },
  };
}

function parseMapScoreFromSection(sectionHtml) {
  const teamMatches = [...sectionHtml.matchAll(/<div[^>]+class="score[^\"]*"[^>]*>\s*(\d{1,2})\s*<\/div>/gi)].map((m) => Number(m[1]));
  if (teamMatches.length >= 2) {
    return {
      team_a_score: teamMatches[0],
      team_b_score: teamMatches[1],
    };
  }

  const text = stripTags(sectionHtml);
  const fallback = text.match(/\b(\d{1,2})\b\s+[A-Za-z][\s\S]{0,120}?\b(\d{1,2})\b/);
  if (fallback) {
    return {
      team_a_score: Number(fallback[1]),
      team_b_score: Number(fallback[2]),
    };
  }

  return null;
}

function extractOverviewTable(sectionHtml) {
  return sectionHtml.match(/<table[^>]+class="[^"]*wf-table-inset mod-overview[^"]*"[^>]*>[\s\S]*?<\/table>/i)?.[0] || '';
}

function extractOverviewTables(sectionHtml) {
  return [...sectionHtml.matchAll(/<table[^>]+class="[^"]*wf-table-inset mod-overview[^"]*"[^>]*>[\s\S]*?<\/table>/gi)].map((match) => match[0]);
}

function extractMapSectionsFromHtml(html, knownMaps) {
  const lines = html.split(/\n/);
  const sections = [];
  let current = [];
  for (const line of lines) {
    if (line.includes('vm-stats-game-header')) {
      if (current.length) sections.push(current.join('\n'));
      current = [line];
    } else if (current.length) {
      current.push(line);
      if (line.includes('Head-to-head')) {
        sections.push(current.join('\n'));
        current = [];
      }
    }
  }
  if (current.length) sections.push(current.join('\n'));

  const extracted = sections
    .map((sectionHtml) => {
      const mapName = detectMapName(stripTags(sectionHtml), null);
      if (!mapName) return null;
      return { map_name: mapName, html: sectionHtml };
    })
    .filter(Boolean);

  if (!knownMaps?.length) return extracted;

  const used = new Set();
  return knownMaps.map((map) => {
    const index = extracted.findIndex((item, idx) => !used.has(idx) && item.map_name === map.map_name);
    if (index >= 0) {
      used.add(index);
      return {
        map_name: map.map_name,
        map_number: map.map_number,
        html: extracted[index].html,
      };
    }
    return {
      map_name: map.map_name,
      map_number: map.map_number,
      html: '',
    };
  });
}

function parseHeaderColumns(sectionHtml) {
  const tableHtml = extractOverviewTable(sectionHtml) || sectionHtml;
  const headHtml = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || '';
  return splitCells(headHtml).map((cell) => compact(stripTags(cell)).replace(/–/g, '-'));
}

function normalizeHeaderKey(value) {
  const raw = compact(String(value || '')).toUpperCase().replace(/\s+/g, '');
  if (!raw) return '';
  if (raw === 'R') return 'rating';
  if (raw === 'ACS') return 'acs';
  if (raw === 'K') return 'kills';
  if (raw === 'D') return 'deaths';
  if (raw === 'A') return 'assists';
  if (raw === 'KAST') return 'kast';
  if (raw === 'ADR') return 'adr';
  if (raw === 'HS%') return 'hs_percent';
  if (raw === 'FK') return 'fk';
  if (raw === 'FD') return 'fd';
  if (raw === '+/-') return 'plus_minus';
  return raw.toLowerCase();
}

function pickBothSideValue(cellHtml) {
  const both = cellHtml.match(/<span[^>]+class="[^"]*mod-both[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1];
  if (both) return compact(stripTags(both)).replace(/–/g, '-');
  return compact(stripTags(cellHtml)).replace(/–/g, '-');
}

function parsePlayerStatRow(rowHtml, headerColumns, players) {
  const playerLink = rowHtml.match(/href="\/player\/(\d+)\/([^"#?]+)"/i);
  if (!playerLink) return null;

  const playerRef = enrichPlayerReference(playerLink[1], playerLink[2], players);
  const cells = splitCells(rowHtml);
  const cellTexts = cells.map((cell) => pickBothSideValue(cell));
  const playerName = compact(stripTags(cells[0] || '').replace(/\s+[A-Z0-9]{2,6}\s*$/, '')) || playerRef.player_name;
  const stats = buildEmptyPlayerStat(playerRef, null);

  stats.player_name = playerName;
  stats.agent = null;

  for (let index = 0; index < headerColumns.length; index += 1) {
    const key = normalizeHeaderKey(headerColumns[index]);
    const value = cellTexts[index] ?? null;
    if (!key || value === null) continue;

    if (key === 'rating') stats.rating = parseNumber(value);
    else if (key === 'acs') stats.acs = parseNumber(value);
    else if (key === 'kills') stats.kills = parseNumber(value);
    else if (key === 'deaths') stats.deaths = parseNumber(value);
    else if (key === 'assists') stats.assists = parseNumber(value);
    else if (key === 'kast') stats.kast = parsePercentOrText(value);
    else if (key === 'adr') stats.adr = parseNumber(value);
    else if (key === 'hs_percent') stats.hs_percent = parsePercentOrText(value);
    else if (key === 'fk') stats.fk = parseNumber(value);
    else if (key === 'fd') stats.fd = parseNumber(value);
    else if (key === 'plus_minus' && stats.plus_minus === null) stats.plus_minus = parseNumber(value);
  }

  if (stats.kills !== null && stats.deaths !== null && stats.deaths > 0) {
    stats.k_d = Number((stats.kills / stats.deaths).toFixed(2));
  } else if (stats.kills !== null && stats.deaths === 0) {
    stats.k_d = stats.kills;
  }

  stats.source = {
    type: 'vlr_match_page',
    parser: 'players_table_header_parser',
    confidence: 'high',
  };

  return stats;
}

function splitRowsByTeams(sectionHtml) {
  const tables = extractOverviewTables(sectionHtml);
  const rowRegex = /<tr[\s\S]*?<\/tr>/gi;
  const rows = [];

  tables.forEach((tableHtml, tableIndex) => {
    const bodyHtml = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] || '';
    let match;
    while ((match = rowRegex.exec(bodyHtml))) {
      const rowHtml = match[0];
      if (!/href="\/player\//i.test(rowHtml)) continue;
      rows.push({
        rowHtml,
        side: tableIndex === 0 ? 'team_a' : 'team_b',
      });
    }
  });

  return rows;
}

function roundStat(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function enrichDerivedStats(player, roundsPlayed) {
  const enriched = { ...player };

  if (enriched.plus_minus === null && enriched.kills !== null && enriched.deaths !== null) {
    enriched.plus_minus = enriched.kills - enriched.deaths;
  }

  if (roundsPlayed && roundsPlayed > 0) {
    if (enriched.kills !== null) enriched.kpr = roundStat(enriched.kills / roundsPlayed);
    if (enriched.assists !== null) enriched.apr = roundStat(enriched.assists / roundsPlayed);
    if (enriched.fk !== null) enriched.fkpr = roundStat(enriched.fk / roundsPlayed);
    if (enriched.fd !== null) enriched.fdpr = roundStat(enriched.fd / roundsPlayed);
  }

  return enriched;
}

function applyTeamContext(player, infoTeam) {
  const enriched = { ...player };

  if (infoTeam?.id && !enriched.team_id) enriched.team_id = infoTeam.id;
  if (infoTeam?.name && !enriched.team_name) enriched.team_name = infoTeam.name;
  if (infoTeam?.short_name && !enriched.short_name) enriched.short_name = infoTeam.short_name;
  if (infoTeam?.region && !enriched.region) enriched.region = infoTeam.region;

  return enriched;
}

async function hydratePlayerPageFallback(players) {
  return Promise.all(
    players.map(async (player) => {
      const needsFallback = !player.nationality || !player.status;
      if (!needsFallback || !player.vlr_url) return player;

      const fallback = await fetchPlayerPageContext(player.vlr_url);
      return {
        ...player,
        nationality: normalizeNationality(player.nationality || fallback.nationality || null),
        status: player.status || fallback.status || null,
        aliases: Array.from(new Set([...(player.aliases || []), ...(fallback.aliases || [])].filter(Boolean))),
      };
    })
  );
}

function fillMissingTeamPlayers(parsedPlayers, teamPlayerIds, infoTeam, playersData) {
  const filled = [...parsedPlayers];
  for (const playerId of teamPlayerIds || []) {
    if (filled.some((player) => player.player_id === playerId)) continue;
    const known = playersData.find((player) => player.id === playerId);
    const ref = known
      ? {
          player_id: known.id,
          player_name: known.name,
          short_name: known.short_name,
          team_id: known.team_id,
          team_name: known.team_name,
          vlr_player_id: known.vlr_player_id,
          nationality: known.nationality,
          region: known.region,
          vlr_url: known.vlr_url,
          aliases: known.aliases || [],
          status: known.status || null,
        }
      : {
          player_id: playerId,
          player_name: playerId,
          team_id: infoTeam?.id || null,
          team_name: infoTeam?.name || null,
          vlr_player_id: null,
          aliases: [],
          status: null,
        };
    filled.push(buildEmptyPlayerStat(ref, infoTeam));
  }
  return filled.slice(0, 5);
}

function buildTeamSummary(players) {
  const totals = players.reduce(
    (acc, player) => {
      acc.kills += player.kills || 0;
      acc.deaths += player.deaths || 0;
      acc.assists += player.assists || 0;
      acc.fk += player.fk || 0;
      acc.fd += player.fd || 0;
      return acc;
    },
    { kills: 0, deaths: 0, assists: 0, fk: 0, fd: 0 }
  );

  const complete = players.some((player) => player.kills !== null || player.rating !== null);
  return {
    ...totals,
    complete,
  };
}

function sumNullable(values) {
  const present = values.filter((value) => value !== null && value !== undefined);
  if (!present.length) return null;
  return present.reduce((acc, value) => acc + value, 0);
}

function averageNullable(values, digits = 2) {
  const present = values.filter((value) => value !== null && value !== undefined);
  if (!present.length) return null;
  return Number((present.reduce((acc, value) => acc + value, 0) / present.length).toFixed(digits));
}

function aggregatePlayerStats(players, roundsPlayed) {
  const grouped = new Map();

  for (const player of players || []) {
    const key = player.player_id || `${player.vlr_player_id || 'unknown'}:${player.player_name || 'unknown'}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        player_id: player.player_id || null,
        player_name: player.player_name || null,
        short_name: player.short_name || null,
        team_id: player.team_id || null,
        team_name: player.team_name || null,
        vlr_player_id: player.vlr_player_id || null,
        nationality: player.nationality || null,
        region: player.region || null,
        vlr_url: player.vlr_url || null,
        aliases: [...(player.aliases || [])],
        status: player.status || null,
        agents: [],
        maps_played: 0,
        rating: [],
        acs: [],
        adr: [],
        kast_values: [],
        kills_values: [],
        deaths_values: [],
        assists_values: [],
        fk_values: [],
        fd_values: [],
        hs_percent_values: [],
        plus_minus_values: [],
      });
    }

    const item = grouped.get(key);
    item.maps_played += 1;
    if (player.agent) item.agents.push(player.agent);
    if (player.rating !== null) item.rating.push(player.rating);
    if (player.acs !== null) item.acs.push(player.acs);
    if (player.adr !== null) item.adr.push(player.adr);
    if (player.kast) item.kast_values.push(player.kast);
    if (player.kills !== null) item.kills_values.push(player.kills);
    if (player.deaths !== null) item.deaths_values.push(player.deaths);
    if (player.assists !== null) item.assists_values.push(player.assists);
    if (player.fk !== null) item.fk_values.push(player.fk);
    if (player.fd !== null) item.fd_values.push(player.fd);
    const hsPercentNumber = parseNumber(String(player.hs_percent || '').replace('%', ''));
    if (hsPercentNumber !== null) item.hs_percent_values.push(hsPercentNumber);
    if (player.plus_minus !== null) item.plus_minus_values.push(player.plus_minus);
  }

  return Array.from(grouped.values()).map((item) => {
    const kills = sumNullable(item.kills_values);
    const deaths = sumNullable(item.deaths_values);
    const assists = sumNullable(item.assists_values);
    const fk = sumNullable(item.fk_values);
    const fd = sumNullable(item.fd_values);
    const plusMinus = item.plus_minus_values.length
      ? sumNullable(item.plus_minus_values)
      : kills !== null && deaths !== null
      ? kills - deaths
      : null;

    return enrichDerivedStats(
      {
        player_id: item.player_id,
        player_name: item.player_name,
        short_name: item.short_name,
        team_id: item.team_id,
        team_name: item.team_name,
        vlr_player_id: item.vlr_player_id,
        nationality: item.nationality,
        region: item.region,
        vlr_url: item.vlr_url,
        aliases: Array.from(new Set(item.aliases.filter(Boolean))),
        status: item.status,
        agents: Array.from(new Set(item.agents)),
        maps_played: item.maps_played,
        agent: null,
        rating: averageNullable(item.rating),
        acs: averageNullable(item.acs, 1),
        k_d: deaths === null ? null : deaths === 0 ? kills : Number((kills / deaths).toFixed(2)),
        adr: averageNullable(item.adr, 1),
        kast: item.kast_values.length ? `${averageNullable(item.kast_values.map((value) => parseNumber(String(value).replace('%', ''))), 1)}%` : null,
        kpr: null,
        apr: null,
        fkpr: null,
        fdpr: null,
        kills,
        deaths,
        assists,
        fk,
        fd,
        hs_percent: item.hs_percent_values.length ? `${averageNullable(item.hs_percent_values, 1)}%` : null,
        plus_minus: plusMinus,
        source: {
          type: 'vlr_match_page',
          parser: 'players_summary_aggregator',
          confidence: 'medium',
        },
      },
      roundsPlayed
    );
  });
}

function sortSummaryPlayers(players, preferredOrder) {
  const orderMap = new Map((preferredOrder || []).map((playerId, index) => [playerId, index]));
  return [...(players || [])].sort((a, b) => {
    const aOrder = orderMap.has(a.player_id) ? orderMap.get(a.player_id) : Number.MAX_SAFE_INTEGER;
    const bOrder = orderMap.has(b.player_id) ? orderMap.get(b.player_id) : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    if ((b.rating || -Infinity) !== (a.rating || -Infinity)) return (b.rating || -Infinity) - (a.rating || -Infinity);
    return (b.kills || -Infinity) - (a.kills || -Infinity);
  });
}

function buildPlayersSummary(info, playersDetail) {
  const maps = playersDetail.maps || [];
  const teamAPlayersFlat = maps.flatMap((map) => map.team_a?.players || []);
  const teamBPlayersFlat = maps.flatMap((map) => map.team_b?.players || []);
  const totalRounds = sumNullable(maps.map((map) => (map.team_a_score !== null && map.team_b_score !== null ? map.team_a_score + map.team_b_score : null)));
  const teamASummaryPlayers = sortSummaryPlayers(
    aggregatePlayerStats(teamAPlayersFlat, totalRounds),
    info.players?.team_a_players || []
  );
  const teamBSummaryPlayers = sortSummaryPlayers(
    aggregatePlayerStats(teamBPlayersFlat, totalRounds),
    info.players?.team_b_players || []
  );

  return {
    match_id: info.match_id,
    event_id: info.event_id,
    event_name: info.event_name,
    stage: info.stage || null,
    score: info.score,
    winner_team_id: info.winner_team_id,
    total_rounds: totalRounds,
    team_a: {
      team_id: info.team_a?.id || null,
      team_name: info.team_a?.name || null,
      players: teamASummaryPlayers,
      team_summary: buildTeamSummary(teamASummaryPlayers),
    },
    separator: '----- VS -----',
    team_b: {
      team_id: info.team_b?.id || null,
      team_name: info.team_b?.name || null,
      players: teamBSummaryPlayers,
      team_summary: buildTeamSummary(teamBSummaryPlayers),
    },
    source: info.source,
  };
}

function buildSingleMapPlayers(info, playersDetail, mapNumber) {
  const selectedMap = (playersDetail.maps || []).find((map) => Number(map.map_number) === Number(mapNumber)) || null;
  return {
    match_id: info.match_id,
    event_id: info.event_id,
    event_name: info.event_name,
    stage: info.stage || null,
    score: info.score,
    winner_team_id: info.winner_team_id,
    requested_map: Number(mapNumber),
    found: Boolean(selectedMap),
    map: selectedMap,
    source: info.source,
  };
}

async function buildPlayersDetail(info, html, data) {
  const knownMaps = info.maps || [];
  const baseUrl = info.source?.url || buildMatchUrl(info.match_id);
  let mapHtml = html;

  try {
    mapHtml = (await fetchUrl(`${baseUrl}/?tab=overview`, { referer: baseUrl })).body;
  } catch (error) {
    try {
      mapHtml = (await fetchUrl(`${baseUrl}?tab=overview`, { referer: baseUrl })).body;
    } catch (nestedError) {
      mapHtml = html;
    }
  }

  const sections = extractMapSectionsFromHtml(mapHtml, knownMaps);
  const parsedMaps = [];

  for (let index = 0; index < Math.max(sections.length, knownMaps.length); index += 1) {
    const section = sections[index] || null;
    const fallbackMap = knownMaps[index] || { map_number: index + 1, map_name: null };
    const sectionHtml = section?.html || '';
    const mapName = section?.map_name || detectMapName(stripTags(sectionHtml), fallbackMap);
    const score = parseMapScoreFromSection(sectionHtml);
    const headers = parseHeaderColumns(sectionHtml);
    const rows = splitRowsByTeams(sectionHtml);
    const teamAParsed = rows
      .filter((row) => row.side === 'team_a')
      .map((row) => parsePlayerStatRow(row.rowHtml, headers, data.players))
      .filter(Boolean)
      .map((player) => enrichDerivedStats(applyTeamContext(player, info.team_a), score?.team_a_score !== null && score?.team_b_score !== null ? score.team_a_score + score.team_b_score : null));
    const teamBParsed = rows
      .filter((row) => row.side === 'team_b')
      .map((row) => parsePlayerStatRow(row.rowHtml, headers, data.players))
      .filter(Boolean)
      .map((player) => enrichDerivedStats(applyTeamContext(player, info.team_b), score?.team_a_score !== null && score?.team_b_score !== null ? score.team_a_score + score.team_b_score : null));
    const teamAPlayers = await hydratePlayerPageFallback(fillMissingTeamPlayers(teamAParsed, info.players?.team_a_players || [], info.team_a, data.players));
    const teamBPlayers = await hydratePlayerPageFallback(fillMissingTeamPlayers(teamBParsed, info.players?.team_b_players || [], info.team_b, data.players));
    const winnerTeamId = score && info.team_a && info.team_b ? (score.team_a_score > score.team_b_score ? info.team_a.id : score.team_b_score > score.team_a_score ? info.team_b.id : null) : null;
    const parsedRowCount = teamAParsed.length + teamBParsed.length;

    parsedMaps.push({
      map_name: mapName,
      map_number: fallbackMap.map_number || index + 1,
      team_a_score: score?.team_a_score ?? null,
      team_b_score: score?.team_b_score ?? null,
      winner_team_id: winnerTeamId,
      team_a: {
        team_id: info.team_a?.id || null,
        team_name: info.team_a?.name || null,
        players: teamAPlayers,
        team_summary: buildTeamSummary(teamAPlayers),
      },
      separator: '----- VS -----',
      team_b: {
        team_id: info.team_b?.id || null,
        team_name: info.team_b?.name || null,
        players: teamBPlayers,
        team_summary: buildTeamSummary(teamBPlayers),
      },
      source: {
        type: 'vlr_match_page',
        parser: parsedRowCount ? 'players_table_header_parser' : 'players_known_roster_fallback',
        row_count: parsedRowCount,
        game_id: info.match_id ? `${info.match_id}-map-${index + 1}` : `map-${index + 1}`,
        url: `${baseUrl}?tab=overview&map=${index + 1}`,
      },
    });
  }

  const fallbackTeamAPlayers = await hydratePlayerPageFallback(fillMissingTeamPlayers([], info.players?.team_a_players || [], info.team_a, data.players));
  const fallbackTeamBPlayers = await hydratePlayerPageFallback(fillMissingTeamPlayers([], info.players?.team_b_players || [], info.team_b, data.players));

  const finalMaps = parsedMaps.length
    ? parsedMaps
    : knownMaps.map((map) => ({
        map_name: map.map_name,
        map_number: map.map_number,
        team_a_score: null,
        team_b_score: null,
        winner_team_id: null,
        team_a: {
          team_id: info.team_a?.id || null,
          team_name: info.team_a?.name || null,
          players: fallbackTeamAPlayers,
          team_summary: buildTeamSummary(fallbackTeamAPlayers),
        },
        separator: '----- VS -----',
        team_b: {
          team_id: info.team_b?.id || null,
          team_name: info.team_b?.name || null,
          players: fallbackTeamBPlayers,
          team_summary: buildTeamSummary(fallbackTeamBPlayers),
        },
        source: {
          type: 'vlr_match_page',
          parser: 'players_known_roster_fallback',
          row_count: 0,
        },
      }));

  finalMaps.sort((a, b) => (a.map_number || 0) - (b.map_number || 0));

  return {
    match_id: info.match_id,
    event_id: info.event_id,
    event_name: info.event_name,
    stage: info.stage || null,
    score: info.score,
    winner_team_id: info.winner_team_id,
    maps: finalMaps,
    source: info.source,
  };
}

function buildInfo(html, url, data) {
  const title = parseTitle(html);
  let teams = parseTeamsFromLinks(html, data.teams);
  if (teams.length < 2) teams = parseTeamsFromTitle(title, data.teams);
  const [teamA = null, teamB = null] = teams;
  const pageText = stripTags(html);
  const score = parseHeaderScore(html, teamA, teamB);
  const event = parseEvent(html, title, data.events);
  const stage = parseStage(html, event);
  const status = parseStatus(pageText);
  const winnerTeam = score.team_a === null || score.team_b === null || score.team_a === score.team_b ? null : score.team_a > score.team_b ? teamA : teamB;
  const maps = parseMaps(html);

  if (teamA && score.team_a !== null) teamA.score = score.team_a;
  if (teamB && score.team_b !== null) teamB.score = score.team_b;
  if (teamA && winnerTeam) teamA.result = winnerTeam === teamA ? 'win' : 'loss';
  if (teamB && winnerTeam) teamB.result = winnerTeam === teamB ? 'win' : 'loss';

  const info = {
    match_id: parseMatchId(url),
    event_id: event.event_id,
    event_name: event.event_name,
    event_url: event.event_url,
    match_name: teamA && teamB ? `${teamA.name} vs ${teamB.name}` : title || null,
    status,
    scheduled_at: status === 'upcoming' ? parseDatetime(html) : null,
    played_at: status === 'finished' ? parseDatetime(html) : null,
    timezone: parseDatetime(html) ? 'UTC_from_vlr_page' : null,
    format: pageText.match(/\bBo[1357]\b/i)?.[0] || null,
    team_a: teamA,
    team_b: teamB,
    winner_team_id: winnerTeam?.id || null,
    winner_team_name: winnerTeam?.name || null,
    score: score.text,
    players: parsePlayers(html, data.players),
    maps,
    source: {
      type: 'vlr_match_page',
      url,
    },
  };

  if (stage) info.stage = stage;
  return info;
}

function buildMaps(info) {
  const maps = (info.maps || []).map((map, index) => ({
    map_name: map.map_name,
    map_number: map.map_number || index + 1,
  }));
  return {
    match_id: info.match_id,
    event_id: info.event_id,
    maps,
    score: info.score,
    winner_team_id: info.winner_team_id,
    source: info.source,
  };
}

function buildH2h(info) {
  return {
    match_id: info.match_id,
    event_id: info.event_id,
    event_name: info.event_name,
    stage: info.stage,
    teams: [info.team_a, info.team_b].filter(Boolean),
    players: {
      team_a_players: info.players?.team_a_players || [],
      team_b_players: info.players?.team_b_players || [],
      all_players: info.players?.players || [],
      extras: info.players?.extras || [],
    },
    winner_team_id: info.winner_team_id,
    winner_team_name: info.winner_team_name,
    score: info.score,
    played_at: info.played_at,
    source: info.source,
  };
}

function notFound(command, query, reason, error, extra = {}) {
  return {
    query_type: `match_${command}`,
    matched_script: SCRIPT_NAME,
    normalized_query: query,
    filters: { match_id_or_url: query || null },
    result: {
      found: false,
      status: extra.status || 'not_found',
      reason,
      stale: Boolean(extra.stale),
      degraded: Boolean(extra.degraded),
      data: extra.data || null,
    },
    source: {
      type: 'vlr_match_page',
      url: buildMatchUrl(query),
      degrade_meta: extra.degradeMeta || null,
    },
    notes: error ? [String(error.message || error)] : [reason],
  };
}

function usage() {
  return {
    query_type: 'match_usage',
    matched_script: SCRIPT_NAME,
    commands: [
      'node scripts/valorant-match.js info <matchId|vlrMatchUrl>',
      'node scripts/valorant-match.js maps <matchId|vlrMatchUrl>',
      'node scripts/valorant-match.js h2h <matchId|vlrMatchUrl>',
      'node scripts/valorant-match.js detail <matchId|vlrMatchUrl>',
      'node scripts/valorant-match.js players summary <matchId|vlrMatchUrl>',
      'node scripts/valorant-match.js map1 players <matchId|vlrMatchUrl>',
      'node scripts/valorant-match.js map2 players <matchId|vlrMatchUrl>',
      'node scripts/valorant-match.js map3 players <matchId|vlrMatchUrl>',
      'node scripts/valorant-match.js map4 players <matchId|vlrMatchUrl>',
      'node scripts/valorant-match.js map5 players <matchId|vlrMatchUrl>',
    ],
    result: { status: 'usage' },
  };
}

function normalizeCommandArgs(argv) {
  const [first, second, third] = argv;

  if (first === 'players' && second === 'summary') {
    return {
      command: 'players_summary',
      matchIdOrUrl: third,
      extra: null,
    };
  }

  const mapPlayersMatch = String(first || '').match(/^map(\d+)$/i);
  if (mapPlayersMatch && second === 'players') {
    return {
      command: 'map_players',
      matchIdOrUrl: third,
      extra: Number(mapPlayersMatch[1]),
    };
  }

  if (['info', 'maps', 'h2h', 'detail'].includes(first)) {
    return {
      command: first,
      matchIdOrUrl: second,
      extra: third || null,
    };
  }

  return {
    command: 'info',
    matchIdOrUrl: first,
    extra: second || null,
  };
}

async function run(command, matchIdOrUrl, tabArg) {
  const data = {
    teamsData: loadJSON('teams.json', { regions: {} }),
    playersData: loadJSON('players.json', { players: [] }),
    eventsData: loadJSON('events.json', { events: [] }),
  };
  data.teams = flattenTeams(data.teamsData.regions);
  data.players = data.playersData.players || [];
  data.events = data.eventsData.events || [];

  const url = buildMatchUrl(matchIdOrUrl);
  if (!url) return usage();

  const cacheKey = JSON.stringify({ version: MATCH_RESULT_CACHE_VERSION, command, matchIdOrUrl, tabArg: tabArg || null, url });
  const cached = getResultCache('match', cacheKey, MATCH_RESULT_CACHE_TTL_MS);
  if (cached?.value) return cached.value;
  const staleCached = getResultCacheAnyAge('match', cacheKey);

  try {
    const htmlResponse = await fetchUrl(url, { referer: VLR_BASE });
    const html = htmlResponse.body;
    const info = buildInfo(html, url, data);
    const maps = buildMaps(info);
    const h2h = buildH2h(info);
    const detail = await buildPlayersDetail(info, html, data);
    const playersSummary = buildPlayersSummary(info, detail);
    const mapPlayers = command === 'map_players' ? buildSingleMapPlayers(info, detail, tabArg) : null;
    const resultByCommand = {
      info,
      maps,
      h2h,
      detail,
      players_summary: playersSummary,
      map_players: mapPlayers,
    };
    const result = resultByCommand[command] || resultByCommand.info;
    const degraded = Boolean(htmlResponse.degraded);
    const derivedMapNumbers = (info.maps || [])
      .map((map) => Number(map.map_number) || null)
      .filter((value) => value !== null);

    const output = {
      query_type: `match_${command}`,
      matched_script: SCRIPT_NAME,
      normalized_query: matchIdOrUrl,
      filters: {
        command,
        match_id_or_url: matchIdOrUrl,
        map_number: command === 'map_players'
          ? Number(tabArg) || null
          : ['maps', 'detail'].includes(command)
          ? derivedMapNumbers
          : null,
      },
      result: {
        found: Boolean(info.match_id),
        status: info.match_id ? (degraded ? 'resolved_stale' : 'resolved') : 'not_found',
        stale: degraded,
        degraded,
        data: result,
      },
      source: {
        type: 'vlr_match_page + static_json',
        url,
        files: ['data/events.json', 'data/teams.json', 'data/players.json'],
        event_version: data.eventsData.version || null,
        team_version: data.teamsData.version || null,
        player_version: data.playersData.version || null,
        html_cache: htmlResponse.cache,
      },
      notes: [
        'only_vlr_visible_page_data_used',
        'event_id_maps_to_events_json_id',
        'team_ids_map_to_teams_json_id',
        'player_ids_map_to_players_json_id_when_detected',
        'detail_command_returns_per_map_visible_match_rows_and_falls_back_to_known_roster_with_null_stats_when_needed',
        'players_summary_command_returns_aggregated_player_stats_across_all_maps',
        'map_players_command_returns_one_map_player_rows_by_map_number',
        ...(degraded ? ['stale_html_cache_used_for_live_fallback'] : []),
      ],
    };

    setResultCache('match', cacheKey, output, {
      command,
      query: matchIdOrUrl,
      map_number: command === 'map_players' ? Number(tabArg) || null : ['maps', 'detail'].includes(command) ? derivedMapNumbers : null,
      stale: degraded,
    });

    return output;
  } catch (error) {
    if (staleCached?.value && Date.now() - Date.parse(staleCached.cached_at || 0) <= MATCH_RESULT_STALE_TTL_MS) {
      return {
        ...staleCached.value,
        result: {
          ...(staleCached.value.result || {}),
          status: 'resolved_stale',
          stale: true,
          degraded: true,
        },
        source: {
          ...(staleCached.value.source || {}),
          degrade_meta: buildDegradedMeta('match', cacheKey, { url }, staleCached, error),
        },
        notes: Array.from(new Set([...(staleCached.value.notes || []), 'result_cache_stale_fallback_used', String(error.message || error)])),
      };
    }

    return notFound(command, matchIdOrUrl, 'vlr_match_page_unavailable_or_not_found', error, {
      status: 'upstream_unavailable',
      stale: false,
      degraded: false,
      degradeMeta: buildDegradedMeta('match', cacheKey, { url }, staleCached, error),
    });
  }
}

async function main() {
  const parsed = normalizeCommandArgs(process.argv.slice(2));
  const output = await run(parsed.command, parsed.matchIdOrUrl, parsed.extra);
  console.log(JSON.stringify(output, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.log(JSON.stringify(notFound('info', process.argv.slice(2).join(' '), 'unexpected_error', error), null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  fetchUrl,
  buildMatchUrl,
  buildInfo,
  buildMaps,
  buildH2h,
  buildPlayersDetail,
  buildPlayersSummary,
  buildSingleMapPlayers,
  normalizeCommandArgs,
  run,
};