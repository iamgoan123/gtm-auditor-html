// GTM Auditor — Vercel Edge Function
// Fetches a target URL, parses any GTM container found, extracts page signals,
// extracts Open Graph brand info, and calls Groq for an AI audit.

export const config = { runtime: 'edge' };

// ---------------------------------------------------------------------------
// Tag-type lookups
// ---------------------------------------------------------------------------
const GTM_TAG_TYPES = {
  '__ua': 'Universal Analytics (DEPRECATED)',
  '__ga': 'Universal Analytics (DEPRECATED)',
  '__ga4': 'GA4 Event',
  '__gaawc': 'GA4 Configuration',
  '__gaawe': 'GA4 Event',
  '__gclidw': 'Conversion Linker',
  '__awct': 'Google Ads Conversion',
  '__sp': 'Google Ads Remarketing',
  '__cl': 'Click Listener',
  '__fsl': 'Form Submit Listener',
  '__hl': 'History Listener',
  '__jel': 'JS Error Listener',
  '__sdl': 'Scroll Depth Listener',
  '__tl': 'Timer Listener',
  '__ytl': 'YouTube Video Listener',
  '__ee': 'Element Visibility Trigger',
  '__html': 'Custom HTML',
  '__img': 'Custom Image',
  '__fb': 'Meta (Facebook) Pixel',
  '__pntr': 'Pinterest Tag',
  '__twitter_website_tag': 'X (Twitter) Pixel',
  '__cvt_': 'Custom Template',
  '__paused': 'Paused',
  '__opt': 'Google Optimize',
  '__okt': 'OneTrust Consent',
  '__zone': 'Zone',
  '__lcl': 'Link Click Listener',
  '__evl': 'Element Visibility',
  '__bzi': 'LinkedIn Insight',
  '__crto': 'Criteo OneTag',
  '__fls': 'Floodlight Sales',
  '__flc': 'Floodlight Counter',
  '__pa': 'Personalize Attribute',
  '__c': 'Constant Variable',
  '__e': 'Event Variable',
  '__u': 'URL Variable',
  '__v': 'Data Layer Variable',
  '__d': 'DOM Element Variable',
  '__j': 'JavaScript Variable',
  '__jsm': 'Custom JavaScript Variable',
  '__k': 'First Party Cookie Variable',
  '__r': 'Random Number Variable',
  '__t': 'Page URL Variable',
  '__remm': 'RegEx Table Variable',
  '__smm': 'Lookup Table Variable',
  '__uv': 'Auto Event Variable',
  '__f': 'Referrer Variable',
  '__aev': 'Auto Event Variable',
  '__ctv': 'Container Version Variable',
};

