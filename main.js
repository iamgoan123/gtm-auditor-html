/* GTM Auditor — frontend behavior
 * All 17 features from the brief + audit fetch/render.
 */

const isMobile = window.innerWidth < 769;
gsap.registerPlugin(ScrollTrigger);

/* ============================================================================
   1. PRELOADER
============================================================================ */
function initPreloader() {
  const preloader = document.getElementById('preloader');
  setTimeout(() => {
    gsap.to(preloader, {
      opacity: 0, duration: 0.7, ease: 'power2.inOut',
      onComplete: () => { preloader.style.display = 'none'; animateHeroEntrance(); }
    });
  }, 1400);
}

/* ============================================================================
   5. CHARACTER-BY-CHARACTER HERO TITLE REVEAL
============================================================================ */
function splitHeroTitle() {
  const title = document.querySelector('.hero-title');
  if (!title || title.dataset.split) return;
  title.dataset.split = 'true';
  function wrap(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const frag = document.createDocumentFragment();
      for (const ch of node.textContent) {
        if (ch === ' ' || ch === '\n') frag.appendChild(document.createTextNode(ch));
        else {
          const span = document.createElement('span');
          span.className = 'char';
          span.textContent = ch;
          frag.appendChild(span);
        }
      }
      node.parentNode.replaceChild(frag, node);
    } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'BR') {
      Array.from(node.childNodes).forEach(wrap);
    }
  }
  Array.from(title.childNodes).forEach(wrap);
}

function animateHeroEntrance() {
  splitHeroTitle();
  const tl = gsap.timeline();
  tl.from('.hero-label', { opacity: 0, y: 15, duration: 0.7, ease: 'power2.out' }, 0)
    .to('.hero-title .char', {
      opacity: 1, y: 0, rotateX: 0,
      duration: 0.8, ease: 'power3.out', stagger: 0.025
    }, 0.15)
    .from('.hero-sub', { opacity: 0, y: 20, duration: 0.8, ease: 'power2.out' }, 0.7)
    .from('.hero-input', { opacity: 0, y: 20, duration: 0.8, ease: 'power2.out' }, 0.85)
    .from('.hero-meta', { opacity: 0, y: 15, duration: 0.7, ease: 'power2.out' }, 1.0)
    .from('.hero-corner', { opacity: 0, duration: 0.8, stagger: 0.1 }, 1.1);
}

