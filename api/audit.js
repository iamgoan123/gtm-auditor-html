// GTM Auditor — Vercel Serverless Function (Node.js CommonJS)
// Fetches a target URL, parses any GTM container found, extracts page signals,
// extracts Open Graph brand info, and calls Groq for an AI audit.

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
  '__ctv': 'Container Version Variable'
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
  magento:              /magento|mage\//i
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
  try { data = JSON.parse(raw); } catch (e) { return null; }
  const resource = data && data.resource;
  if (!resource || typeof resource !== 'object') return null;

  const tags = (resource.tags || []).map(function (t) {
    return {
      name: t.function || t.vtp_name || 'Unnamed tag',
      type: GTM_TAG_TYPES[t.function] || t.function || 'Custom',
      paused: !!(t.paused || (t.priority && t.priority < 0)),
      params: Object.keys(t).filter(function (k) { return k.startsWith('vtp_'); }).length
    };
  });
  const macros = (resource.macros || []).map(function (mv) {
    return {
      name: mv.function || mv.vtp_name || 'Unnamed variable',
      type: GTM_TAG_TYPES[mv.function] || mv.function || 'Custom'
    };
  });
  const predicates = (resource.predicates || []).map(function (p) {
    return { type: p.function || 'unknown' };
  });
  const rules = resource.rules || [];

  return {
    tag_count: tags.length,
    variable_count: macros.length,
    predicate_count: predicates.length,
    rule_count: rules.length,
    version: resource.version || 'unknown',
    tags: tags,
    variables: macros,
    predicates: predicates
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
    server_side_gtm: false
  };
  for (const name in TRACKING_SIGNATURES) {
    if (TRACKING_SIGNATURES[name].test(html)) signals.detected_tools.push(name);
  }
  signals.ga4_ids = Array.from(new Set(html.match(/G-[A-Z0-9]{6,12}/g) || []));
  signals.ga_universal_ids = Array.from(new Set(html.match(/UA-\d{4,12}-\d+/g) || []));
  signals.google_ads_ids = Array.from(new Set(html.match(/AW-\d{6,12}/g) || []));
  signals.floodlight_ids = Array.from(new Set(html.match(/DC-\d{6,12}/g) || []));
  signals.consent_mode_v1 = /gtag\(['"]consent['"]/i.test(html);
  signals.consent_mode_v2 = /ad_user_data|ad_personalization/i.test(html);
  signals.server_side_gtm = /transport_url|first-party-collection|sgtm|server-side/i.test(html);
  return signals;
}

// ---------------------------------------------------------------------------
// Brand info (Open Graph + favicon)
// ---------------------------------------------------------------------------
function extractBrandInfo(html, sourceUrl) {
  function findMeta(key) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp('<meta\\s+[^>]*property=["\']' + escaped + '["\'][^>]*content=["\']([^"\']+)["\']', 'i'),
      new RegExp('<meta\\s+[^>]*content=["\']([^"\']+)["\'][^>]*property=["\']' + escaped + '["\']', 'i'),
      new RegExp('<meta\\s+[^>]*name=["\']' + escaped + '["\'][^>]*content=["\']([^"\']+)["\']', 'i'),
      new RegExp('<meta\\s+[^>]*content=["\']([^"\']+)["\'][^>]*name=["\']' + escaped + '["\']', 'i')
    ];
    for (let i = 0; i < patterns.length; i++) {
      const m = html.match(patterns[i]);
      if (m) return m[1].trim();
    }
    return null;
  }
  function absolutize(u) {
    if (!u) return null;
    if (u.startsWith('http://') || u.startsWith('https://')) return u;
    try { return new URL(u, sourceUrl).toString(); } catch (e) { return null; }
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
    favicon: favicon,
    site_name: findMeta('og:site_name')
  };
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------
function buildAuditPrompt(url, gtmId, parsed, signals) {
  const tagTypeCounts = {};
  ((parsed && parsed.tags) || []).forEach(function (t) {
    tagTypeCounts[t.type] = (tagTypeCounts[t.type] || 0) + 1;
  });
  const sortedTypes = Object.entries(tagTypeCounts).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 15);

  const variableTypes = {};
  ((parsed && parsed.variables) || []).forEach(function (v) {
    variableTypes[v.type] = (variableTypes[v.type] || 0) + 1;
  });

  const triggerTypes = {};
  ((parsed && parsed.predicates) || []).forEach(function (p) {
    triggerTypes[p.type] = (triggerTypes[p.type] || 0) + 1;
  });

  return 'You are a senior Google Tag Manager auditor performing a real-world inspection of a website\'s tracking setup.\n\n' +
    'WEBSITE: ' + url + '\n' +
    'GTM CONTAINER: ' + gtmId + '\n\n' +
    'PARSED CONTAINER DATA:\n' +
    '- Total tags: ' + ((parsed && parsed.tag_count) || 0) + '\n' +
    '- Total variables: ' + ((parsed && parsed.variable_count) || 0) + '\n' +
    '- Total trigger conditions: ' + ((parsed && parsed.predicate_count) || 0) + '\n' +
    '- Total rules: ' + ((parsed && parsed.rule_count) || 0) + '\n' +
    '- Container version: ' + ((parsed && parsed.version) || 'unknown') + '\n\n' +
    'TOP TAG TYPES (real counts from the container):\n' +
    sortedTypes.map(function (e) { return '- ' + e[0] + ': ' + e[1]; }).join('\n') + '\n\n' +
    'VARIABLE TYPE BREAKDOWN:\n' +
    Object.entries(variableTypes).slice(0, 10).map(function (e) { return '- ' + e[0] + ': ' + e[1]; }).join('\n') + '\n\n' +
    'TRIGGER TYPE BREAKDOWN:\n' +
    Object.entries(triggerTypes).slice(0, 10).map(function (e) { return '- ' + e[0] + ': ' + e[1]; }).join('\n') + '\n\n' +
    'PAGE-LEVEL SIGNALS (from the rendered HTML):\n' +
    '- GA4 IDs found on page: ' + (signals.ga4_ids.join(', ') || 'none') + '\n' +
    '- Universal Analytics IDs (DEPRECATED): ' + (signals.ga_universal_ids.join(', ') || 'none') + '\n' +
    '- Google Ads IDs: ' + (signals.google_ads_ids.join(', ') || 'none') + '\n' +
    '- Floodlight IDs: ' + (signals.floodlight_ids.join(', ') || 'none') + '\n' +
    '- Consent Mode v1 signals: ' + signals.consent_mode_v1 + '\n' +
    '- Consent Mode v2 signals (ad_user_data / ad_personalization): ' + signals.consent_mode_v2 + '\n' +
    '- Server-side GTM detected: ' + signals.server_side_gtm + '\n' +
    '- Other tracking tools detected on page: ' + (signals.detected_tools.join(', ') || 'none') + '\n\n' +
    'AUDIT PRIORITIES (2026):\n' +
    '1. Universal Analytics was sunset July 2023. Any UA reference is HIGH priority.\n' +
    '2. Consent Mode v2 is required for EEA traffic since March 2024. Missing ad_user_data / ad_personalization is HIGH priority.\n' +
    '3. GA4 event names MUST be snake_case.\n' +
    '4. Conversion Linker is required when Google Ads tags are present.\n' +
    '5. Server-side GTM is a maturity indicator for ecommerce and high-traffic sites.\n' +
    '6. Watch for duplicate firing — e.g. Shopify native pixel + GTM-based GA4 = double events.\n\n' +
    'RETURN STRICT JSON (no markdown fences, no preamble):\n\n' +
    '{\n' +
    '  "site_summary": "1-2 sentence summary of the tracking setup found",\n' +
    '  "health_score": <0-100>,\n' +
    '  "tags_found": <number>,\n' +
    '  "triggers_found": <number>,\n' +
    '  "variables_found": <number>,\n' +
    '  "issues_count": <number>,\n' +
    '  "ga4": {\n' +
    '    "present": <bool>,\n' +
    '    "measurement_id": "<G-XXX or None>",\n' +
    '    "via": "<GTM | gtag.js | None>",\n' +
    '    "ecommerce": <bool>,\n' +
    '    "consent_mode": <bool>,\n' +
    '    "consent_mode_v2": <bool>,\n' +
    '    "note": "<one-line status>"\n' +
    '  },\n' +
    '  "tags": [\n' +
    '    { "name": "<actual tag type or name from container>", "status": "<pass|warn|fail|info>", "detail": "<what it does>", "recommendation": "<optional fix>" }\n' +
    '  ],\n' +
    '  "triggers": [\n' +
    '    { "name": "<trigger type>", "status": "<pass|warn|fail|info>", "detail": "<short>", "recommendation": "<optional>" }\n' +
    '  ],\n' +
    '  "top_issues": [\n' +
    '    { "title": "<short>", "priority": "<high|medium|low>", "detail": "<longer>", "fix": "<actionable step>" }\n' +
    '  ],\n' +
    '  "quick_wins": [ "<short imperative>", ... ]\n' +
    '}\n\n' +
    'Use 4-6 entries for tags, 3-5 for triggers, 4-6 for top_issues, 3-5 for quick_wins. Use ACTUAL names from the data above — do not invent.';
}

