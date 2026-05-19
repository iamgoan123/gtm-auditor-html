# GTM Auditor

A diagnostic instrument for Google Tag Manager. Paste any website URL and get a full GTM audit in seconds — without needing access to the GTM container.

**Live:** `<your-vercel-url-here>`

---

## How it works

Every website that uses GTM loads a public `gtm.js` file from `googletagmanager.com`. That file contains the entire container configuration — tags, variables, trigger conditions, rules. The auditor:

1. Fetches the website's HTML
2. Extracts the GTM container ID (regex match for `GTM-XXXXXX`)
3. Fetches the public `gtm.js` for that container
4. Parses the embedded JSON (`var data = {...}`) using a brace-balancer to extract real tag types, variable types, and trigger conditions
5. Extracts Open Graph metadata (brand name, image, description) and page-level signals (GA4 IDs, UA, Google Ads, Floodlight, Meta Pixel, TikTok, LinkedIn Insight, consent mode v2, server-side GTM signatures, and more)
6. Passes everything to Llama 3.3 70B via Groq with a strict audit checklist (UA deprecation, Consent Mode v2, snake_case event names, Conversion Linker, server-side maturity, duplicate firing)
7. Returns a structured JSON audit and renders it

No GTM authentication required. Everything analysed is already public.

---

## Project structure

```
gtm-auditor/
├── index.html        Frontend HTML structure
├── styles.css        All styles (editorial diagnostic instrument aesthetic)
├── main.js           All frontend behavior + 17 animation features
├── api/
│   └── audit.js      Vercel Edge function — fetches URL, parses GTM, calls Groq
├── package.json
├── vercel.json
├── .gitignore
└── README.md
```

---

## Deploy to Vercel

### One-time setup

1. Create a new GitHub repo (e.g. `gtm-auditor-html`)
2. Push these files to it:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/your-username/gtm-auditor-html.git
   git push -u origin main
   ```
3. Go to [vercel.com/new](https://vercel.com/new) and sign in with GitHub
4. Click **Add New… → Project**, select the repo, click **Import**
5. Before deploying, expand **Environment Variables** and add:
   - **Name:** `GROQ_API_KEY`
   - **Value:** your Groq API key (starts with `gsk_...`)
6. Click **Deploy**

Live in about 30 seconds. Any subsequent `git push` redeploys automatically.

### Get a Groq API key

1. Go to [console.groq.com](https://console.groq.com) and sign up (free)
2. **API Keys → Create API Key**
3. Copy the key — it starts with `gsk_...`
4. Paste it into Vercel's environment variables (above)

### Local dev (optional)

```bash
npm i -g vercel
vercel dev
```

Vercel will prompt you to link the project and pull the environment variables.

---

## Features (frontend)

All 17 features from the original brief are implemented:

1. **Three.js particle hero** — 300 desktop / 120 mobile particles, three wireframe shapes (icosahedron, octahedron, tetrahedron), mouse-reactive
2. **Custom cursor** — circle + dot, lerp 0.12, expands on hover, shrinks on click, mix-blend-mode difference
3. **Magnetic buttons** — `data-magnetic` attribute, 30% offset, elastic snap back
4. **Preloader** — double counter-rotating rings, fade out after fonts load
5. **Character-by-character hero title reveal** — GSAP timeline, 0.025s stagger, rotateX 3D effect
6. **Pinned scroll storytelling** — 4 panels explaining the auditor's logic
7. **Horizontal scroll section** — "What we check" cards
8. **Scroll velocity skew** — ±3deg clamped, applied to `.skew-el` elements
9. **Counter animations** — `data-target` attribute, 2.2s power2.out
10. **Scroll progress bar** — 3px gradient (blue → amber), scrub 0.2
11. **Section reveal animations** — labels translate, titles blur + translate, cards back.out, FAQ slide-x
12. **Parallax layers** — hero grain overlay yPercent 35
13. *(N/A — no WhatsApp button in this context)*
14. **Marquee ticker** — 20 analytics terms, 50s loop, seamless duplicated content
15. **Micro-interactions** — nav backdrop blur on scroll, link underlines, card lifts, button shimmer pseudo-element
16. **Mobile rules** — heavy features disabled below 769px (cursor, magnetic, pinned, horizontal, velocity skew)
17. **Smooth scroll nav** — `scrollIntoView({ behavior: 'smooth' })`

---

## Aesthetic

Editorial diagnostic instrument. Warm dark base (`#0c0a08`), serif display (Fraunces with italics for emphasis), Geist sans for body, Geist Mono for data. Electric blue + amber as dual accents — no purple gradients. Section numbering (`01 — How it works`), `[ 01 ] Diagnostic Instrument` corner labels in monospace, generous whitespace, intentional asymmetry.

---

## Tech stack

- **Frontend:** Plain HTML/CSS/JS (no build step). Three.js + GSAP via CDN.
- **API:** Vercel Edge Function (V8 runtime, no Node.js dependencies).
- **AI:** Groq + Llama 3.3 70B Versatile (free tier, ~3–5s audits).
- **Hosting:** Vercel.

---

## What's audited

- Container size: tags, variables, trigger conditions, rules
- GA4: measurement IDs, configuration tags, ecommerce events, debug mode, event naming
- Google Ads: conversion tags, remarketing, Conversion Linker, enhanced conversions
- Floodlight (DC- IDs)
- Consent Mode v1 vs v2 (ad_user_data, ad_personalization)
- Server-side GTM signatures
- 22 third-party tools: Meta Pixel, TikTok, Pinterest, LinkedIn Insight, X, Snap, Bing UET, Reddit, Klaviyo, HubSpot, Hotjar, Clarity, FullStory, Segment, Amplitude, Mixpanel, OneTrust, Cookiebot, Usercentrics, Shopify, WooCommerce, Magento
- UA (Universal Analytics) — flagged as deprecated since July 2023
- Duplicate firing (e.g. Shopify native + GTM GA4)
- Brand context (Open Graph title, description, image, favicon)

---

## Roadmap

- PDF / CSV export of full audit
- Audit history (saved audits per user)
- Comparison mode (audit two competitors side by side)
- Slack / email notifications for scheduled audits
- Diff mode (track changes to a competitor's container over time)

---

## License

Personal project. Use freely, attribute if you fork.