const TRACKING_SIGNATURES = {
  facebook_pixel:       /fbq\(|connect\.facebook\.net\/.*\/fbevents\.js/i,
  tiktok_pixel:         /ttq\.|analytics\.tiktok\.com/i,
  pinterest_tag:        /pintrk\(|s\.pinimg\.com\/ct/i,
  linkedin_insight:     /_linkedin_data_partner_ids|snap\.licdn\.com/i,
  twitter_pixel:        /twq\(|static\.ads-twitter\.com/i,
  bing_uet:             /\buetq\b|bat\.bing\.com/i,
  snap_pixel:           /snaptr\(|sc-static\.net/i,
  reddit_pixel:         /rdt\(|reddit\.com\/static\/pixel/i,
  klaviyo:              /klaviyo|_learnq/i,
  hubspot:              /js\.hs-scripts\.com|hubspot/i,
  hotjar:               /static\.hotjar\.com|_hjSettings/i,
  clarity:              /clarity\.ms|clarity\(/i,
  fullstory:            /edge\.fullstory\.com|FS\.identify/i,
  segment:              /cdn\.segment\.com|analytics\.load/i,
  amplitude:            /cdn\.amplitude\.com|amplitude\.getInstance/i,
  mixpanel:             /cdn\.mxpnl\.com|mixpanel\.init/i,
  onetrust_consent:     /onetrust|optanon/i,
  cookiebot_consent:    /cookiebot/i,
  usercentrics_consent: /usercentrics/i,
  shopify:              /shopify|Shopify\.shop/i,
  woocommerce:          /woocommerce/i,
  magento:              /magento|mage\//i,
};

// ---------------------------------------------------------------------------
// GTM parser
// ---------------------------------------------------------------------------
function extractBalancedObject(text, startIdx) {
  if (startIdx < 0 || startIdx >= text.length || text[startIdx] !== '{') return null;
  let depth = 0, inString = false, escape = false;
  for (let i = startIdx; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(startIdx, i + 1); }
  }
  return null;
}

function parseGtmContainer(script) {
  if (!script) return null;
  const m = script.match(/(?:var|let|const)\s+data\s*=\s*/);
  if (!m) return null;
  const braceIdx = script.indexOf('{', m.index + m[0].length);
  if (braceIdx < 0) return null;
  const raw = extractBalancedObject(script, braceIdx);
  if (!raw) return null;
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  const resource = data?.resource;
  if (!resource || typeof resource !== 'object') return null;

  const tags = (resource.tags || []).map(t => ({
    name: t.function || t.vtp_name || 'Unnamed tag',
    type: GTM_TAG_TYPES[t.function] || t.function || 'Custom',
    paused: !!(t.paused || (t.priority && t.priority < 0)),
    params: Object.keys(t).filter(k => k.startsWith('vtp_')).length,
  }));

  const macros = (resource.macros || []).map(m => ({
    name: m.function || m.vtp_name || 'Unnamed variable',
    type: GTM_TAG_TYPES[m.function] || m.function || 'Custom',
  }));

  const predicates = (resource.predicates || []).map(p => ({
    type: p.function || 'unknown',
  }));

  const rules = resource.rules || [];
  const runtime = resource.runtime ? resource.runtime.length : 0;

  return {
    tag_count: tags.length,
    variable_count: macros.length,
    predicate_count: predicates.length,
    rule_count: rules.length,
    runtime_blocks: runtime,
    version: resource.version || 'unknown',
    tags,
    variables: macros,
    predicates,
  };
}

// ---------------------------------------------------------------------------
// Page signal extraction
// ---------------------------------------------------------------------------
function extractPageSignals(html) {
  const signals = {
    detected_tools: [],
    ga4_ids: [],
    ga_universal_ids: [],
    google_ads_ids: [],
    floodlight_ids: [],
    consent_mode_v1: false,
    consent_mode_v2: false,
    server_side_gtm: false,
  };

  for (const [name, pattern] of Object.entries(TRACKING_SIGNATURES)) {
    if (pattern.test(html)) signals.detected_tools.push(name);
  }

  const ga4 = html.match(/G-[A-Z0-9]{6,12}/g) || [];
  signals.ga4_ids = [...new Set(ga4)];

  const ua = html.match(/UA-\d{4,12}-\d+/g) || [];
  signals.ga_universal_ids = [...new Set(ua)];

  const aw = html.match(/AW-\d{6,12}/g) || [];
  signals.google_ads_ids = [...new Set(aw)];

  const dc = html.match(/DC-\d{6,12}/g) || [];
  signals.floodlight_ids = [...new Set(dc)];

  signals.consent_mode_v1 = /gtag\(['"]consent['"]/i.test(html);
  signals.consent_mode_v2 = /ad_user_data|ad_personalization/i.test(html);
  signals.server_side_gtm =
    /transport_url|first-party-collection|sgtm|server-side/i.test(html);

  return signals;
}

// ---------------------------------------------------------------------------
// Brand info extraction (Open Graph + favicon)
// ---------------------------------------------------------------------------
function extractBrandInfo(html, sourceUrl) {
  function findMeta(key) {
    const patterns = [
      new RegExp(`<meta\\s+[^>]*property=["']${key}["'][^>]*content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["'][^>]*property=["']${key}["']`, 'i'),
      new RegExp(`<meta\\s+[^>]*name=["']${key}["'][^>]*content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["'][^>]*name=["']${key}["']`, 'i'),
    ];
    for (const p of patterns) { const m = html.match(p); if (m) return m[1].trim(); }
    return null;
  }
  function absolutize(u) {
    if (!u) return null;
    if (u.startsWith('http://') || u.startsWith('https://')) return u;
    try { return new URL(u, sourceUrl).toString(); } catch { return null; }
  }

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : null;

  const ogImage = absolutize(findMeta('og:image') || findMeta('twitter:image'));

  let favicon = null;
  const favMatch = html.match(/<link\s+[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i)
                || html.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i);
  if (favMatch) favicon = absolutize(favMatch[1]);

  return {
    title: findMeta('og:title') || title,
    description: findMeta('og:description') || findMeta('description'),
    image: ogImage,
    favicon,
    site_name: findMeta('og:site_name'),
  };
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------
function buildAuditPrompt(url, gtmId, parsed, signals) {
  const tagTypeCounts = {};
  (parsed?.tags || []).forEach(t => { tagTypeCounts[t.type] = (tagTypeCounts[t.type] || 0) + 1; });
  const sortedTypes = Object.entries(tagTypeCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);

  const variableTypes = {};
  (parsed?.variables || []).forEach(v => { variableTypes[v.type] = (variableTypes[v.type] || 0) + 1; });

  const triggerTypes = {};
  (parsed?.predicates || []).forEach(p => { triggerTypes[p.type] = (triggerTypes[p.type] || 0) + 1; });

  return `You are a senior Google Tag Manager auditor performing a real-world inspection of a website's tracking setup.

WEBSITE: ${url}
GTM CONTAINER: ${gtmId}

PARSED CONTAINER DATA:
- Total tags: ${parsed?.tag_count || 0}
- Total variables: ${parsed?.variable_count || 0}
- Total trigger conditions: ${parsed?.predicate_count || 0}
- Total rules: ${parsed?.rule_count || 0}
- Container version: ${parsed?.version || 'unknown'}

TOP TAG TYPES (real counts from the container):
${sortedTypes.map(([t, c]) => `- ${t}: ${c}`).join('\n')}

VARIABLE TYPE BREAKDOWN:
${Object.entries(variableTypes).slice(0, 10).map(([t, c]) => `- ${t}: ${c}`).join('\n')}

TRIGGER TYPE BREAKDOWN:
${Object.entries(triggerTypes).slice(0, 10).map(([t, c]) => `- ${t}: ${c}`).join('\n')}

PAGE-LEVEL SIGNALS (from the rendered HTML):
- GA4 IDs found on page: ${signals.ga4_ids.join(', ') || 'none'}
- Universal Analytics IDs (DEPRECATED): ${signals.ga_universal_ids.join(', ') || 'none'}
- Google Ads IDs: ${signals.google_ads_ids.join(', ') || 'none'}
- Floodlight IDs: ${signals.floodlight_ids.join(', ') || 'none'}
- Consent Mode v1 signals: ${signals.consent_mode_v1}
- Consent Mode v2 signals (ad_user_data / ad_personalization): ${signals.consent_mode_v2}
- Server-side GTM detected: ${signals.server_side_gtm}
- Other tracking tools detected on page: ${signals.detected_tools.join(', ') || 'none'}

AUDIT PRIORITIES (2026):
1. Universal Analytics was sunset July 2023. Any UA reference is HIGH priority.
2. Consent Mode v2 is required for EEA traffic since March 2024. Missing ad_user_data / ad_personalization is HIGH priority.
3. GA4 event names MUST be snake_case.
4. Conversion Linker is required when Google Ads tags are present.
5. Server-side GTM is a maturity indicator for ecommerce and high-traffic sites.
6. Watch for duplicate firing — e.g. Shopify native pixel + GTM-based GA4 = double events.

RETURN STRICT JSON (no markdown fences, no preamble):

{
  "site_summary": "1-2 sentence summary of the tracking setup found",
  "health_score": <0-100>,
  "tags_found": <number>,
  "triggers_found": <number>,
  "variables_found": <number>,
  "issues_count": <number>,
  "ga4": {
    "present": <bool>,
    "measurement_id": "<G-XXX or None>",
    "via": "<GTM | gtag.js | None>",
    "ecommerce": <bool>,
    "consent_mode": <bool>,
    "consent_mode_v2": <bool>,
    "note": "<one-line status>"
  },
  "tags": [
    { "name": "<actual tag type or name from container>", "status": "<pass|warn|fail|info>", "detail": "<what it does>", "recommendation": "<optional fix>" }
  ],
  "triggers": [
    { "name": "<trigger type>", "status": "<pass|warn|fail|info>", "detail": "<short>", "recommendation": "<optional>" }
  ],
  "top_issues": [
    { "title": "<short>", "priority": "<high|medium|low>", "detail": "<longer>", "fix": "<actionable step>" }
  ],
  "quick_wins": [ "<short imperative>", ... ]
}

Use 4-6 entries for tags, 3-5 for triggers, 4-6 for top_issues, 3-5 for quick_wins. Use ACTUAL names from the data above — do not invent.`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
const UA_STRING = 'Mozilla/5.0 (compatible; GTMAuditor/2.0; +https://github.com/iamgoan123/gtm-auditor)';

async function fetchWithTimeout(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA_STRING, 'Accept': 'text/html,*/*' },
      redirect: 'follow',
    });
  } finally { clearTimeout(timer); }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return jsonResponse({ error: 'POST required' }, 405);

  let body;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'Invalid JSON body' }, 400); }
  let { url } = body || {};
  if (!url || typeof url !== 'string') return jsonResponse({ error: 'url is required' }, 400);

  url = url.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
  try { new URL(url); } catch { return jsonResponse({ error: 'Invalid URL' }, 400); }

  if (!process.env.GROQ_API_KEY) {
    return jsonResponse({ error: 'GROQ_API_KEY is not set in Vercel environment variables' }, 500);
  }

  // 1. Fetch page
  let html;
  try {
    const r = await fetchWithTimeout(url);
    if (!r.ok) return jsonResponse({ error: `Could not fetch ${url} (HTTP ${r.status})` }, 400);
    html = await r.text();
  } catch (err) {
    return jsonResponse({ error: `Fetch failed: ${err.message}` }, 400);
  }

  // 2. Extract everything from the page
  const signals = extractPageSignals(html);
  const brand = extractBrandInfo(html, url);
  const gtmMatches = [...new Set(html.match(/GTM-[A-Z0-9]{4,12}/g) || [])];

  // 3. If no GTM, return early with what we found
  if (gtmMatches.length === 0) {
    return jsonResponse({
      url, noGtm: true, brand, signals,
    });
  }

  // 4. Fetch + parse the container
  const gtmId = gtmMatches[0];
  let parsed = null;
  try {
    const r = await fetchWithTimeout(`https://www.googletagmanager.com/gtm.js?id=${gtmId}`);
    if (r.ok) {
      const script = await r.text();
      parsed = parseGtmContainer(script);
    }
  } catch (_) { /* fall through */ }

  // 5. Call Groq
  const prompt = buildAuditPrompt(url, gtmId, parsed, signals);
  let audit;
  try {
    const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 2400,
      }),
    });
    if (!groqResp.ok) {
      const t = await groqResp.text();
      return jsonResponse({ error: `Groq API error (${groqResp.status}): ${t.slice(0, 300)}` }, 500);
    }
    const data = await groqResp.json();
    let text = (data.choices?.[0]?.message?.content || '').trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    try { audit = JSON.parse(text); }
    catch (e) { return jsonResponse({ error: 'AI returned invalid JSON', raw: text.slice(0, 400) }, 500); }
  } catch (err) {
    return jsonResponse({ error: `AI call failed: ${err.message}` }, 500);
  }

  return jsonResponse({ url, gtmId, brand, signals, parsed, audit });
}