// ---------------------------------------------------------------------------
// Handler — Node.js CommonJS Serverless Function
// ---------------------------------------------------------------------------
const UA_STRING = 'Mozilla/5.0 (compatible; GTMAuditor/2.0; +https://github.com/iamgoan123/gtm-auditor)';

async function fetchWithTimeout(url, timeoutMs) {
  timeoutMs = timeoutMs || 20000;
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA_STRING, 'Accept': 'text/html,*/*' },
      redirect: 'follow'
    });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (e) { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }
  let url = body && body.url;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  url = url.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
  try { new URL(url); } catch (e) { return res.status(400).json({ error: 'Invalid URL' }); }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not set in Vercel environment variables' });
  }

  // 1. Fetch page HTML
  let html;
  try {
    const r = await fetchWithTimeout(url);
    if (!r.ok) return res.status(400).json({ error: 'Could not fetch ' + url + ' (HTTP ' + r.status + ')' });
    html = await r.text();
  } catch (err) {
    return res.status(400).json({ error: 'Fetch failed: ' + err.message });
  }

  // 2. Extract from page
  const signals = extractPageSignals(html);
  const brand = extractBrandInfo(html, url);
  const gtmMatches = Array.from(new Set(html.match(/GTM-[A-Z0-9]{4,12}/g) || []));

  // 3. No GTM → return early
  if (gtmMatches.length === 0) {
    return res.status(200).json({ url: url, noGtm: true, brand: brand, signals: signals });
  }

  // 4. Parse container
  const gtmId = gtmMatches[0];
  let parsed = null;
  try {
    const r = await fetchWithTimeout('https://www.googletagmanager.com/gtm.js?id=' + gtmId);
    if (r.ok) {
      const script = await r.text();
      parsed = parseGtmContainer(script);
    }
  } catch (_) { /* swallow */ }

  // 5. Call Groq
  const prompt = buildAuditPrompt(url, gtmId, parsed, signals);
  let audit;
  try {
    const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 2400
      })
    });
    if (!groqResp.ok) {
      const t = await groqResp.text();
      return res.status(500).json({ error: 'Groq API error (' + groqResp.status + '): ' + t.slice(0, 300) });
    }
    const data = await groqResp.json();
    let text = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    try { audit = JSON.parse(text); }
    catch (e) { return res.status(500).json({ error: 'AI returned invalid JSON', raw: text.slice(0, 400) }); }
  } catch (err) {
    return res.status(500).json({ error: 'AI call failed: ' + err.message });
  }

  return res.status(200).json({
    url: url,
    gtmId: gtmId,
    brand: brand,
    signals: signals,
    parsed: parsed,
    audit: audit
  });
};
