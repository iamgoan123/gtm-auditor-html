// ─────────────────────────────────────────────────────────────
// Third-party tool detection — runtime signatures only.
// Each regex matches something that genuinely only appears on a
// live install (JS namespace, CDN host, init call). No loose
// substring matches against brand names.
// ─────────────────────────────────────────────────────────────
const TOOL_SIGNATURES = {
  // ── Analytics platforms ─────────────────────────────────
  adobe_analytics:  /AppMeasurement|s_code\.js|s\.t\(\)|s\.tl\(|adobedtm\.com|\.sc\.omtrdc\.net|s_account|assets\.adobedtm\.com/i,
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

  // ── Ad pixels ───────────────────────────────────────────
  meta_pixel:       /connect\.facebook\.net\/[^"']+\/fbevents\.js|fbq\(\s*['"]init['"]|_fbq\s*=/i,
  tiktok:           /analytics\.tiktok\.com|ttq\.load\(|ttq\.track\(/i,
  pinterest:        /s\.pinimg\.com\/ct\/|pintrk\(/i,
  linkedin_insight: /snap\.licdn\.com\/li\.lms-analytics|_linkedin_partner_id|_linkedin_data_partner_ids/i,
  x_twitter:        /static\.ads-twitter\.com\/uwt\.js|twq\(\s*['"](?:init|track|config)/i,
  snap_pixel:       /sc-static\.net\/scevent|snaptr\(\s*['"](?:init|track)/i,
  bing_uet:         /bat\.bing\.com\/bat\.js|window\.uetq\s*=|uetq\.push/i,
  reddit_pixel:     /redditstatic\.com\/ads\/pixel|rdt\(\s*['"](?:init|track)/i,

  // ── Email / Marketing automation ────────────────────────
  klaviyo:          /static\.klaviyo\.com|_learnq\.push|klaviyo\.com\/onsite|klaviyo_subscriber/i,
  hubspot:          /js\.hs-scripts\.com|js\.hs-analytics\.net|_hsq\.push/i,

  // ── Consent management ──────────────────────────────────
  onetrust:         /cdn\.cookielaw\.org|OneTrust\.|window\.Optanon|otSDKStub\.js/i,
  cookiebot:        /consent\.cookiebot\.com|Cookiebot\.consent|cookiebot\.com\/uc\.js/i,
  usercentrics:     /app\.usercentrics\.eu|usercentrics\.com\/browser-ui|window\.UC_UI/i,

  // ── Ecommerce platforms ─────────────────────────────────
  shopify:          /cdn\.shopify\.com|Shopify\.shop|shopify-checkout-api-token|\/cdn\/shop\//i,
  woocommerce:      /woocommerce-no-js|wc-ajax|wc_add_to_cart_params|\/wp-content\/plugins\/woocommerce\//i,
  magento:          /Mage\.Cookies|Magento_[A-Z][a-zA-Z]+|\/skin\/frontend\/|\/pub\/static\/version\d+|var\s+BASE_URL\s*=.*\/index\.php/i,
};

// Pretty labels for the UI pills
const TOOL_LABELS = {
  adobe_analytics: "Adobe Analytics",
  matomo: "Matomo",
  heap: "Heap",
  snowplow: "Snowplow",
  tealium: "Tealium",
  amplitude: "Amplitude",
  mixpanel: "Mixpanel",
  segment: "Segment",
  fullstory: "FullStory",
  hotjar: "Hotjar",
  clarity: "Microsoft Clarity",
  meta_pixel: "Meta Pixel",
  tiktok: "TikTok Pixel",
  pinterest: "Pinterest Tag",
  linkedin_insight: "LinkedIn Insight",
  x_twitter: "X (Twitter) Pixel",
  snap_pixel: "Snap Pixel",
  bing_uet: "Bing UET",
  reddit_pixel: "Reddit Pixel",
  klaviyo: "Klaviyo",
  hubspot: "HubSpot",
  onetrust: "OneTrust",
  cookiebot: "Cookiebot",
  usercentrics: "Usercentrics",
  shopify: "Shopify",
  woocommerce: "WooCommerce",
  magento: "Magento",
};

// Replace your existing detection loop with this
function detectTools(html, gtmScript = "") {
  const haystack = `${html}\n${gtmScript}`;
  const detected = [];
  for (const [key, rx] of Object.entries(TOOL_SIGNATURES)) {
    if (rx.test(haystack)) detected.push({ key, label: TOOL_LABELS[key] });
  }
  return detected;
}
