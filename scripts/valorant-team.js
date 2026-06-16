#!/usr/bin/env node

/**
 * Valorant team detail query script.
 *
 * Resolution priority:
 * 1. Fetch from VLR.gg directly using known team URL / id / search query
 * 2. Fall back to local static data in data/teams.json + data/players.json
 * 3. If neither source can resolve, return null
 *
 * When both VLR and local static data are available:
 * - identical fields are returned normally
 * - differing fields prefer VLR data
 * - mismatch details are exposed for downstream consumers
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SCRIPT_NAME = 'scripts/valorant-team.js';
const VLR_BASE = 'https://www.vlr.gg';

function loadJSONSafe(filename, fallback) {
  const file = path.join(__dirname, '..', 'data', filename);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return fallback;
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
  const text = compact(value);
  if (!text) return null;
  if (/^taiwan$/i.test(text)) return 'China';
  return text;
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

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'user-agent': 'Mozilla/5.0 valorant-pro-skill/1.0',
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        },
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            fetchUrl(toAbsoluteVlrUrl(res.headers.location)).then(resolve).catch(reject);
            return;
          }

          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            resolve(body);
          });
        }
      )
      .on('error', reject);
  });
}

function loadLocalData() {
  const teamsData = loadJSONSafe('teams.json', { version: null, updated_at: null, regions: {} });
  const playersData = loadJSONSafe('players.json', { version: null, updated_at: null, players: [] });
  const teams = Object.values(teamsData.regions || {}).flatMap((region) => region.teams || []);
  const players = playersData.players || [];
  return { teamsData, playersData, teams, players };
}

function matchTeam(team, q) {
  const names = [team.id, team.name, team.short_name, ...(team.aliases || [])].map(normalize);
  return names.some((name) => name && (name === q || name.includes(q) || q.includes(name)));
}

function resolveLocalTeam(query, teams) {
  const q = normalize(query);
  if (!q) return { matched: [], selected: null };

  const matched = teams.filter((team) => matchTeam(team, q));
  const exact = matched.find((team) =>
    [team.id, team.name, team.short_name, ...(team.aliases || [])].map(normalize).some((name) => name === q)
  );

  return {
    matched,
    selected: exact || matched[0] || null,
  };
}

function linkRosterFromPlayers(playerIds, players) {
  return (playerIds || [])
    .map((playerId) => players.find((player) => player.id === playerId))
    .filter(Boolean)
    .map((player) => ({
      ...player,
      nationality: normalizeNationality(player.nationality),
    }));
}

function extractTitle(html) {
  return stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
    .replace(/\s*\|\s*VLR\.gg\s*$/i, '')
    .replace(/\s*-\s*VLR\.gg\s*$/i, '')
    .trim();
}

function buildTeamUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `${VLR_BASE}/team/${raw}`;
  return null;
}

async function searchVlrTeam(query) {
  const searchUrl = `${VLR_BASE}/search/?q=${encodeURIComponent(query)}`;
  const html = await fetchUrl(searchUrl);
  const matches = [];
  const regex = /<a[^>]+href="(\/search\/r\/team\/(\d+)\/idx)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html))) {
    matches.push({
      redirect_url: toAbsoluteVlrUrl(match[1]),
      vlr_team_id: Number(match[2]) || null,
      name: compact(stripTags(match[3])) || null,
    });
  }
  return matches;
}

function titleCaseWords(text) {
  return String(text || '')
    .split(' ')
    .filter(Boolean)
    .map((part) => {
      if (/^\d+$/.test(part)) return part;
      if (part.length <= 3 && /^[A-Z]+$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

function inferEventFromMatchUrl(matchUrl) {
  const slug = String(matchUrl || '').match(/^https?:\/\/www\.vlr\.gg\/\d+\/([^/?#]+)/i)?.[1] || '';
  if (!slug) return null;

  const parts = slug.split('-vs-');
  if (parts.length < 2) return null;
  let tail = parts.slice(1).join('-vs-');

  const markerMatch = tail.match(/-(esports-world-cup|valorant-masters|valorant-champions|vct)-/i);
  if (markerMatch) {
    tail = tail.slice(markerMatch.index + 1);
  } else {
    const segments = tail.split('-');
    tail = segments.slice(1).join('-');
  }

  const cleaned = tail
    .replace(/-stage-\d+-[a-z0-9-]+$/i, '')
    .replace(/-(lr\d+|ubqf|ubsf|ubf|lb\d+|lbf|gf|qf|sf|f)$/i, '')
    .replace(/-/g, ' ')
    .trim();

  if (!cleaned) return null;

  let normalized = titleCaseWords(cleaned)
    .replace(/\bAmericas\b/i, 'Americas')
    .replace(/\bEmea\b/i, 'EMEA')
    .replace(/\bPacific\b/i, 'Pacific')
    .replace(/\bChina\b/i, 'China')
    .replace(/\bAmer\b/i, 'Americas')
    .replace(/\bQualifiers\b/i, 'Qualifier')
    .replace(/\bEsports World Cup\b/i, 'Esports World Cup')
    .replace(/\bValorant Masters\b/i, 'Valorant Masters')
    .replace(/\bValorant Champions\b/i, 'Valorant Champions')
    .replace(/\bVct\b/i, 'VCT');

  normalized = normalized.replace(/\b(\d{4}) Americas Qualifier\b/i, '$1: Americas Qualifier');

  return normalized || null;
}

function parseRecentResults(html, canonicalUrl, teamName) {
  const container = html.match(/<h2[^>]*>\s*Recent Results\s*<\/h2>([\s\S]*?)<div class="team-summary-container-2"/i)?.[1] || '';
  if (!container) return [];

  const entries = [];
  const cardRegex = /<a href="(\/\d+\/[^"#?]+)" class="wf-card fc-flex m-item">([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = cardRegex.exec(container))) {
    const href = match[1];
    const block = match[2];
    const text = compact(stripTags(block));
    if (!text) continue;

    const eventMatch = block.match(/<div class="m-item-event[^"]*">[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
    const eventNameFromBlockRaw = compact(stripTags(eventMatch?.[1] || '')) || null;
    const inferredEventName = inferEventFromMatchUrl(toAbsoluteVlrUrl(href));
    const eventNameFromBlock = eventNameFromBlockRaw && !/^(lr\d+|ubqf|ubsf|ubf|lb\d+|lbf|gf|qf|sf|f)$/i.test(eventNameFromBlockRaw)
      ? eventNameFromBlockRaw
      : null;
    const eventName = inferredEventName || eventNameFromBlock || null;
    const dateMatch = text.match(/(20\d{2}\/\d{2}\/\d{2}\s+\d{1,2}:\d{2}\s+[ap]m)/i);
    const playedAt = dateMatch ? dateMatch[1] : null;

    const teamRegex = /<div class="m-item-team[^"]*">[\s\S]*?<span class="m-item-team-name">([\s\S]*?)<\/span>[\s\S]*?<span class="m-item-team-tag">([\s\S]*?)<\/span>[\s\S]*?(?:<div class="m-item-team-core[^>]*>([\s\S]*?)<\/div>)?[\s\S]*?<\/div>/gi;
    const parsedTeams = [];
    let teamMatch;
    while ((teamMatch = teamRegex.exec(block)) && parsedTeams.length < 2) {
      parsedTeams.push({
        name: compact(stripTags(teamMatch[1] || '')) || null,
        short_name: compact(stripTags(teamMatch[2] || '')) || null,
        core_id: compact(stripTags(teamMatch[3] || '')) || null,
      });
    }

    const scoreMatch = text.match(/(\d+)\s*:\s*(\d+)/);
    const score = scoreMatch ? `${scoreMatch[1]}:${scoreMatch[2]}` : null;

    const leftTeam = parsedTeams[0] || null;
    const rightTeam = parsedTeams[1] || null;
    const opponent = parsedTeams.find((item) => normalize(item.name) !== normalize(teamName)) || parsedTeams[1] || null;
    const matchupText = score ? `${leftTeam?.short_name || leftTeam?.name || 'Team A'} ${score} ${rightTeam?.short_name || rightTeam?.name || 'Team B'}` : null;
    const summaryParts = [eventName, matchupText, playedAt].filter(Boolean);

    entries.push({
      match_url: toAbsoluteVlrUrl(href),
      summary: summaryParts.join(' | ') || text,
      event: eventName,
      score,
      played_at_text: playedAt,
      team_name: teamName || null,
      opponent_name: opponent?.name || null,
      opponent_short_name: opponent?.short_name || null,
      source_team_url: canonicalUrl || null,
    });
  }

  return entries.slice(0, 10);
}

function parsePlayerRosterEntry(block) {
  const hrefMatch = block.match(/<a href="(\/player\/(\d+)\/[^"#?]+)"/i);
  if (!hrefMatch) return null;

  const playerUrl = toAbsoluteVlrUrl(hrefMatch[1]);
  const playerId = Number(hrefMatch[2]) || null;
  if (!playerUrl) return null;

  const aliasHtml = block.match(/<div class="team-roster-item-name-alias">([\s\S]*?)<\/div>/i)?.[1] || '';
  const realHtml = block.match(/<div class="team-roster-item-name-real">([\s\S]*?)<\/div>/i)?.[1] || '';
  const aliasText = compact(stripTags(aliasHtml));
  const realNameText = compact(stripTags(realHtml));
  const name = aliasText.replace(/\s*Team Captain\s*$/i, '').replace(/\s*stand-in\s*$/i, '').trim() || null;
  const roleFlag = /stand-in/i.test(`${aliasText} ${realNameText}`) ? 'stand-in' : null;
  const rawNationality = compact(decodeHtml(block.match(/<i[^>]+class="flag[^>]*"[^>]+title="([^"]+)"/i)?.[1] || ''));

  return {
    name,
    real_name: realNameText || null,
    nationality: normalizeNationality(rawNationality),
    vlr_url: playerUrl,
    vlr_player_id: playerId,
    status: roleFlag === 'stand-in' ? 'stand-in' : null,
    status_note: roleFlag,
  };
}

function parsePlayerProfileSupplement(html, teamName) {
  const pageText = stripTags(html);
  const rawNationality = compact(decodeHtml(html.match(/<i[^>]+class="flag[^>]*"[^>]+title="([^"]+)"/i)?.[1] || ''));
  const inlineNationality = compact(pageText.match(/\b(TAIWAN|[A-Z][A-Z\s]{2,})\s+Overview\b/i)?.[1] || '');
  const profileNationality = compact(
    stripTags(
      html.match(/<div class="ge-text-light"[^>]*>\s*(?:<i[^>]*class="flag[^>]*"[^>]*><\/i>)?\s*([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<div class="wf-nav">/i)?.[1] || ''
    )
  );
  const currentTeamBlock = html.match(/Current Teams[\s\S]*?<a[^>]+href="(\/team\/\d+\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/i);
  const currentTeamName = compact(stripTags(currentTeamBlock?.[2] || '')).replace(/\s+joined in\s+[A-Za-z]+\s+\d{4}$/i, '') || null;
  const hasCurrentTeam = Boolean(currentTeamName);
  const isActiveOnQueriedTeam = hasCurrentTeam && (!teamName || normalize(currentTeamName) === normalize(teamName));

  return {
    nationality: normalizeNationality(rawNationality || profileNationality || inlineNationality || null),
    status: isActiveOnQueriedTeam ? 'active' : null,
    current_team_name: currentTeamName,
  };
}

async function enrichRosterFromPlayerPages(roster, teamName) {
  const enriched = await Promise.all(
    (roster || []).map(async (player) => {
      if (!player?.vlr_url) return player;
      if (player.nationality && player.status) return player;

      try {
        const html = await fetchUrl(player.vlr_url);
        const supplement = parsePlayerProfileSupplement(html, teamName);
        return {
          ...player,
          nationality: player.nationality || supplement.nationality || null,
          status: player.status || supplement.status || null,
        };
      } catch (error) {
        return player;
      }
    })
  );

  return enriched;
}

function parseRoster(html) {
  const roster = [];
  const itemRegex = /<div class="team-roster-item">([\s\S]*?)<\/div>\s*<\/a>\s*<\/div>/gi;
  const seen = new Set();
  let itemMatch;

  while ((itemMatch = itemRegex.exec(html))) {
    const player = parsePlayerRosterEntry(itemMatch[1]);
    if (!player?.vlr_url || seen.has(player.vlr_url)) continue;
    seen.add(player.vlr_url);
    roster.push(player);
  }

  return roster;
}

function parseRegion(html) {
  const rankHref = html.match(/href="\/rankings\/([^"]+)"[^>]*>/i)?.[1] || '';
  const regionSlug = String(rankHref).split('/')[0] || '';
  const slug = normalize(regionSlug);
  if (!slug) return null;
  if (slug.includes('north america') || slug === 'americas') return 'AMERICAS';
  if (slug.includes('emea')) return 'EMEA';
  if (slug.includes('pacific')) return 'PACIFIC';
  if (slug.includes('china')) return 'CHINA';
  return regionSlug.toUpperCase().replace(/\s+/g, '_') || null;
}

function parseCountry(html) {
  const country = compact(stripTags(html.match(/<div class="team-header-country">[\s\S]*?<\/i>\s*([\s\S]*?)<\/div>/i)?.[1] || ''));
  return country || null;
}

function parseStatsSummary(html) {
  const currentRankText = compact(stripTags(html.match(/Current Rank[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] || ''));
  const ratingText = compact(stripTags(html));
  const ratingMatch = ratingText.match(/Current Rank[\s\S]*?Rating\/?Peak\s+(\d{3,4})/i) || ratingText.match(/Current Rank[\s\S]*?Rating\s+(\d{3,4})/i);
  const recordMatch = ratingText.match(/Current Rank[\s\S]*?Record\s+(\d+)W\s+(\d+)L/i);

  return {
    current_rank: currentRankText || null,
    rating: ratingMatch ? Number(ratingMatch[1]) : null,
    record: recordMatch ? `${recordMatch[1]}W ${recordMatch[2]}L` : null,
    wins: recordMatch ? Number(recordMatch[1]) : null,
    losses: recordMatch ? Number(recordMatch[2]) : null,
  };
}

function parseCanonicalTeamData(html, fallback = {}) {
  const canonicalUrl = toAbsoluteVlrUrl(html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1] || fallback.vlr_url || '') || fallback.vlr_url || null;
  const teamId = Number(String(canonicalUrl || '').match(/\/team\/(\d+)/i)?.[1] || fallback.vlr_team_id || 0) || null;
  const title = extractTitle(html);
  const pageText = stripTags(html);

  const name = compact(
    html.match(/<title[^>]*>(.*?)\s*:\s*Valorant Team Profile\s*\|\s*VLR\.gg/i)?.[1] ||
      fallback.name ||
      ''
  ) || fallback.name || null;

  const shortName = compact(stripTags(html.match(/<div[^>]*class="wf-title-med"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '')) || fallback.short_name || null;
  const country = parseCountry(html) || fallback.country || null;
  const region = parseRegion(html) || fallback.region || null;
  const siteUrl = toAbsoluteVlrUrl(html.match(/<a[^>]+href="(https?:\/\/[^\"]+)"[^>]*>\s*sentinels\.gg\s*<\/a>/i)?.[1] || '') || null;
  const socialUrl = toAbsoluteVlrUrl(html.match(/<a[^>]+href="(https?:\/\/x\.com\/[^\"]+)"[^>]*>\s*@/i)?.[1] || '') || null;
  const recentResults = parseRecentResults(html, canonicalUrl, name);
  const roster = parseRoster(html);
  const stats = parseStatsSummary(html);

  const aliases = Array.from(new Set([name, shortName, ...(fallback.aliases || [])].filter(Boolean)));

  return {
    id: fallback.id || (name ? normalize(name).replace(/\s+/g, '-') : null),
    name,
    short_name: shortName,
    aliases,
    status: fallback.status || 'active',
    region,
    country,
    vlr_url: canonicalUrl,
    vlr_team_id: teamId,
    website_url: siteUrl,
    social_url: socialUrl,
    current_roster: roster.map((player) => player.name).filter(Boolean),
    roster,
    stats,
    recent_results: recentResults,
    recent_form: buildRecentForm(recentResults),
    source_page_title: title || null,
    page_snapshot_text: pageText.slice(0, 500) || null,
  };
}

function buildRecentForm(recentResults) {
  if (!Array.isArray(recentResults) || !recentResults.length) return null;

  const recent = recentResults.slice(0, 5);
  let wins = 0;
  let losses = 0;
  for (const item of recent) {
    const score = String(item.score || '');
    const match = score.match(/(\d+)\s*:\s*(\d+)/);
    if (!match) continue;
    const a = Number(match[1]);
    const b = Number(match[2]);
    if (a > b) wins += 1;
    if (a < b) losses += 1;
  }

  return {
    sample_size: recent.length,
    wins,
    losses,
    form: recent.map((item) => {
      const score = String(item.score || '');
      const match = score.match(/(\d+)\s*:\s*(\d+)/);
      if (!match) return 'U';
      return Number(match[1]) > Number(match[2]) ? 'W' : Number(match[1]) < Number(match[2]) ? 'L' : 'U';
    }).join(''),
  };
}

function arePrimitiveEqual(a, b) {
  return normalize(String(a ?? '')) === normalize(String(b ?? ''));
}

function areArraysEquivalent(a, b) {
  const left = (Array.isArray(a) ? a : []).map((item) => normalize(typeof item === 'string' ? item : JSON.stringify(item))).filter(Boolean).sort();
  const right = (Array.isArray(b) ? b : []).map((item) => normalize(typeof item === 'string' ? item : JSON.stringify(item))).filter(Boolean).sort();
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareFields(vlrTeam, localTeam) {
  const fields = ['id', 'name', 'short_name', 'region', 'status', 'vlr_url', 'vlr_team_id', 'current_roster', 'aliases'];
  const mismatches = [];

  for (const field of fields) {
    const vlrValue = vlrTeam?.[field] ?? null;
    const localValue = localTeam?.[field] ?? null;
    const equal = Array.isArray(vlrValue) || Array.isArray(localValue)
      ? areArraysEquivalent(vlrValue, localValue)
      : arePrimitiveEqual(vlrValue, localValue);

    if (!equal) {
      mismatches.push({
        field,
        vlr_value: vlrValue,
        static_value: localValue,
      });
    }
  }

  return mismatches;
}

function mergeTeamData(vlrTeam, localTeam, players) {
  if (!vlrTeam && !localTeam) return null;
  if (!vlrTeam && localTeam) {
    return {
      ...localTeam,
      roster: linkRosterFromPlayers(localTeam.current_roster || [], players),
      stats: null,
      resolution_source: 'static_fallback',
      consistency: {
        status: 'static_only',
        mismatch_fields: [],
      },
    };
  }

  const localRoster = localTeam ? linkRosterFromPlayers(localTeam.current_roster || [], players) : [];
  const mismatches = vlrTeam && localTeam ? compareFields(vlrTeam, localTeam) : [];
  const status = !localTeam ? 'vlr_only' : mismatches.length ? 'mismatch' : 'matched';

  return {
    ...(localTeam || {}),
    ...(vlrTeam || {}),
    aliases: Array.from(new Set([...(vlrTeam?.aliases || []), ...(localTeam?.aliases || [])].filter(Boolean))),
    current_roster: (vlrTeam?.current_roster && vlrTeam.current_roster.length)
      ? vlrTeam.current_roster
      : (localTeam?.current_roster || []),
    roster: (vlrTeam?.roster && vlrTeam.roster.length)
      ? vlrTeam.roster
      : localRoster,
    recent_results: undefined,
    recent_form: undefined,
    resolution_source: 'vlr_primary',
    consistency: {
      status,
      mismatch_fields: mismatches,
    },
    static_snapshot: localTeam
      ? {
          id: localTeam.id || null,
          name: localTeam.name || null,
          short_name: localTeam.short_name || null,
          region: localTeam.region || null,
          vlr_url: localTeam.vlr_url || null,
          vlr_team_id: localTeam.vlr_team_id || null,
          current_roster: localTeam.current_roster || [],
        }
      : null,
  };
}

async function resolveVlrTeam(query, localSelected) {
  const raw = String(query || '').trim();
  if (!raw && !localSelected?.vlr_url) {
    return { found: false, team: null, resolve_mode: 'empty', matched_count: 0, error: null };
  }

  const directUrl = buildTeamUrl(raw) || localSelected?.vlr_url || null;
  let candidates = [];

  try {
    if (directUrl) {
      const html = await fetchUrl(directUrl);
      const team = parseCanonicalTeamData(html, localSelected || {});
      team.roster = await enrichRosterFromPlayerPages(team.roster, team.name);
      return {
        found: true,
        team,
        resolve_mode: /^https?:\/\//i.test(raw) ? 'direct_url' : /^\d+$/.test(raw) ? 'direct_id' : localSelected?.vlr_url ? 'local_index_vlr_url' : 'direct_url',
        matched_count: 1,
        error: null,
      };
    }

    candidates = await searchVlrTeam(raw);
    if (!candidates.length) {
      return { found: false, team: null, resolve_mode: 'search_not_found', matched_count: 0, error: null };
    }

    const selected = candidates[0];
    const html = await fetchUrl(selected.redirect_url);
    const team = parseCanonicalTeamData(html, localSelected || { name: selected.name, vlr_team_id: selected.vlr_team_id });
    team.roster = await enrichRosterFromPlayerPages(team.roster, team.name);
    return {
      found: true,
      team,
      resolve_mode: 'search_query',
      matched_count: candidates.length,
      error: null,
      search_candidates: candidates,
    };
  } catch (error) {
    return {
      found: false,
      team: null,
      resolve_mode: directUrl ? 'vlr_fetch_failed' : 'vlr_search_failed',
      matched_count: candidates.length || 0,
      error: error.message,
      search_candidates: candidates,
    };
  }
}

async function main() {
  const query = process.argv.slice(2).join(' ').trim();
  const { teamsData, playersData, teams, players } = loadLocalData();
  const localResolution = resolveLocalTeam(query, teams);
  const localTeam = localResolution.selected;
  const vlrResolution = await resolveVlrTeam(query, localTeam);
  const mergedTeam = mergeTeamData(vlrResolution.team, localTeam, players);

  const found = Boolean(mergedTeam);
  const notes = [];
  if (!found) notes.push('team_not_found');
  if (localResolution.matched.length > 1) notes.push('multiple_static_teams_matched');
  if ((vlrResolution.matched_count || 0) > 1) notes.push('multiple_vlr_teams_matched');
  if (vlrResolution.error) notes.push('vlr_fetch_failed_fallback_used');
  if (mergedTeam?.consistency?.status === 'mismatch') notes.push('vlr_static_data_mismatch');
  if (mergedTeam?.consistency?.status === 'static_only') notes.push('static_fallback_used');
  if (mergedTeam?.consistency?.status === 'vlr_only') notes.push('static_data_missing');

  const output = {
    query_type: 'team_detail',
    matched_script: SCRIPT_NAME,
    normalized_query: query,
    filters: { team_keyword: query || null },
    result: {
      found,
      matched_count: Math.max(localResolution.matched.length, vlrResolution.matched_count || 0, found ? 1 : 0),
      status: found ? 'resolved' : 'not_found',
      team: mergedTeam,
      recent_results: vlrResolution.team?.recent_results ?? [],
      recent_form: vlrResolution.team?.recent_form ?? null,
      stats: mergedTeam?.stats ?? null,
      consistency_notice: mergedTeam?.consistency?.status === 'mismatch'
        ? 'vlr_data_differs_from_local_static_data'
        : mergedTeam?.consistency?.status === 'static_only'
          ? 'vlr_unavailable_used_static_fallback'
          : null,
    },
    source: {
      type: found ? (vlrResolution.team ? 'vlr_with_static_compare' : 'static_json') : 'none',
      resolve_mode: vlrResolution.resolve_mode,
      vlr_available: Boolean(vlrResolution.team),
      static_available: Boolean(localTeam),
      vlr_error: vlrResolution.error || null,
      matched_vlr_candidates: vlrResolution.search_candidates || null,
      file: 'data/teams.json + data/players.json',
      team_version: teamsData.version,
      player_version: playersData.version,
      updated_at: teamsData.updated_at,
    },
    notes,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  const output = {
    query_type: 'team_detail',
    matched_script: SCRIPT_NAME,
    normalized_query: process.argv.slice(2).join(' ').trim(),
    filters: { team_keyword: process.argv.slice(2).join(' ').trim() || null },
    result: {
      found: false,
      matched_count: 0,
      status: 'error',
      team: null,
      recent_results: [],
      recent_form: null,
      stats: null,
      consistency_notice: null,
    },
    source: {
      type: 'error',
      resolve_mode: 'runtime_error',
      vlr_available: false,
      static_available: false,
      vlr_error: error.message,
      matched_vlr_candidates: null,
      file: 'data/teams.json + data/players.json',
      team_version: null,
      player_version: null,
      updated_at: null,
    },
    notes: ['runtime_error'],
  };

  console.log(JSON.stringify(output, null, 2));
  process.exitCode = 1;
});
