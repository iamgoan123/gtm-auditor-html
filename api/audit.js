// GTM Auditor — Vercel Serverless Function (Node.js CommonJS)
// Fetches a target URL, parses any GTM container found, extracts page signals,
// extracts Open Graph brand info, and calls Groq for an AI audit.

// ---------------------------------------------------------------------------
// GTM internal type code -> human-readable name
// ---------------------------------------------------------------------------
const GTM_TAG_TYPES = {
  // Tags
  '__html': 'Custom HTML',
  '__img': 'Custom Image',
  '__googtag': 'Google Tag',
  '__gaawe': 'GA4 Event',
  '__gct': 'Google Conversion Tracking',
  '__ua': 'Universal Analytics (DEPRECATED)',
  '__awct': 'Google Ads Conversion',
  '__sp': 'Google Ads Remarketing',
  '__cl': 'Conversion Linker',
  '__flc': 'Floodlight Counter',
  '__fls': 'Floodlight Sales',
  '__cegg': 'Crazy Egg',
  '__cvt_template': 'Custom Template',
  // Triggers
  '__lcl': 'Link Click',
  '__cl_trigger': 'Click',
  '__evl': 'Element Visibility',
  '__fsl': 'Form Submission',
  '__hl': 'History Change',
  '__jel': 'JavaScript Error',
  '__sdl': 'Scroll Depth',
  '__tl': 'Timer',
  '__ytl': 'YouTube Video',
  '__pageview': 'Page View',
  '__dl_ready': 'DOM Ready',
  '__win_load': 'Window Loaded',
  // Variables
  '__c': 'Constant',
  '__v': 'Data Layer Variable',
  '__u': 'URL',
  '__k': '1st Party Cookie',
  '__j': 'JavaScript Variable',
  '__jsm': 'Custom JavaScript',
  '__r': 'Random Number',
  '__e': 'Custom Event',
  '__remm': 'Regex Table',
  '__smm': 'Lookup Table',
  '__gas': 'Google Analytics Settings',
  '__uv': 'Auto Event Variable',
  '__f': 'Referrer Variable',
  '__aev': 'Auto Event Variable',
  '__ctv': 'Container Version Variable'
};