/* ============================================================================
   2. CUSTOM CURSOR (desktop only)
============================================================================ */
function initCursor() {
  if (isMobile) {
    document.querySelector('.cursor').style.display = 'none';
    document.querySelector('.cursor-dot').style.display = 'none';
    return;
  }
  const cursor = document.querySelector('.cursor');
  const dot = document.querySelector('.cursor-dot');
  let mx = window.innerWidth / 2, my = window.innerHeight / 2;
  let cx = mx, cy = my;

  document.addEventListener('mousemove', (e) => {
    mx = e.clientX; my = e.clientY;
    dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%)`;
  }, { passive: true });

  function loop() {
    cx += (mx - cx) * 0.12;
    cy += (my - cy) * 0.12;
    cursor.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
    requestAnimationFrame(loop);
  }
  loop();

  const hoverEls = 'a, button, [data-magnetic], input, summary, .detected-pill, .h-card, .finding, .tag-card';
  document.addEventListener('mouseover', (e) => { if (e.target.closest(hoverEls)) cursor.classList.add('hover'); });
  document.addEventListener('mouseout',  (e) => { if (e.target.closest(hoverEls)) cursor.classList.remove('hover'); });
  document.addEventListener('mousedown', () => cursor.classList.add('click'));
  document.addEventListener('mouseup',   () => cursor.classList.remove('click'));
}

/* ============================================================================
   3. THREE.JS PARTICLE HERO
============================================================================ */
function initThreeHero() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas || !window.THREE) return;
  const hero = document.querySelector('.hero');
  const W = () => hero.offsetWidth;
  const H = () => hero.offsetHeight;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, W() / H(), 0.1, 1000);
  camera.position.z = 9;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(W(), H());
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const count = isMobile ? 120 : 300;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const palette = [[0.23, 0.51, 0.96], [0.96, 0.62, 0.04], [0.96, 0.95, 0.94]];
  for (let i = 0; i < count; i++) {
    positions[i * 3]     = (Math.random() - 0.5) * 36;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 18;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 22;
    const c = palette[Math.floor(Math.random() * palette.length)];
    colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.08, vertexColors: true, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, sizeAttenuation: true
  });
  const points = new THREE.Points(geom, mat);
  scene.add(points);

  const shapes = [];
  const data = [
    { geo: new THREE.IcosahedronGeometry(1.8, 0), color: 0x3b82f6, x: -8, y: 1.5 },
    { geo: new THREE.OctahedronGeometry(1.5, 0),  color: 0xf59e0b, x:  8, y: -1.2 },
    { geo: new THREE.TetrahedronGeometry(1.6, 0), color: 0xf5f3ef, x:  0, y:  2.5 }
  ];
  data.forEach((s) => {
    const m = new THREE.MeshBasicMaterial({ color: s.color, wireframe: true, transparent: true, opacity: 0.32 });
    const mesh = new THREE.Mesh(s.geo, m);
    mesh.position.set(s.x, s.y, -3);
    shapes.push(mesh);
    scene.add(mesh);
  });

  let mx = 0, my = 0, tx = 0, ty = 0;
  if (!isMobile) {
    document.addEventListener('mousemove', (e) => {
      tx = (e.clientX / W() - 0.5) * 0.6;
      ty = (e.clientY / H() - 0.5) * 0.6;
    }, { passive: true });
  }

  function loop() {
    requestAnimationFrame(loop);
    mx += (tx - mx) * 0.05;
    my += (ty - my) * 0.05;
    points.rotation.y += 0.0008;
    points.rotation.x = my * 0.25;
    points.position.x = mx * 0.5;
    shapes.forEach((s, i) => {
      s.rotation.x += 0.0022 + i * 0.0008;
      s.rotation.y += 0.0017 + i * 0.0005;
    });
    renderer.render(scene, camera);
  }
  loop();

  window.addEventListener('resize', () => {
    camera.aspect = W() / H();
    camera.updateProjectionMatrix();
    renderer.setSize(W(), H());
  }, { passive: true });
}

/* ============================================================================
   4. MAGNETIC BUTTONS
============================================================================ */
function initMagnetic() {
  if (isMobile) return;
  document.querySelectorAll('[data-magnetic]').forEach(btn => {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      gsap.to(btn, { x: x * 0.3, y: y * 0.3, duration: 0.35, ease: 'power2.out' });
    });
    btn.addEventListener('mouseleave', () => {
      gsap.to(btn, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, 0.4)' });
    });
  });
}

/* ============================================================================
   6. PINNED SCROLL STORYTELLING
============================================================================ */
function initPinnedStory() {
  if (isMobile) return;
  const section = document.querySelector('.storytelling');
  const panels = document.querySelectorAll('.story-panel');
  const dots = document.querySelectorAll('.story-dots .dot');
  if (!section || !panels.length) return;

  ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: () => `+=${panels.length * window.innerHeight * 0.9}`,
    pin: '.story-pin',
    onUpdate: (self) => {
      const idx = Math.min(Math.floor(self.progress * panels.length * 0.999), panels.length - 1);
      panels.forEach((p, i) => p.classList.toggle('active', i === idx));
      dots.forEach((d, i) => d.classList.toggle('active', i === idx));
    }
  });
}

/* ============================================================================
   7. HORIZONTAL SCROLL
============================================================================ */
function initHorizontalScroll() {
  if (isMobile) return;
  const section = document.querySelector('.h-scroll-section');
  const track = document.querySelector('.h-scroll-track');
  if (!section || !track) return;

  gsap.to(track, {
    x: () => -(track.scrollWidth - window.innerWidth + 40),
    ease: 'none',
    scrollTrigger: {
      trigger: section,
      start: 'top top',
      end: () => `+=${track.scrollWidth - window.innerWidth + 40}`,
      pin: true,
      scrub: 1,
      invalidateOnRefresh: true
    }
  });
}

/* ============================================================================
   8. SCROLL VELOCITY SKEW
============================================================================ */
function initVelocitySkew() {
  if (isMobile) return;
  const skewEls = document.querySelectorAll('.skew-el');
  if (!skewEls.length) return;
  const setSkew = gsap.quickSetter(skewEls, 'skewY', 'deg');
  let current = 0;
  let timeoutId;

  ScrollTrigger.create({
    onUpdate: (self) => {
      const v = self.getVelocity() * 0.0035;
      const clamped = Math.max(-3, Math.min(3, v));
      if (Math.abs(clamped - current) > 0.05) { current = clamped; setSkew(clamped); }
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        gsap.to(skewEls, { skewY: 0, duration: 0.8, ease: 'power3.out' });
        current = 0;
      }, 100);
    }
  });
}

/* ============================================================================
   9. COUNTER ANIMATIONS
============================================================================ */
function initCounters() {
  document.querySelectorAll('[data-target]').forEach(setupCounter);
}

function setupCounter(el) {
  if (el.dataset.bound) return;
  el.dataset.bound = 'true';
  ScrollTrigger.create({
    trigger: el,
    start: 'top 88%',
    once: true,
    onEnter: () => animateCounter(el)
  });
}

function animateCounter(el) {
  const target = parseInt(el.dataset.target, 10);
  if (isNaN(target)) return;
  const obj = { val: 0 };
  gsap.to(obj, {
    val: target,
    duration: 2.2,
    ease: 'power2.out',
    onUpdate: () => { el.textContent = Math.round(obj.val); }
  });
}

/* ============================================================================
   10. SCROLL PROGRESS BAR
============================================================================ */
function initScrollProgress() {
  gsap.to('.scroll-progress', {
    scaleX: 1, ease: 'none',
    scrollTrigger: {
      trigger: document.body,
      start: 'top top', end: 'bottom bottom',
      scrub: 0.2
    }
  });
}

/* ============================================================================
   11. SECTION REVEAL ANIMATIONS
============================================================================ */
function initReveals() {
  gsap.utils.toArray('.reveal-label').forEach(el => {
    gsap.to(el, { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
  });
  gsap.utils.toArray('.reveal-title').forEach(el => {
    gsap.to(el, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.1, ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 85%', once: true } });
  });
  gsap.utils.toArray('.reveal-sub').forEach(el => {
    gsap.to(el, { opacity: 1, y: 0, duration: 0.8, delay: 0.15, ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 85%', once: true } });
  });
  ScrollTrigger.batch('.reveal-card', {
    onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, stagger: 0.12, duration: 0.8, ease: 'back.out(1.3)' }),
    once: true, start: 'top 85%'
  });
  ScrollTrigger.batch('.faq-item', {
    onEnter: (els) => gsap.from(els, { opacity: 0, x: -25, stagger: 0.1, duration: 0.6, ease: 'power2.out' }),
    once: true, start: 'top 90%'
  });
}

/* ============================================================================
   12. PARALLAX
============================================================================ */
function initParallax() {
  if (isMobile) return;
  gsap.to('.hero-grain', {
    yPercent: 35, ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 1.5 }
  });
}

/* ============================================================================
   14. MARQUEE TICKER
============================================================================ */
function initMarquee() {
  const items = [
    'GA4', 'Google Ads', 'Floodlight', 'Meta Pixel', 'TikTok Pixel',
    'LinkedIn Insight', 'Pinterest Tag', 'Consent Mode v2', 'Server-side GTM',
    'Conversion Linker', 'Enhanced Conversions', 'BigQuery', 'Hotjar', 'Clarity',
    'OneTrust', 'Cookiebot', 'Klaviyo', 'HubSpot', 'Snap Pixel', 'Bing UET'
  ];
  const track = document.getElementById('marquee-track');
  if (!track) return;
  let html = '';
  items.forEach(it => { html += `<span class="marquee-item">${it}</span><span class="marquee-item dot">◆</span>`; });
  track.innerHTML = html + html;
}

/* ============================================================================
   15. MICRO-INTERACTIONS
============================================================================ */
function initMicroInteractions() {
  const nav = document.getElementById('nav');
  let lastScrolled = false;
  window.addEventListener('scroll', () => {
    const scrolled = window.scrollY > 80;
    if (scrolled !== lastScrolled) {
      nav.classList.toggle('scrolled', scrolled);
      lastScrolled = scrolled;
    }
  }, { passive: true });
}

/* ============================================================================
   17. SMOOTH SCROLL
============================================================================ */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href');
      if (!href || href === '#') return;
      const target = document.querySelector(href);
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  });
}

/* ============================================================================
   AUDIT LOGIC
============================================================================ */
async function runAudit() {
  const input = document.getElementById('url-input');
  const btn = document.getElementById('audit-btn');
  const section = document.getElementById('results');
  let url = input.value.trim();
  if (!url) {
    input.focus();
    gsap.fromTo(input, { x: -8 }, { x: 0, duration: 0.4, ease: 'elastic.out(1, 0.3)' });
    return;
  }

  btn.disabled = true;
  const btnLabel = btn.querySelector('.btn-label');
  const originalLabel = btnLabel.textContent;
  btnLabel.textContent = 'Inspecting…';
  section.hidden = false;
  section.innerHTML = renderLoading();
  setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);

  const stages = [
      'Fetching homepage',
      'Discovering product, collection, and cart pages',
      'Auditing product page',
      'Auditing collection page',
      'Auditing cart',
      'Parsing GTM container',
      'Extracting measurement IDs and consent config',
      'Running AI audit'
    ];
    let stageIdx = 0;
    const rotateStage = setInterval(() => {
      if (stageIdx < stages.length - 1) stageIdx++;
      const stageEl = section.querySelector('.audit-loading-stages');
      if (stageEl) stageEl.textContent = stages[stageIdx];
    }, 3000);

  try {
    const resp = await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    clearInterval(rotateStage);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Audit failed');
    renderResults(data);
  } catch (err) {
    clearInterval(rotateStage);
    section.innerHTML = renderError(err.message);
  } finally {
    btn.disabled = false;
    btnLabel.textContent = originalLabel;
  }
}

function renderLoading() {
  return `
    <div class="section-wrap">
      <div class="audit-loading">
        <div class="audit-loading-ring"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="32" /></svg></div>
        <div class="audit-loading-text">Inspecting tracking machinery</div>
        <div class="audit-loading-stages">Fetching page source</div>
      </div>
    </div>
  `;
}

function renderError(msg) {
  return `
    <div class="section-wrap">
      <div class="audit-loading">
        <div style="font-family: var(--serif); font-size: 2rem; margin-bottom: 12px; color: var(--error);">Inspection failed.</div>
        <div style="font-family: var(--mono); font-size: 13px; color: var(--ink-2);">${escapeHtml(msg)}</div>
      </div>
    </div>
  `;
}

function renderResults(data) {
  const section = document.getElementById('results');
  const { url, gtmId, brand, signals, parsed, audit, noGtm } = data;
  const domain = new URL(url).hostname;

  if (noGtm) {
    section.innerHTML = `<div class="section-wrap">${renderBrandCard(brand, domain, null, null)}${renderNoGtm(signals)}</div>`;
  } else {
    section.innerHTML = `
      <div class="section-wrap">
        ${renderBrandCard(brand, domain, audit, gtmId)}
        ${parsed ? renderParsedStrip(parsed) : ''}
        ${renderMetrics(audit)}
        ${audit.ga4 ? renderGa4Banner(audit.ga4) : ''}
        ${renderDetectedTools(signals)}
        ${renderExplainer('Tags', `Snippets of code that fire when conditions are met — GA4 events, Meta Pixel hits, Google Ads conversions, custom HTML. This container has <strong>${parsed?.tag_count || audit.tags_found || 0}</strong>. Below: the ones the audit flagged as notable. Full container inventory at the bottom.`)}
        ${renderExplainer('Triggers', `Conditions that decide when tags fire. Page views, clicks, custom events, scroll depth, form submissions, timers. This container uses <strong>${parsed?.predicate_count || audit.triggers_found || 0}</strong> conditions across <strong>${parsed?.rule_count || '?'}</strong> rules.`)}
        ${renderTagsAndTriggers(audit)}
        ${parsed ? renderInventory(parsed) : ''}
        ${renderIssues(audit)}
        ${renderWorthVerifying(audit)}
        ${renderQuickWins(audit)}
      </div>
    `;
  }

  section.querySelectorAll('[data-target]').forEach(el => {
    el.dataset.bound = 'true';
    animateCounter(el);
  });

  gsap.from(section.querySelectorAll('.brand-card, .parsed-strip, .metrics-row, .ga4-banner, .detected-section, .explainer, .results-grid, .inventory, .top-issues, .quick-wins'), {
    opacity: 0, y: 20, stagger: 0.08, duration: 0.7, ease: 'power2.out'
  });

  ScrollTrigger.refresh();
}

function renderBrandCard(brand, domain, audit, gtmId) {
  const name = brand?.title || domain;
  const tagline = brand?.description || (audit?.site_summary || '');
  const image = brand?.image;
  const initials = (name.split(/\s+/).slice(0, 2).map(w => w[0]).join('') || domain.slice(0, 2)).toUpperCase();
  return `
    <div class="brand-card">
      ${image
        ? `<img src="${escapeAttr(image)}" alt="${escapeAttr(name)}" class="brand-image" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'brand-image-placeholder',textContent:'${initials}'}));">`
        : `<div class="brand-image-placeholder">${initials}</div>`}
      <div class="brand-info">
        <div class="brand-name">${escapeHtml(name)}</div>
        ${tagline ? `<div class="brand-tagline">${escapeHtml(tagline)}</div>` : ''}
        <div class="brand-meta">
          <span class="brand-meta-item">◆ ${escapeHtml(domain)}</span>
          ${gtmId ? `<span class="brand-meta-item">Container: <span class="gtm-id">${escapeHtml(gtmId)}</span></span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderParsedStrip(parsed) {
  return `
    <div class="parsed-strip">
      <span>✓ Container parsed</span>
      <span>${parsed.tag_count} tags</span>
      <span>${parsed.variable_count} variables</span>
      <span>${parsed.predicate_count} conditions</span>
      <span>${parsed.rule_count} rules</span>
      <span>v${parsed.version}</span>
    </div>
  `;
}

function renderMetrics(audit) {
  const score = audit.health_score || 0;
  const scoreClass = score >= 70 ? 'success' : score >= 50 ? 'amber' : 'error';
  return `
    <div class="metrics-row">
      <div class="metric-card ${scoreClass}"><div class="metric-num"><span data-target="${score}">0</span></div><div class="metric-lbl">Health score</div></div>
      <div class="metric-card"><div class="metric-num"><span data-target="${audit.tags_found || 0}">0</span></div><div class="metric-lbl">Tags found</div></div>
      <div class="metric-card"><div class="metric-num"><span data-target="${audit.triggers_found || 0}">0</span></div><div class="metric-lbl">Triggers</div></div>
      <div class="metric-card"><div class="metric-num"><span data-target="${audit.variables_found || 0}">0</span></div><div class="metric-lbl">Variables</div></div>
      <div class="metric-card error"><div class="metric-num"><span data-target="${audit.issues_count || 0}">0</span></div><div class="metric-lbl">Issues</div></div>
    </div>
  `;
}

function renderGa4Banner(ga4) {
  const cm = ga4.consent_mode_v2 ? 'v2' : (ga4.consent_mode ? 'v1' : 'Off');
  return `
    <div class="ga4-banner">
      <div class="ga4-banner-icon">G4</div>
      <div class="ga4-info">
        <div class="ga4-title">Google Analytics 4</div>
        <div class="ga4-note">${escapeHtml(ga4.note || '')}</div>
      </div>
      <div class="ga4-stats">
        <div><div class="ga4-stat-lbl">ID</div><div class="ga4-stat-val">${escapeHtml(ga4.measurement_id || 'None')}</div></div>
        <div><div class="ga4-stat-lbl">Via</div><div class="ga4-stat-val">${escapeHtml(ga4.via || 'Unknown')}</div></div>
        <div><div class="ga4-stat-lbl">Ecommerce</div><div class="ga4-stat-val">${ga4.ecommerce ? 'Active' : 'None'}</div></div>
        <div><div class="ga4-stat-lbl">Consent</div><div class="ga4-stat-val">${cm}</div></div>
      </div>
    </div>
  `;
}

function renderDetectedTools(signals) {
  if (!signals?.detected_tools?.length && !signals?.ga_universal_ids?.length) return '';
  const tools = signals.detected_tools || [];
  let html = tools.map(t => `<span class="detected-pill">${escapeHtml(t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}</span>`).join('');
  if (signals.ga_universal_ids?.length) html += `<span class="detected-pill error">UA (deprecated): ${escapeHtml(signals.ga_universal_ids.join(', '))}</span>`;
  if (signals.google_ads_ids?.length) html += `<span class="detected-pill">Google Ads: ${escapeHtml(signals.google_ads_ids.join(', '))}</span>`;
  if (signals.server_side_gtm) html += `<span class="detected-pill">Server-side GTM</span>`;
  return `
    <div class="detected-section">
      <div class="detected-lbl">Also detected on the page</div>
      <div>${html}</div>
    </div>
  `;
}

function renderExplainer(label, html) {
  return `
    <div class="explainer">
      <div class="explainer-lbl">What are ${label.toLowerCase()}?</div>
      <p>${html}</p>
    </div>
  `;
}

function renderTagsAndTriggers(audit) {
  const tags = audit.tags || [];
  const triggers = audit.triggers || [];
  return `
    <div class="results-grid">
      <div class="results-col">
        <h3>Tags <span class="count">/ ${tags.length} highlighted</span></h3>
        ${tags.map(renderTagCard).join('')}
      </div>
      <div class="results-col">
        <h3>Triggers <span class="count">/ ${triggers.length} highlighted</span></h3>
        ${triggers.map(renderTagCard).join('')}
      </div>
    </div>
  `;
}

function renderTagCard(t) {
  const status = t.status || 'info';
  const rec = t.recommendation ? `<div class="tag-rec">→ ${escapeHtml(t.recommendation)}</div>` : '';
  return `
    <div class="tag-card ${status}">
      <div style="display:flex;align-items:center;flex-wrap:wrap">
        <span class="tag-name">${escapeHtml(t.name)}</span>
        ${renderBadge(status)}
      </div>
      <div class="tag-detail">${escapeHtml(t.detail || '')}</div>
      ${rec}
    </div>
  `;
}

function renderBadge(status) {
  const labels = { pass: 'Pass', warn: 'Warning', fail: 'Issue', info: 'Info' };
  return `<span class="badge badge-${status}">${labels[status] || status}</span>`;
}

function renderInventory(parsed) {
  const tags = parsed.tags || [];
  const vars = parsed.variables || [];
  return `
    <details class="inventory">
      <summary>View all ${tags.length} tags in container</summary>
      <div class="inventory-content">
        ${tags.map(t => `
          <div class="inventory-row">
            <span class="inv-name">${escapeHtml(t.name)}</span>
            <span class="inv-type">${escapeHtml(t.type)}</span>
            ${t.paused ? '<span class="inv-badge">paused</span>' : '<span></span>'}
          </div>
        `).join('')}
      </div>
    </details>
    <details class="inventory">
      <summary>View all ${vars.length} variables in container</summary>
      <div class="inventory-content">
        ${vars.map(v => `
          <div class="inventory-row">
            <span class="inv-name">${escapeHtml(v.name)}</span>
            <span class="inv-type">${escapeHtml(v.type)}</span>
            <span></span>
          </div>
        `).join('')}
      </div>
    </details>
  `;
}

function renderIssues(audit) {
  const issues = audit.top_issues || [];
  if (!issues.length) return '';
  return `
    <div style="margin-top:32px" class="top-issues-wrap">
      <h3 style="font-family:var(--serif);font-size:22px;font-weight:450;letter-spacing:-0.015em;margin-bottom:16px;">Top issues to fix</h3>
      <div class="top-issues">
        ${issues.map(i => {
          const cls = i.priority === 'high' ? 'fail' : i.priority === 'medium' ? 'warn' : 'info';
          const badge = `<span class="badge badge-${cls}">${i.priority || 'medium'}</span>`;
          return `
            <div class="tag-card ${cls}">
              <div style="display:flex;align-items:center;flex-wrap:wrap">
                <span class="tag-name">${escapeHtml(i.title)}</span>${badge}
              </div>
              <div class="tag-detail">${escapeHtml(i.detail || '')}</div>
              <div class="tag-rec">→ ${escapeHtml(i.fix || '')}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderQuickWins(audit) {
  const wins = audit.quick_wins || [];
  if (!wins.length) return '';
  return `
    <div class="quick-wins" style="margin-top:24px">
      <h3>Quick wins</h3>
      ${wins.map(w => `<div class="win-item"><span class="win-check">✓</span> <span>${escapeHtml(w)}</span></div>`).join('')}
    </div>
  `;
}

function renderNoGtm(signals) {
  const tools = signals?.detected_tools || [];
  const pills = tools.map(t => `<span class="detected-pill">${escapeHtml(t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}</span>`).join('');
  return `
    <div class="brand-card" style="display:block;text-align:center;padding:48px 32px">
      <div style="font-size:42px;margin-bottom:14px">🔎</div>
      <div style="font-family:var(--serif);font-size:28px;font-weight:450;letter-spacing:-0.02em;margin-bottom:10px;">No GTM container found.</div>
      <div style="font-size:14px;color:var(--ink-2);max-width:560px;margin:0 auto 22px;line-height:1.65">This website doesn't appear to be using Google Tag Manager. Many sites manage tracking differently — Shopify native pixels, direct gtag.js, server-side, or platform-built integrations.</div>
      <div>${pills}</div>
    </div>
  `;
}

/* ============================================================================
   Utility
============================================================================ */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

/* ============================================================================
   Boot
============================================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initMarquee();
  initPreloader();
  initCursor();
  initThreeHero();
  initMagnetic();
  initScrollProgress();
  initReveals();
  initParallax();
  initPinnedStory();
  initHorizontalScroll();
  initVelocitySkew();
  initCounters();
  initMicroInteractions();
  initSmoothScroll();

  document.getElementById('audit-btn').addEventListener('click', runAudit);
  document.getElementById('url-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runAudit(); }
  });
});

if ('fonts' in document) {
  document.fonts.ready.then(() => ScrollTrigger.refresh());
}
