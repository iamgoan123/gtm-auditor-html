// GTM Auditor v2.1 — Vercel Serverless Function (Node.js CommonJS)
// ─────────────────────────────────────────────────────────────
// Multi-page tracking audit:
//   1. Fetch homepage
//   2. Discover PDP, collection, cart URLs
//   3. Parallel-fetch those 3 pages + gtm.js (5s per fetch budget)
//   4. Per-page signal extraction (incl. dataLayer events, gtag events, JSON-LD schemas)
//   5. Aggregate signals across pages + extract evidence from gtm.js
//   6. Call Groq with rich, multi-page context + deterministic scoring rubric
//   7. Return audit + per-page status (graceful degradation)
//
// Overall function budget: 30s (maxDuration in vercel.json)

// ---------------------------------------------------------------------------
// Browser-realistic request headers (defeats basic bot detection)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// GTM internal type code -> human-readable name
// ---------------------------------------------------------------------------
const GTM_TAG_TYPES = {
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
  '__cvt_template': 'Custom Template',
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
// Third-party tool detection — runtime signatures only
// ---------------------------------------------------------------------------
const TRACKING_SIGNATURES = {
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
  meta_pixel:       /connect\.facebook\.net\/[^"']+\/fbevents\.js|fbq\(\s*['"]init['"]|_fbq\s*=/i,
  tiktok:           /analytics\.tiktok\.com|ttq\.load\(|ttq\.track\(/i,
  pinterest:        /s\.pinimg\.com\/ct\/|pintrk\(/i,
  linkedin_insight: /snap\.licdn\.com\/li\.lms-analytics|_linkedin_partner_id|_linkedin_data_partner_ids/i,
  x_twitter:        /static\.ads-twitter\.com\/uwt\.js|twq\(\s*['"](?:init|track|config)/i,
  snap_pixel:       /sc-static\.net\/scevent|snaptr\(\s*['"](?:init|track)/i,
  bing_uet:         /bat\.bing\.com\/bat\.js|window\.uetq\s*=|uetq\.push/i,
  reddit_pixel:     /redditstatic\.com\/ads\/pixel|rdt\(\s*['"](?:init|track)/i,
  klaviyo:          /static\.klaviyo\.com|_learnq\.push|klaviyo\.com\/onsite|klaviyo_subscriber/i,
  hubspot:          /js\.hs-scripts\.com|js\.hs-analytics\.net|_hsq\.push/i,
  onetrust:         /cdn\.cookielaw\.org|OneTrust\.|window\.Optanon|otSDKStub\.js/i,
  cookiebot:        /consent\.cookiebot\.com|Cookiebot\.consent|cookiebot\.com\/uc\.js/i,
  usercentrics:     /app\.usercentrics\.eu|usercentrics\.com\/browser-ui|window\.UC_UI/i,
  shopify:          /cdn\.shopify\.com|Shopify\.shop|shopify-checkout-api-token|\/cdn\/shop\//i,
  woocommerce:      /woocommerce-no-js|wc-ajax|wc_add_to_cart_params|\/wp-content\/plugins\/woocommerce\//i,
  magento:          /Mage\.Cookies|Magento_[A-Z][a-zA-Z]+|\/skin\/frontend\/|\/static\/version\d+\/frontend\/|\/pub\/static\/version\d+|var\s+BASE_URL\s*=.*\/index\.php|text\/x-magento-init/i
};

const TOOL_LABELS = {
  adobe_analytics: 'Adobe Analytics', matomo: 'Matomo', heap: 'Heap', snowplow: 'Snowplow',
  tealium: 'Tealium', amplitude: 'Amplitude', mixpanel: 'Mixpanel', segment: 'Segment',
  fullstory: 'FullStory', hotjar: 'Hotjar', clarity: 'Microsoft Clarity',
  meta_pixel: 'Meta Pixel', tiktok: 'TikTok Pixel', pinterest: 'Pinterest Tag',
  linkedin_insight: 'LinkedIn Insight', x_twitter: 'X (Twitter) Pixel', snap_pixel: 'Snap Pixel',
  bing_uet: 'Bing UET', reddit_pixel: 'Reddit Pixel',
  klaviyo: 'Klaviyo', hubspot: 'HubSpot',
  onetrust: 'OneTrust', cookiebot: 'Cookiebot', usercentrics: 'Usercentrics',
  shopify: 'Shopify', woocommerce: 'WooCommerce', magento: 'Magento'
};

// ===========================================================================
// FETCH HELPERS
// ===========================================================================

async function fetchWithTimeout(url, timeoutMs) {
  timeoutMs = timeoutMs || 5000;
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

// Fetch a page and return {ok, status, html} — never throws
async function safeFetch(url, timeoutMs) {
  try {
    const r = await fetchWithTimeout(url, timeoutMs);
    if (!r.ok) return { ok: false, status: 'http_' + r.status, html: '' };
    const html = await r.text();
    return { ok: true, status: 'ok', html: html, finalUrl: r.url };
  } catch (err) {
    return { ok: false, status: err.name === 'AbortError' ? 'timeout' : 'fetch_error', html: '' };
  }
}

// ===========================================================================
// URL DISCOVERY — find PDP, collection, cart from the homepage HTML
// ===========================================================================

function discoverInternalLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const seen = new Set();
  const links = [];
  const re = /<a[^>]+href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let abs;
    try { abs = new URL(m[1], baseUrl); } catch (e) { continue; }
    if (abs.hostname !== base.hostname) continue;
    if (abs.pathname === '/' || abs.pathname === base.pathname) continue;
    const key = abs.pathname + abs.search;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(abs.toString());
  }

  // PDP patterns — order matters, more specific first
  const pdpRegexes = [
    /\/products\/[^/?#]+/i,
    /\/product\/[^/?#]+/i,
    /\/p\/[a-z0-9-]+/i,
    /\/item\/[^/?#]+/i,
    /\/dp\/[A-Z0-9]+/  // Amazon-style
  ];
  // Collection patterns — includes Shopify, Magento, custom platforms, and fashion gender-prefix patterns
  const collectionRegexes = [
    /\/collections\/[^/?#]+$/i,
    /\/collection\/[^/?#]+/i,
    /\/category\/[^/?#]+/i,
    /\/categories\/[^/?#]+/i,
    /\/shop\/[^/?#]+/i,
    /\/c\/[^/?#]+/i,
    /\/(?:women|womens|men|mens|kids|girls|boys|baby|sale)\/[a-z0-9-]+\/[a-z0-9-]+/i,  // /women/sneakers/all-sneakers
    /\/(?:women|womens|men|mens|kids|girls|boys|baby|sale)\/[a-z0-9-]+$/i  // /women/sneakers
  ];

  function findFirst(regexes, exclude) {
    for (const re of regexes) {
      const found = links.find(function (l) {
        if (exclude && exclude.some(function (ex) { return ex.test(l); })) return false;
        return re.test(l);
      });
      if (found) return found;
    }
    return null;
  }

  const pdp = findFirst(pdpRegexes);
  const collection = findFirst(collectionRegexes, pdpRegexes);

  // Cart: prefer a discovered cart link, else fall back to common conventions
  const cartLink = links.find(function (l) {
    return /\/cart(\/|$|\?)|\/checkout\/cart|\/basket|\/shopping-bag/i.test(l);
  });
  let cart = cartLink;
  if (!cart) {
    // Fallback: construct /cart on same origin
    cart = base.origin + '/cart';
  }

  return { pdp: pdp, cart: cart, collection: collection };
}

// ===========================================================================
// PER-PAGE SIGNAL EXTRACTION
// ===========================================================================

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
    datalayer_events: [],
    gtag_events: [],
    json_ld_schemas: []
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

  // dataLayer event detection
  const dlEvents = new Set();
  const dlRe = /dataLayer\.push\s*\(\s*\{[^}]*?["']?event["']?\s*:\s*["']([^"']+)["']/g;
  let dlMatch;
  while ((dlMatch = dlRe.exec(html)) !== null) {
    dlEvents.add(dlMatch[1]);
    if (dlEvents.size > 30) break;
  }
  signals.datalayer_events = Array.from(dlEvents);

  // gtag event detection
  const gtagEvents = new Set();
  const gtagRe = /gtag\s*\(\s*['"]event['"]\s*,\s*['"]([^'"]+)['"]/g;
  let gtagMatch;
  while ((gtagMatch = gtagRe.exec(html)) !== null) {
    gtagEvents.add(gtagMatch[1]);
    if (gtagEvents.size > 30) break;
  }
  signals.gtag_events = Array.from(gtagEvents);

  // JSON-LD schema detection
  const schemas = new Set();
  const ldRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch;
  while ((ldMatch = ldRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(ldMatch[1].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      items.forEach(function (item) {
        if (item && item['@type']) {
          const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
          types.forEach(function (t) { schemas.add(t); });
        }
      });
    } catch (e) { /* malformed JSON-LD, skip */ }
  }
  signals.json_ld_schemas = Array.from(schemas);

  return signals;
}

// Merge signals across multiple pages — union arrays, OR booleans
function aggregateSignals(signalsList) {
  const result = {
    detected_tools: [],
    ga4_ids: [],
    ga_universal_ids: [],
    google_ads_ids: [],
    floodlight_ids: [],
    consent_mode_v1: false,
    consent_mode_v2: false,
    server_side_gtm: false,
    datalayer_events: [],
    gtag_events: [],
    json_ld_schemas: []
  };
  const arrayKeys = ['detected_tools', 'ga4_ids', 'ga_universal_ids', 'google_ads_ids', 'floodlight_ids', 'datalayer_events', 'gtag_events', 'json_ld_schemas'];
  const boolKeys = ['consent_mode_v1', 'consent_mode_v2', 'server_side_gtm'];

  signalsList.forEach(function (s) {
    if (!s) return;
    arrayKeys.forEach(function (k) {
      (s[k] || []).forEach(function (v) {
        if (!result[k].includes(v)) result[k].push(v);
      });
    });
    boolKeys.forEach(function (k) { if (s[k]) result[k] = true; });
  });

  return result;
}

// ===========================================================================
// GTM CONTAINER PARSING + EVIDENCE EXTRACTION
// ===========================================================================

function extractBalancedObject(text, startIdx) {
  if (text[startIdx] !== '{') return null;
  let depth = 0, inString = false, stringChar = null, escape = false;
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

// Pull IDs and config flags from the raw gtm.js text — this is what fixes the
// "GA4 present but no measurement ID" bug. Container-configured IDs live in
// vtp_tagId / vtp_measurementId params inside the script, not the page HTML.
function extractContainerEvidence(rawScript) {
  // Pull configured GA4 event names from container tags. Closes the false-negative
  // where view_item / add_to_cart are configured but our static scan can't observe
  // the runtime push (they fire via deferred JS or click handlers we never execute).
  const eventNames = new Set();
  const evRe1 = /"vtp_eventName"\s*:\s*"([a-z_][a-z0-9_]{1,50})"/gi;
  let m;
  while ((m = evRe1.exec(rawScript)) !== null) {
    eventNames.add(m[1]);
    if (eventNames.size > 50) break;
  }
  const evRe2 = /"eventName"\s*:\s*"([a-z_][a-z0-9_]{1,50})"/gi;
  while ((m = evRe2.exec(rawScript)) !== null) {
    eventNames.add(m[1]);
    if (eventNames.size > 50) break;
  }

  return {
    ga4_ids: Array.from(new Set(rawScript.match(/G-[A-Z0-9]{6,12}/g) || [])),
    google_tag_ids: Array.from(new Set(rawScript.match(/GT-[A-Z0-9]{6,12}/g) || [])),
    google_ads_ids: Array.from(new Set(rawScript.match(/AW-\d{6,12}/g) || [])),
    universal_analytics_ids: Array.from(new Set(rawScript.match(/UA-\d{4,12}-\d+/g) || [])),
    floodlight_ids: Array.from(new Set(rawScript.match(/DC-\d{6,12}/g) || [])),
    configured_ga4_events: Array.from(eventNames),
    has_conversion_linker: /"__cl"|Conversion\s*Linker/i.test(rawScript),
    has_consent_default: /consent['"\s]*,\s*['"]default/i.test(rawScript),
    has_enhanced_conversions: /enhanced_conversions|allow_enhanced_conversions|user_data/i.test(rawScript),
    has_server_side_transport: /transport_url/i.test(rawScript)
  };
}

// ===========================================================================
// BRAND INFO (Open Graph)
// ===========================================================================

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

// ===========================================================================
// AUDIT PROMPT — rich, multi-page context + deterministic scoring rubric
// ===========================================================================

function buildAuditPrompt(url, gtmId, parsed, signals, pagesAudited, evidence) {
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

  const prettyTools = signals.detected_tools.map(function (t) { return TOOL_LABELS[t] || t; }).join(', ');
  const pagesSummary = pagesAudited.map(function (p) { return '  - ' + p.type + ': ' + p.status + ' (' + (p.url || 'not found') + ')'; }).join('\n');

  return 'You are a senior Google Tag Manager auditor performing a real-world inspection of a multi-page tracking setup. Be RIGOROUS and SITE-SPECIFIC. Health score and issue count MUST vary based on actual findings — never default to mid-range numbers.\n\n' +
    'WEBSITE: ' + url + '\n' +
    'GTM CONTAINER: ' + (gtmId || 'not found') + '\n\n' +
    'PAGES AUDITED (per-page fetch status):\n' + pagesSummary + '\n\n' +
    'PARSED CONTAINER DATA:\n' +
    '- Total tags: ' + ((parsed && parsed.tag_count) || 0) + '\n' +
    '- Total variables: ' + ((parsed && parsed.variable_count) || 0) + '\n' +
    '- Total trigger conditions: ' + ((parsed && parsed.predicate_count) || 0) + '\n' +
    '- Total rules: ' + ((parsed && parsed.rule_count) || 0) + '\n' +
    '- Container version: ' + ((parsed && parsed.version) || 'unknown') + '\n\n' +
    'TOP TAG TYPES IN CONTAINER:\n' +
    (sortedTypes.length ? sortedTypes.map(function (e) { return '- ' + e[0] + ': ' + e[1]; }).join('\n') : '(none)') + '\n\n' +
    'CONTAINER EVIDENCE (extracted from inside gtm.js — IDs and config flags):\n' +
    '- GA4 measurement IDs in container: ' + ((evidence && evidence.ga4_ids.join(', ')) || 'none') + '\n' +
    '- Google Tag (GT-) IDs: ' + ((evidence && evidence.google_tag_ids.join(', ')) || 'none') + '\n' +
    '- Google Ads (AW-) IDs in container: ' + ((evidence && evidence.google_ads_ids.join(', ')) || 'none') + '\n' +
    '- Universal Analytics IDs in container (DEPRECATED): ' + ((evidence && evidence.universal_analytics_ids.join(', ')) || 'none') + '\n' +
    '- Floodlight IDs in container: ' + ((evidence && evidence.floodlight_ids.join(', ')) || 'none') + '\n' +
    '- Conversion Linker tag present: ' + (evidence ? evidence.has_conversion_linker : 'unknown') + '\n' +
    '- Consent Mode default state set in container: ' + (evidence ? evidence.has_consent_default : 'unknown') + '\n' +
    '- Enhanced Conversions flagged in container: ' + (evidence ? evidence.has_enhanced_conversions : 'unknown') + '\n' +
    '- transport_url (server-side endpoint) configured: ' + (evidence ? evidence.has_server_side_transport : 'unknown') + '\n\n' +
    'AGGREGATED PAGE SIGNALS (across all audited pages):\n' +
    '- GA4 IDs found on pages: ' + (signals.ga4_ids.join(', ') || 'none') + '\n' +
    '- Universal Analytics IDs on pages: ' + (signals.ga_universal_ids.join(', ') || 'none') + '\n' +
    '- Google Ads IDs on pages: ' + (signals.google_ads_ids.join(', ') || 'none') + '\n' +
    '- Floodlight IDs on pages: ' + (signals.floodlight_ids.join(', ') || 'none') + '\n' +
    '- Consent Mode v1: ' + signals.consent_mode_v1 + '\n' +
    '- Consent Mode v2 (ad_user_data / ad_personalization): ' + signals.consent_mode_v2 + '\n' +
    '- Server-side GTM page signals: ' + signals.server_side_gtm + '\n' +
    '- dataLayer events fired across pages: ' + (signals.datalayer_events.join(', ') || 'none observed') + '\n' +
    '- gtag events fired: ' + (signals.gtag_events.join(', ') || 'none') + '\n' +
    '- JSON-LD schemas: ' + (signals.json_ld_schemas.join(', ') || 'none') + '\n' +
    '- Other tracking tools on pages: ' + (prettyTools || 'none') + '\n\n' +
    'SCORING RUBRIC — START at 100, then apply each deduction that is TRUE. Compute the math exactly. Do NOT default to 60.\n\n' +
    'CRITICAL DEDUCTIONS (-15 each):\n' +
    '  -15 if Universal Analytics IDs present (UA was sunset July 2023)\n' +
    '  -15 if NO GA4 measurement ID found (check both container evidence AND page signals — they are in container if not on page)\n' +
    '  -15 if Consent Mode v2 absent AND audience is likely to include EEA traffic (.eu / .uk / .de / multilingual sites)\n' +
    '  -15 if Google Ads (AW-) IDs present but Conversion Linker tag NOT present in container\n\n' +
    'MAJOR DEDUCTIONS (-8 each):\n' +
    '  -8 if Google Ads conversion tag exists but enhanced_conversions / user_data is NOT in container evidence\n' +
    '  -8 if PDP was successfully audited but no view_item or add_to_cart dataLayer event observed (broken ecommerce tracking)\n' +
    '  -8 if cart page was successfully audited but no begin_checkout / add_to_cart event observed\n' +
    '  -8 if container has >100 tags (governance risk)\n' +
    '  -8 if duplicate-firing risk visible (e.g. Shopify native pixel + GTM GA4 active simultaneously)\n\n' +
    'MINOR DEDUCTIONS (-4 each):\n' +
    '  -4 if no server-side GTM detected on a site with >50 tags (maturity gap)\n' +
    '  -4 if Adobe Analytics AND GA4 both present (dual-stack overhead)\n' +
    '  -4 if container version <50 with >80 tags (looks neglected)\n' +
    '  -4 per third-party tracker without an obvious consent tie-in (max -12 from this single rule)\n' +
    '  -4 if no JSON-LD Product schema on PDP (SEO/analytics quality miss)\n\n' +
    'BONUSES (+5 each, capped at +15 total):\n' +
    '  +5 if Server-side GTM is confirmed (transport_url OR sgtm signal)\n' +
    '  +5 if Consent Mode v2 properly implemented\n' +
    '  +5 if Enhanced Conversions present\n' +
    '  +5 if dataLayer events look clean and event names use snake_case throughout\n\n' +
    'After applying the rubric, clamp 0-100. A clean modern setup should score 85-95. A neglected setup with UA still firing should score 35-55.\n\n' +
    'ISSUES_COUNT MUST EQUAL the number of distinct deductions actually applied. Clean sites might have 0-2. Neglected sites 8-12.\n\n' +
    'PAGE COVERAGE: If some pages failed to fetch (blocked, timeout), note this in your summary and DO NOT penalise the site for things you could not observe (e.g. don\'t deduct -8 for missing view_item if PDP returned http_403).\n\n' +
    'RETURN STRICT JSON (no markdown fences, no preamble):\n\n' +
    '{\n' +
    '  "site_summary": "1-2 sentences SPECIFIC to this site — platform, analytics setup, biggest gap",\n' +
    '  "health_score": <0-100 computed via rubric>,\n' +
    '  "scoring_breakdown": [ "Started at 100", "-15 UA detected", "-8 no view_item on PDP", "+5 server-side GTM", "Total: 82" ],\n' +
    '  "tags_found": <number>, "triggers_found": <number>, "variables_found": <number>,\n' +
    '  "issues_count": <number — count of deductions applied>,\n' +
    '  "pages_coverage_note": "<1 sentence about which pages were audited successfully and any gaps>",\n' +
    '  "ga4": {\n' +
    '    "present": <bool>,\n' +
    '    "measurement_id": "<G-XXX from container OR page, or None if truly absent>",\n' +
    '    "via": "<GTM | gtag.js | None>",\n' +
    '    "ecommerce": <bool — true if view_item/add_to_cart/begin_checkout observed in dataLayer events>,\n' +
    '    "consent_mode": <bool>,\n' +
    '    "consent_mode_v2": <bool>,\n' +
    '    "note": "<one-line status specific to this site>"\n' +
    '  },\n' +
    '  "ecommerce_events_observed": [ "view_item", "add_to_cart", ... ],\n' +
    '  "tags": [ { "name": "<actual tag type>", "status": "<pass|warn|fail|info>", "detail": "<specific>", "recommendation": "<optional>" } ],\n' +
    '  "triggers": [ { "name": "<trigger type>", "status": "<pass|warn|fail|info>", "detail": "<short>", "recommendation": "<optional>" } ],\n' +
    '  "top_issues": [ { "title": "<short>", "priority": "<high|medium|low>", "detail": "<specific to this site>", "fix": "<actionable step>" } ],\n' +
    '  "quick_wins": [ "<short imperative tied to real finding>", ... ]\n' +
    '}\n\n' +
    'Use 4-6 tags, 3-5 triggers, top_issues count = issues_count, 3-5 quick wins. Names MUST come from actual data. Generic answers fail the audit.';
}

// ===========================================================================
// HANDLER
// ===========================================================================

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

  // ─── Step 1: Fetch homepage ─────────────────────────────────────────────
  const homepageResult = await safeFetch(url, 6000);
  if (!homepageResult.ok) {
    let msg;
    if (homepageResult.status === 'http_403' || homepageResult.status === 'http_401') {
      msg = url + ' blocked automated access. Site uses bot defense (likely Cloudflare/Akamai). Try manually via view-source: in the browser.';
    } else if (homepageResult.status === 'http_429') {
      msg = url + ' rate-limited the auditor. Wait a minute and retry.';
    } else if (homepageResult.status === 'timeout') {
      msg = url + ' took too long to respond (>6s).';
    } else {
      msg = 'Could not fetch ' + url + ' (' + homepageResult.status + ')';
    }
    return res.status(400).json({ error: msg });
  }
  const html = homepageResult.html;

  // ─── Step 2: Discover other URLs + initial signals ──────────────────────
  const brand = extractBrandInfo(html, url);
  const links = discoverInternalLinks(html, url);
  const gtmMatches = Array.from(new Set(html.match(/GTM-[A-Z0-9]{4,12}/g) || []));
  const gtmId = gtmMatches[0] || null;

  // ─── Step 3: Parallel-fetch PDP, cart, collection + gtm.js ──────────────
  const tasks = [];
  const taskMeta = [];
  if (links.pdp)         { tasks.push(safeFetch(links.pdp, 5000));        taskMeta.push({ type: 'pdp', url: links.pdp }); }
  if (links.cart)        { tasks.push(safeFetch(links.cart, 5000));       taskMeta.push({ type: 'cart', url: links.cart }); }
  if (links.collection)  { tasks.push(safeFetch(links.collection, 5000)); taskMeta.push({ type: 'collection', url: links.collection }); }
  if (gtmId)             { tasks.push(safeFetch('https://www.googletagmanager.com/gtm.js?id=' + gtmId, 6000)); taskMeta.push({ type: 'gtm', url: 'gtm.js?id=' + gtmId }); }

  const results = await Promise.all(tasks);

  // ─── Step 4: Process per-page results ───────────────────────────────────
  const pagesAudited = [{ type: 'homepage', url: url, status: 'ok' }];
  const pageSignalList = [extractPageSignals(html)];
  let parsedContainer = null;
  let containerEvidence = null;

  results.forEach(function (r, i) {
    const meta = taskMeta[i];
    if (meta.type === 'gtm') {
      if (r.ok) {
        parsedContainer = parseGtmContainer(r.html);
        containerEvidence = extractContainerEvidence(r.html);
        pagesAudited.push({ type: 'gtm.js', url: meta.url, status: 'ok' });
      } else {
        pagesAudited.push({ type: 'gtm.js', url: meta.url, status: r.status });
      }
    } else {
      if (r.ok) {
        pageSignalList.push(extractPageSignals(r.html));
        pagesAudited.push({ type: meta.type, url: meta.url, status: 'ok' });
      } else {
        pagesAudited.push({ type: meta.type, url: meta.url, status: r.status });
      }
    }
  });

  if (!links.pdp)        pagesAudited.push({ type: 'pdp', url: null, status: 'no_link_found' });
  if (!links.collection) pagesAudited.push({ type: 'collection', url: null, status: 'no_link_found' });
  if (!gtmId)            pagesAudited.push({ type: 'gtm.js', url: null, status: 'no_gtm_id_on_homepage' });

  // ─── Step 5: Aggregate signals + merge container evidence ───────────────
  const aggregated = aggregateSignals(pageSignalList);
  if (containerEvidence) {
    // Merge container-extracted IDs into aggregated signals (so AI sees them)
    containerEvidence.ga4_ids.forEach(function (id) { if (!aggregated.ga4_ids.includes(id)) aggregated.ga4_ids.push(id); });
    containerEvidence.google_ads_ids.forEach(function (id) { if (!aggregated.google_ads_ids.includes(id)) aggregated.google_ads_ids.push(id); });
    containerEvidence.universal_analytics_ids.forEach(function (id) { if (!aggregated.ga_universal_ids.includes(id)) aggregated.ga_universal_ids.push(id); });
    containerEvidence.floodlight_ids.forEach(function (id) { if (!aggregated.floodlight_ids.includes(id)) aggregated.floodlight_ids.push(id); });
    if (containerEvidence.has_server_side_transport) aggregated.server_side_gtm = true;
  }

  // ─── Step 6: Call Groq ──────────────────────────────────────────────────
  // If no GTM, still return a partial audit based on page signals
  const prompt = buildAuditPrompt(url, gtmId, parsedContainer, aggregated, pagesAudited, containerEvidence);
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
        temperature: 0.3,
        max_tokens: 2800
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

  // ─── Step 7: Return everything ──────────────────────────────────────────
  return res.status(200).json({
    url: url,
    gtmId: gtmId,
    noGtm: !gtmId,
    brand: brand,
    signals: aggregated,
    container_evidence: containerEvidence,
    parsed: parsedContainer,
    pages_audited: pagesAudited,
    audit: audit
  });
};
