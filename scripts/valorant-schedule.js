#!/usr/bin/env node

/**
 * Valorant schedule query script.
 *
 * Supported commands:
 * - node scripts/valorant-schedule.js event <event-id-or-name>
 * - node scripts/valorant-schedule.js time <today|tomorrow|YYYY-MM-DD|MM-DD>
 * - node scripts/valorant-schedule.js stage <stage-slug>
 * - node scripts/valorant-schedule.js stats
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SCRIPT_NAME = 'scripts/valorant-schedule.js';
const VLR_BASE = 'https://www.vlr.gg';
const DEFAULT_YEAR = 2026;
const REQUEST_HEADERS = {
  'user-agent': 'Mozilla/5.0 valorant-pro-skill/1.0',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

function loadJSON(filename, fallback) {
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

function slugify(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function toAbsoluteUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${VLR_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: REQUEST_HEADERS }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          fetchUrl(toAbsoluteUrl(res.headers.location)).then(resolve).catch(reject);
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
      })
      .on('error', reject);
  });
}

function findEventByText(text, events) {
  const q = normalize(text);
  if (!q) return null;

  return (
    events.find((event) => normalize(event.id) === q) ||
    events.find((event) => normalize(event.name) === q || normalize(event.short_name) === q) ||
    events.find((event) => (event.aliases || []).some((alias) => normalize(alias) === q)) ||
    events.find((event) => q.includes(normalize(event.name)) || normalize(event.name).includes(q)) ||
    null
  );
}

function findTeamById(teamId, teams) {
  return teams.find((team) => team.id === teamId) || null;
}

function parseDateHeading(text) {
  const clean = compact(text).replace(/,$/, '');
  const match = clean.match(/^[A-Za-z]{3},\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) return null;

  const monthMap = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
  };

  const month = monthMap[match[1].toLowerCase()];
  const day = String(match[2]).padStart(2, '0');
  const year = match[3];
  return month ? `${year}-${month}-${day}` : null;
}

function monthNameToNumber(name) {
  const monthMap = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };
  return monthMap[String(name || '').toLowerCase()] || null;
}

function parseDateValue(input) {
  const text = compact(input);
  if (!text) return null;

  const full = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) return `${full[1]}-${full[2]}-${full[3]}`;

  const short = text.match(/^(\d{1,2})-(\d{1,2})$/);
  if (short) {
    return `${DEFAULT_YEAR}-${String(short[1]).padStart(2, '0')}-${String(short[2]).padStart(2, '0')}`;
  }

  return null;
}

function toIsoDatetime(date, time) {
  const parsedDate = parseDateValue(date);
  const parsedTime = compact(time).match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
  if (!parsedDate || !parsedTime) return null;

  let hour = Number(parsedTime[1]);
  const minute = parsedTime[2];
  const suffix = parsedTime[3].toLowerCase();

  if (suffix === 'am') {
    if (hour === 12) hour = 0;
  } else if (hour !== 12) {
    hour += 12;
  }

  return `${parsedDate}T${String(hour).padStart(2, '0')}:${minute}:00`;
}

function inferStatus(statusText, date, time) {
  const q = normalize(statusText);
  if (q.includes('completed')) return 'finished';
  if (q.includes('live')) return 'live';
  if (q.includes('upcoming')) return 'upcoming';

  const dt = toIsoDatetime(date, time);
  if (!dt) return 'unknown';

  const now = new Date();
  const matchTime = new Date(dt);
  if (Number.isNaN(matchTime.getTime())) return 'unknown';
  return matchTime.getTime() > now.getTime() ? 'upcoming' : 'finished';
}

function extractTextAfterLabel(block, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escaped}\\s*<\\/div>\\s*<div[^>]*>([\\s\\S]*?)<\\/div>`, 'i');
  const match = block.match(regex);
  return match ? stripTags(match[1]) : null;
}

function resolveStageInfo(stageText, roundText) {
  const combined = compact(`${stageText || ''} ${roundText || ''}`);
  const normalized = normalize(combined);

  if (normalized.includes('swiss stage') || /^round\s*\d+/i.test(roundText || '') || /^r\d+/i.test(roundText || '')) {
    return { stage: 'swiss-stage', stage_slug: 'swiss-stage', stage_detail: roundText || stageText || null };
  }

  if (
    normalized.includes('playoff') ||
    normalized.includes('upper ') ||
    normalized.includes('lower ') ||
    normalized.includes('grand final') ||
    normalized.includes('quarterfinal') ||
    normalized.includes('semifinal') ||
    normalized.includes('final')
  ) {
    return { stage: 'playoff', stage_slug: 'playoff', stage_detail: roundText || stageText || null };
  }

  const fallback = slugify(stageText || roundText || 'unknown');
  return { stage: fallback, stage_slug: fallback, stage_detail: roundText || stageText || null };
}

function parseTeamsFromBlock(block, teams) {
  const nameMatches = [...block.matchAll(/match-item-vs-team-name[^>]*>([\s\S]*?)<\/div>/gi)].map((match) => stripTags(match[1]));
  const scoreMatches = [...block.matchAll(/match-item-vs-team-score[^>]*>([\s\S]*?)<\/div>/gi)].map((match) => {
    const raw = stripTags(match[1]);
    return /^\d+$/.test(raw) ? Number(raw) : null;
  });

  return [0, 1].map((index) => {
    const teamName = nameMatches[index] || null;
    const known = teams.find(
      (team) =>
        normalize(team.name) === normalize(teamName) ||
        normalize(team.short_name) === normalize(teamName) ||
        (team.aliases || []).some((alias) => normalize(alias) === normalize(teamName))
    );

    return {
      id: known?.id || null,
      name: known?.name || teamName || null,
      short_name: known?.short_name || teamName || null,
      score: scoreMatches[index] ?? null,
      region: known?.region || null,
    };
  });
}

function parseMatchCards(html, event, teams) {
  const dayRegex = /<div[^>]*class="[^"]*wf-label mod-large[^"]*"[^>]*>([\s\S]*?)<\/div>|<a[^>]+href="(\/\d+\/[^"#?]+)"[^>]*class="[^"]*match-item[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const matches = [];
  let currentDate = null;
  let found;

  while ((found = dayRegex.exec(html))) {
    if (found[1]) {
      const maybeDate = parseDateHeading(stripTags(found[1]));
      if (maybeDate) currentDate = maybeDate;
      continue;
    }

    const urlPath = found[2];
    const block = found[3] || '';
    const time = stripTags(block.match(/match-item-time[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '') || null;
    const statusText = stripTags(block.match(/match-item-note[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '') || null;
    const round = stripTags(block.match(/match-item-event-series[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '') || null;
    const stageLabel = stripTags(block.match(/match-item-event[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '') || null;
    const [teamA, teamB] = parseTeamsFromBlock(block, teams);
    const matchId = String(urlPath.match(/\/(\d+)\//)?.[1] || urlPath.match(/\/(\d+)$/)?.[1] || '');
    const stageInfo = resolveStageInfo(stageLabel, round);
    const status = inferStatus(statusText, currentDate, time);
    const scoreLine = teamA.score != null && teamB.score != null ? `${teamA.score}-${teamB.score}` : null;
    const boText = stripTags(block.match(/\bBo\d\b/i)?.[0] || '') || null;

    matches.push({
      match_id: matchId || null,
      event: {
        id: event.id,
        name: event.name,
        short_name: event.short_name || null,
        status: event.status || null,
        vlr_event_id: event.vlr_event_id || null,
        vlr_url: event.vlr_url || null,
      },
      date: currentDate,
      time,
      datetime: currentDate && time ? toIsoDatetime(currentDate, time) : null,
      stage: stageInfo.stage,
      stage_slug: stageInfo.stage_slug,
      stage_detail: stageInfo.stage_detail,
      round,
      status,
      status_text: statusText,
      team_a: teamA,
      team_b: teamB,
      bo: boText ? boText.toLowerCase() : 'bo3',
      score_line: scoreLine,
      match_url: toAbsoluteUrl(urlPath),
    });
  }

  return matches.filter((item) => item.match_id && item.date);
}

function sortMatches(matches) {
  return [...matches].sort((a, b) => {
    const av = a.datetime || `${a.date || ''}T99:99:99`;
    const bv = b.datetime || `${b.date || ''}T99:99:99`;
    return av.localeCompare(bv);
  });
}

async function fetchEventMatches(event, teams) {
  const url = `${VLR_BASE}/event/matches/${event.vlr_event_id}/${String(event.id || '').replace(/^.*$/, () => event.vlr_url ? event.vlr_url.split('/').slice(-1)[0] : '') || ''}/?series_id=all`;
  const fallbackUrl = `${VLR_BASE}/event/matches/${event.vlr_event_id}/${String(event.vlr_url || '').split('/').filter(Boolean).pop() || ''}/?series_id=all`;
  const html = await fetchUrl(url.includes('//?') ? fallbackUrl : url).catch(async () => fetchUrl(fallbackUrl));
  return parseMatchCards(html, event, teams);
}

async function fetchAllMatches(events, teams) {
  const all = [];
  const errors = [];

  for (const event of events) {
    if (!event?.vlr_event_id) continue;
    try {
      const matches = await fetchEventMatches(event, teams);
      all.push(...matches);
    } catch (error) {
      errors.push({ event_id: event.id, message: error.message });
    }
  }

  return { matches: sortMatches(all), errors };
}

function normalizeDateKeyword(text) {
  const q = String(text || '').trim().toLowerCase();
  if (!q) return 'today';
  if (q.includes('tomorrow') || q.includes('明天')) return 'tomorrow';
  if (q.includes('today') || q.includes('今天')) return 'today';
  return q;
}

function resolveRelativeDate(keyword) {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (keyword === 'tomorrow') base.setDate(base.getDate() + 1);
  const year = base.getFullYear();
  const month = String(base.getMonth() + 1).padStart(2, '0');
  const day = String(base.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeRequestedDate(input) {
  const normalized = normalizeDateKeyword(input);
  if (normalized === 'today' || normalized === 'tomorrow') return resolveRelativeDate(normalized);
  return parseDateValue(normalized);
}

function normalizeStageInput(input) {
  return slugify(String(input || '').replace(/^stage\s+/i, ''));
}

function getStats(matches) {
  const byStatus = matches.reduce((acc, match) => {
    const key = match.status || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    total_matches: matches.length,
    by_status: byStatus,
    statuses: Object.keys(byStatus).sort().map((key) => ({ status: key, count: byStatus[key] })),
  };
}

function buildOutput(queryType, normalizedQuery, filters, result, notes, source) {
  return {
    query_type: queryType,
    matched_script: SCRIPT_NAME,
    normalized_query: normalizedQuery,
    filters,
    result,
    source,
    notes,
  };
}

function usage() {
  return {
    usage: [
      'node scripts/valorant-schedule.js event <event-id-or-name>',
      'node scripts/valorant-schedule.js time <today|tomorrow|YYYY-MM-DD|MM-DD>',
      'node scripts/valorant-schedule.js stage <stage-slug>',
      'node scripts/valorant-schedule.js stats',
    ],
  };
}

async function main() {
  const eventsData = loadJSON('events.json', { events: [] });
  const teamsData = loadJSON('teams.json', { regions: {} });
  const events = eventsData.events || [];
  const teams = Object.values(teamsData.regions || {}).flatMap((region) => region.teams || []);

  const args = process.argv.slice(2);
  const command = String(args[0] || '').toLowerCase();
  const rawValue = args.slice(1).join(' ').trim();

  if (!command) {
    console.log(JSON.stringify(usage(), null, 2));
    return;
  }

  if (!['event', 'time', 'stage', 'stats'].includes(command)) {
    console.log(
      JSON.stringify(
        buildOutput(
          'schedule_lookup',
          args.join(' '),
          { command },
          { error: 'unsupported_command' },
          ['supported_commands:event,time,stage,stats'],
          { type: 'static_events+vlr_pages', files: ['data/events.json', 'data/teams.json'] }
        ),
        null,
        2
      )
    );
    return;
  }

  try {
    if (command === 'event') {
      const event = findEventByText(rawValue, events);
      if (!event) {
        console.log(
          JSON.stringify(
            buildOutput(
              'schedule_lookup',
              args.join(' '),
              { command: 'event', event_query: rawValue },
              { error: 'event_not_found', match_count: 0, matches: [] },
              ['check_event_id_or_alias'],
              { type: 'static_events+vlr_pages', files: ['data/events.json', 'data/teams.json'] }
            ),
            null,
            2
          )
        );
        return;
      }

      const matches = sortMatches(await fetchEventMatches(event, teams));
      console.log(
        JSON.stringify(
          buildOutput(
            'schedule_lookup',
            args.join(' '),
            { command: 'event', event_id: event.id },
            {
              event: {
                id: event.id,
                name: event.name,
                short_name: event.short_name || null,
                status: event.status || null,
                start_date: event.start_date || null,
                end_date: event.end_date || null,
              },
              match_count: matches.length,
              matches,
            },
            [],
            { type: 'static_events+vlr_pages', files: ['data/events.json', 'data/teams.json'], url: event.vlr_url || null }
          ),
          null,
          2
        )
      );
      return;
    }

    const { matches, errors } = await fetchAllMatches(events, teams);

    if (command === 'time') {
      const requestedDate = normalizeRequestedDate(rawValue || 'today');
      const filtered = requestedDate ? matches.filter((match) => match.date === requestedDate) : [];

      if (!requestedDate || filtered.length === 0) {
        console.log('null');
        return;
      }

      console.log(
        JSON.stringify(
          buildOutput(
            'schedule_lookup',
            args.join(' '),
            { command: 'time', requested_date: requestedDate },
            {
              date: requestedDate,
              match_count: filtered.length,
              matches: sortMatches(filtered),
            },
            errors.length ? ['partial_fetch_errors_present'] : [],
            { type: 'static_events+vlr_pages', files: ['data/events.json', 'data/teams.json'], errors }
          ),
          null,
          2
        )
      );
      return;
    }

    if (command === 'stage') {
      const requestedStage = normalizeStageInput(rawValue);
      const filtered = matches.filter((match) => match.stage_slug === requestedStage || slugify(match.stage).includes(requestedStage));

      console.log(
        JSON.stringify(
          buildOutput(
            'schedule_lookup',
            args.join(' '),
            { command: 'stage', stage: requestedStage },
            {
              stage: requestedStage,
              match_count: filtered.length,
              matches: sortMatches(filtered),
            },
            errors.length ? ['partial_fetch_errors_present'] : [],
            { type: 'static_events+vlr_pages', files: ['data/events.json', 'data/teams.json'], errors }
          ),
          null,
          2
        )
      );
      return;
    }

    if (command === 'stats') {
      console.log(
        JSON.stringify(
          buildOutput(
            'schedule_lookup',
            args.join(' '),
            { command: 'stats' },
            getStats(matches),
            errors.length ? ['partial_fetch_errors_present'] : [],
            { type: 'static_events+vlr_pages', files: ['data/events.json', 'data/teams.json'], errors }
          ),
          null,
          2
        )
      );
    }
  } catch (error) {
    console.log(
      JSON.stringify(
        buildOutput(
          'schedule_lookup',
          args.join(' '),
          { command, raw_value: rawValue },
          { error: 'runtime_error', message: error.message },
          ['fetch_or_parse_failed'],
          { type: 'static_events+vlr_pages', files: ['data/events.json', 'data/teams.json'] }
        ),
        null,
        2
      )
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  loadJSON,
  normalize,
  slugify,
  normalizeDateKeyword,
  normalizeRequestedDate,
  normalizeStageInput,
  parseDateValue,
  toIsoDatetime,
  inferStatus,
  parseMatchCards,
  fetchEventMatches,
  fetchAllMatches,
  getStats,
};