// ---------------------------------------------------------------------------
// Third-party tool detection — runtime signatures only.
// Every regex requires a JS namespace, a specific CDN host, or a distinctive
// runtime call. No loose substring matches against brand names.
// ---------------------------------------------------------------------------
const TRACKING_SIGNATURES = {
  // Analytics platforms
  adobe_analytics:  /AppMeasurement|s_code\.js|s\.t\(\)|s\.tl\(|adobedtm\.com|\.sc\.omtrdc\.net|assets\.adobedtm\.com/i,
  matomo:           /_paq\.push|matomo\.js|piwik\.js|matomo\.cloud|\/matomo\.php/i,
  heap:             /heap\.load\(|heap\.track\(|cdn\.heapanalytics\.com/i,
  snowplow:         /snowplow\(|com\.snowplowanalytics|\/sp\.js/i,
  tealium:          /utag\.js|utag_data|tags\.tiqcdn\.com/i,
  amplitude:        /amplitude\.getInstance|amplitude\.init|cdn\.amplitude\.com|api\.amplitude\.com/i,
  mixpanel:         /mixpanel\.init|mixpanel\.track|cdn\.mxpnl\.com|api\.mixpanel\.com/i,
  segment:          /analytics\.load\(|cdn\.segment\.(?:com|io)|analytics\.track\(/i,
  fullstory:        /fullstory\.com\/s\/fs\.js|FS\.identify|window\['_fs_'\]/i,
  hotjar:           /static\.hotjar\.com|hjBootstrap|\(window\.hj\s*=/i,
  clarity:          /clarity\.ms\/tag|window\.clarity\s*=|clarity\("set"/i,

  // Ad pixels
  meta_pixel:       /connect\.facebook\.net\/[^"']+\/fbevents\.js|fbq\(\s*['"]init['"]|_fbq\s*=/i,
  tiktok:           /analytics\.tiktok\.com|ttq\.load\(|ttq\.track\(/i,
  pinterest:        /s\.pinimg\.com\/ct\/|pintrk\(/i,
  linkedin_insight: /snap\.licdn\.com\/li\.lms-analytics|_linkedin_partner_id|_linkedin_data_partner_ids/i,
  x_twitter:        /static\.ads-twitter\.com\/uwt\.js|twq\(\s*['"](?:init|track|config)/i,
  snap_pixel:       /sc-static\.net\/scevent|snaptr\(\s*['"](?:init|track)/i,
  bing_uet:         /bat\.bing\.com\/bat\.js|window\.uetq\s*=|uetq\.push/i,
  reddit_pixel:     /redditstatic\.com\/ads\/pixel|rdt\(\s*['"](?:init|track)/i,

  // Email / marketing automation
  klaviyo:          /static\.klaviyo\.com|_learnq\.push|klaviyo\.com\/onsite|klaviyo_subscriber/i,
  hubspot:          /js\.hs-scripts\.com|js\.hs-analytics\.net|_hsq\.push/i,

  // Consent management
  onetrust:         /cdn\.cookielaw\.org|OneTrust\.|window\.Optanon|otSDKStub\.js/i,
  cookiebot:        /consent\.cookiebot\.com|Cookiebot\.consent|cookiebot\.com\/uc\.js/i,
  usercentrics:     /app\.usercentrics\.eu|usercentrics\.com\/browser-ui|window\.UC_UI/i,

  // Ecommerce platforms
  shopify:          /cdn\.shopify\.com|Shopify\.shop|shopify-checkout-api-token|\/cdn\/shop\//i,
  woocommerce:      /woocommerce-no-js|wc-ajax|wc_add_to_cart_params|\/wp-content\/plugins\/woocommerce\//i,
  magento:          /Mage\.Cookies|Magento_[A-Z][a-zA-Z]+|\/skin\/frontend\/|\/pub\/static\/version\d+|var\s+BASE_URL\s*=.*\/index\.php/i
};

// Pretty labels for AI prompt + frontend display
const TOOL_LABELS = {
  adobe_analytics: 'Adobe Analytics',
  matomo: 'Matomo',
  heap: 'Heap',
  snowplow: 'Snowplow',
  tealium: 'Tealium',
  amplitude: 'Amplitude',
  mixpanel: 'Mixpanel',
  segment: 'Segment',
  fullstory: 'FullStory',
  hotjar: 'Hotjar',
  clarity: 'Microsoft Clarity',
  meta_pixel: 'Meta Pixel',
  tiktok: 'TikTok Pixel',
  pinterest: 'Pinterest Tag',
  linkedin_insight: 'LinkedIn Insight',
  x_twitter: 'X (Twitter) Pixel',
  snap_pixel: 'Snap Pixel',
  bing_uet: 'Bing UET',
  reddit_pixel: 'Reddit Pixel',
  klaviyo: 'Klaviyo',
  hubspot: 'HubSpot',
  onetrust: 'OneTrust',
  cookiebot: 'Cookiebot',
  usercentrics: 'Usercentrics',
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  magento: 'Magento'
};

// ---------------------------------------------------------------------------
// Brace-balanced extraction of the GTM container's `var data = { ... }`
// ---------------------------------------------------------------------------
function extractBalancedObject(text, startIdx) {
  if (text[startIdx] !== '{') return null;
  let depth = 0;
  let inString = false;
  let stringChar = null;
  let escape = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (inString) {
      if (ch === stringChar) { inString = false; stringChar = null; }
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

function parseGtmContainer(script) {
  const startMatch = script.match(/var\s+data\s*=\s*/);
  if (!startMatch) return null;
  const braceIdx = startMatch.index + startMatch[0].length;
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
  const ogImage = absolutize(findMeta('og:image'));
  const faviconMatch = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i);
  const favicon = absolutize(faviconMatch ? faviconMatch[1] : '/favicon.ico');

  return {
    title: findMeta('og:title') || title,
    description: findMeta('og:description') || findMeta('description'),
    image: ogImage,
    favicon: favicon,
    site_name: findMeta('og:site_name')
  };
}

// ---------------------------------------------------------------------------
// Audit prompt builder
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

  const prettyTools = signals.detected_tools.map(function (t) {
    return TOOL_LABELS[t] || t;
  }).join(', ');

  return 'You are a senior Google Tag Manager auditor performing a real-world inspection of a website\'s tracking setup. Be RIGOROUS and SITE-SPECIFIC. The health score and issue count MUST vary based on actual findings — do not return generic mid-range numbers.\n\n' +
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
    '- Other tracking tools detected on page: ' + (prettyTools || 'none') + '\n\n' +
    'SCORING RUBRIC — START at 100, then subtract from the score for every finding below that is TRUE for this site. Do NOT round to 60. Do NOT default to middle. Compute it exactly.\n\n' +
    'CRITICAL DEDUCTIONS (-15 each):\n' +
    '  -15 if Universal Analytics IDs are present (UA was sunset July 2023)\n' +
    '  -15 if NO GA4 measurement ID is found anywhere\n' +
    '  -15 if Consent Mode v2 signals are absent (required for EEA traffic since Mar 2024)\n' +
    '  -15 if Google Ads is detected but NO Conversion Linker tag found\n\n' +
    'MAJOR DEDUCTIONS (-8 each):\n' +
    '  -8 if Google Ads conversion tag exists but no Enhanced Conversions configuration\n' +
    '  -8 if duplicate firing risk detected (e.g. Shopify native + GTM GA4)\n' +
    '  -8 if container has >100 tags (governance concern — bloat risk)\n' +
    '  -8 if any tag is paused but appears to be a primary tracker (GA4, Ads, Meta)\n\n' +
    'MINOR DEDUCTIONS (-4 each):\n' +
    '  -4 if no server-side GTM detected on a site with >50 tags (maturity signal)\n' +
    '  -4 if Adobe Analytics AND GA4 both present (dual-stack overhead)\n' +
    '  -4 if container version looks stale relative to tag count (<v50 with >80 tags = neglected)\n' +
    '  -4 per third-party tracker without a corresponding consent tie-in\n\n' +
    'BONUSES (+5 each, capped at +10 total):\n' +
    '  +5 if Server-side GTM is detected\n' +
    '  +5 if Consent Mode v2 is properly implemented\n' +
    '  +5 if Enhanced Conversions are present\n\n' +
    'After applying the rubric, clamp the score to 0-100. The score MUST reflect actual findings — never use 60 as a default. Sites with clean modern setups should score 80+. Sites with UA still present and no Consent Mode v2 should score 40-55. Sites with multiple critical issues should score below 40.\n\n' +
    'ISSUES_COUNT MUST EQUAL the number of distinct deductions applied above. It is NOT a fixed 10. A clean site might have 0-2 issues. A neglected site might have 8-12.\n\n' +
    'RETURN STRICT JSON (no markdown fences, no preamble):\n\n' +
    '{\n' +
    '  "site_summary": "1-2 sentence summary of THIS site\'s tracking setup — mention what platform, what analytics, key gap",\n' +
    '  "health_score": <computed 0-100 — show your work in scoring_breakdown below>,\n' +
    '  "scoring_breakdown": [ "Started at 100", "-15 UA detected", "-15 no Consent Mode v2", "+5 server-side GTM", ... ],\n' +
    '  "tags_found": <number from parsed data>,\n' +
    '  "triggers_found": <number from parsed data>,\n' +
    '  "variables_found": <number from parsed data>,\n' +
    '  "issues_count": <number — count of distinct deductions applied above>,\n' +
    '  "ga4": {\n' +
    '    "present": <bool>,\n' +
    '    "measurement_id": "<G-XXX or None>",\n' +
    '    "via": "<GTM | gtag.js | None>",\n' +
    '    "ecommerce": <bool>,\n' +
    '    "consent_mode": <bool>,\n' +
    '    "consent_mode_v2": <bool>,\n' +
    '    "note": "<one-line status specific to this site>"\n' +
    '  },\n' +
    '  "tags": [\n' +
    '    { "name": "<actual tag type from container>", "status": "<pass|warn|fail|info>", "detail": "<what it does on THIS site>", "recommendation": "<optional fix>" }\n' +
    '  ],\n' +
    '  "triggers": [\n' +
    '    { "name": "<trigger type>", "status": "<pass|warn|fail|info>", "detail": "<short>", "recommendation": "<optional>" }\n' +
    '  ],\n' +
    '  "top_issues": [\n' +
    '    { "title": "<short>", "priority": "<high|medium|low>", "detail": "<longer, specific to this site>", "fix": "<actionable step>" }\n' +
    '  ],\n' +
    '  "quick_wins": [ "<short imperative tied to a real finding>", ... ]\n' +
    '}\n\n' +
    'Use 4-6 tag entries, 3-5 trigger entries, top_issues count = issues_count, 3-5 quick wins. Use ACTUAL names from the data — do not invent. The summary, score, and issues MUST be specific to THIS website — generic answers fail the audit.';
}

// ---------------------------------------------------------------------------
// Handler — Node.js CommonJS Serverless Function
// ---------------------------------------------------------------------------
// Real Chrome UA + standard browser headers to defeat basic bot detection.
// High-security sites (Cloudflare/Akamai WAF) will still 403 — that's a site
// policy, not a tool failure, and we surface a clear message when it happens.
const UA_STRING = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BROWSER_HEADERS = {
  'User-Agent': UA_STRING,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-AU,en;q=0.9,en-US;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

async function fetchWithTimeout(url, timeoutMs) {
  timeoutMs = timeoutMs || 20000;
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: BROWSER_HEADERS,
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
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url is required' });

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
    if (!r.ok) {
      let msg;
      if (r.status === 403 || r.status === 401) {
        msg = url + ' blocked automated access (HTTP ' + r.status + '). Site uses bot defense (likely Cloudflare/Akamai). Try manually via view-source: in the browser.';
      } else if (r.status === 429) {
        msg = url + ' rate-limited the auditor (HTTP 429). Wait a minute and retry.';
      } else {
        msg = 'Could not fetch ' + url + ' (HTTP ' + r.status + ')';
      }
      return res.status(400).json({ error: msg });
    }
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
