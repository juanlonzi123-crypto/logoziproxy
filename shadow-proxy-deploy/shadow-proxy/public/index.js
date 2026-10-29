'use strict';

/* ───────────── Configuración y utilidades de URL ───────────── */

const CFG = self.__uv$config;
const encodeProxy = (url) => CFG.prefix + CFG.encodeUrl(url);
const decodeProxy = (path) => CFG.decodeUrl(path.slice(CFG.prefix.length));
const SKIP = /^(data:|blob:|about:|mailto:|tel:|javascript:|#)/i;
const $ = (sel) => document.querySelector(sel);

/** URL real absoluta (http/https) o null. Entiende URLs ya prefijadas por el proxy. */
function absolutize(raw, base) {
  const v = (raw || '').trim();
  if (!v || SKIP.test(v)) return null;
  if (v.startsWith(CFG.prefix)) return decodeProxy(v);
  try {
    const u = new URL(v, base);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch { return null; }
}

/** Convierte una URL cualquiera en una URL del proxy (idempotente). */
function proxify(raw, base) {
  const v = (raw || '').trim();
  if (!v || SKIP.test(v) || v.startsWith(CFG.prefix)) return raw;
  const abs = absolutize(v, base);
  return abs ? encodeProxy(abs) : raw;
}

function proxifySrcset(value, base) {
  return value.split(',').map((part) => {
    const [u, ...desc] = part.trim().split(/\s+/);
    return [proxify(u, base), ...desc].join(' ');
  }).join(', ');
}

function normalizeInput(input) {
  const v = input.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (!/\s/.test(v) && /^[^\s/]+\.[^\s/]{2,}(\/.*)?$/.test(v)) return 'https://' + v;
  return 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(v);
}

/* ───────────── Reescritura de CSS ───────────── */

const urlsOnly = (css, base) => css
  .replace(/url\(\s*(['"]?)([^'")]+?)\1\s*\)/gi, (_m, q, u) => `url(${q}${proxify(u.trim(), base)}${q})`)
  .replace(/@import\s+(['"])([^'"]+)\1/gi, (_m, q, u) => `@import ${q}${proxify(u, base)}${q}`);

const SELECTOR_MAP = /(^|[\s,{}>+~(])(html|body|:root)(?![\w-])/gi;
const mapSelector = (_m, pre, sel) => pre + (sel.toLowerCase() === 'body' ? '.px-body' : '.px-html');

const BASE_CSS = `
:host { all: initial; display: block; position: absolute; inset: 0; overflow: auto;
        background: #fff; color: #000; font: 16px/1.2 system-ui, sans-serif; }
.px-html { display: block; min-height: 100%; }
.px-body { display: block; margin: 8px; }
a[data-px-href] { cursor: pointer; }
`;

const FORCE_CSS = `
.px-html { overflow: visible !important; height: auto !important; min-height: 100%; }
.px-body { overflow: visible !important; height: auto !important; min-height: 100%; }
.px-banner { position: sticky; top: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center;
  gap: 12px; padding: 8px 12px; background: var(--toolbar-bg, #222); color: var(--text, #fff);
  border-bottom: 1px solid var(--border, #444); font: 13px/1.3 system-ui, sans-serif; }
.px-banner-btn { border: 0; border-radius: 14px; padding: 5px 12px; background: var(--accent, #fa1e4e); color: #fff;
  font: inherit; font-weight: 600; cursor: pointer; }
.px-banner-x { border: 0; background: transparent; color: inherit; font-size: 18px; line-height: 1; cursor: pointer; opacity: .7; }
`;

// Sitios que dependen totalmente de JavaScript: se abren en modo completo (pestaña real del navegador)
const FULL_HOSTS = /(^|\.)(youtube\.com|youtu\.be|google\.[a-z.]+|gmail\.com|xbox\.com|microsoft\.com|live\.com|office\.com|bing\.com|twitch\.tv|netflix\.com|spotify\.com|discord\.com|instagram\.com|facebook\.com|x\.com|twitter\.com|tiktok\.com)$/i;

const DROP = 'script,noscript,iframe,frame,frameset,object,embed,base,meta,link[rel~="preload"],' +
  'link[rel~="modulepreload"],link[rel~="prefetch"],link[rel~="icon"],link[rel~="manifest"]';

/* ───────────── Almacenamiento, marcadores y helpers de UI ───────────── */

const Store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento */ }
  },
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const hue = (str) => { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u); } };

const DEFAULT_SITES = [
  { name: 'DuckDuckGo', url: 'https://html.duckduckgo.com/html/' },
  { name: 'Wikipedia', url: 'https://es.wikipedia.org/' },
  { name: 'Hacker News', url: 'https://news.ycombinator.com/' },
  { name: 'Old Reddit', url: 'https://old.reddit.com/' },
  { name: 'GitHub', url: 'https://github.com/' },
  { name: 'NPR Text', url: 'https://text.npr.org/' },
];

const Bookmarks = {
  list: Store.get('sp.bookmarks', []),
  has(url) { return this.list.some((b) => b.url === url); },
  toggle(url, title) {
    if (this.has(url)) this.list = this.list.filter((b) => b.url !== url);
    else this.list.push({ url, title: title || hostOf(url) });
    Store.set('sp.bookmarks', this.list);
  },
  remove(url) {
    this.list = this.list.filter((b) => b.url !== url);
    Store.set('sp.bookmarks', this.list);
  },
};

const SEARCH_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>';

const HOME_CSS = `
:host { background: var(--home-bg, #0b0b0f); color: var(--text, #eee); }
.home { position: relative; min-height: 100%; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 28px; padding: 40px 20px 80px; overflow: hidden;
  background:
    radial-gradient(900px 500px at 15% -10%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 60%),
    radial-gradient(800px 500px at 90% 110%, color-mix(in srgb, var(--accent-2) 20%, transparent), transparent 60%); }
.home::before { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .35;
  background-image: linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px);
  background-size: 48px 48px;
  -webkit-mask-image: radial-gradient(circle at 50% 40%, #000, transparent 70%);
  mask-image: radial-gradient(circle at 50% 40%, #000, transparent 70%); }
.home > * { position: relative; }
.logo { display: flex; align-items: baseline; gap: 10px; font-size: 54px; font-weight: 800; letter-spacing: -1px; }
.logo-mark { color: var(--accent); text-shadow: var(--glow); font-size: 44px; }
.logo-gx { background: linear-gradient(90deg, var(--accent), var(--accent-2)); -webkit-background-clip: text;
  background-clip: text; color: transparent; }
.search { width: min(640px, 92vw); display: flex; align-items: center; gap: 12px; height: 54px; padding: 0 22px;
  border-radius: 27px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); transition: .18s; }
.search:focus-within { border-color: var(--accent);
  box-shadow: var(--glow), 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent); }
.search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; font-size: 16px; }
.grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px; max-width: 760px; }
.tile { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 112px; padding: 16px 8px;
  border-radius: 16px; background: var(--surface); border: 1px solid var(--border); color: var(--text);
  text-decoration: none; transition: .18s; }
.tile:hover { transform: translateY(-3px); border-color: var(--accent); box-shadow: var(--glow); }
.tile-ico { width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; color: #fff;
  font-size: 22px; font-weight: 700; }
.tile-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.hint { margin: 0; color: var(--muted); font-size: 12px; text-align: center; }
`;

/* ───────────── Pestaña ───────────── */

class Tab {
  static #seq = 0;

  constructor(manager) {
    this.manager = manager;
    this.id = ++Tab.#seq;
    this.title = 'Nueva pestaña';
    this.url = '';
    this.entries = [];
    this.index = -1;
    this.loadId = 0;
    this.fontFaces = [];

    // Contenedor <div> + Shadow DOM (sin iframes)
    this.host = document.createElement('div');
    this.host.className = 'tab-view';
    this.shadow = this.host.attachShadow({ mode: 'open' });

    // @font-face no funciona dentro de un shadow root: se declara en el documento
    this.fontStyle = document.createElement('style');
    document.head.append(this.fontStyle);

    this.#buildButton();
    this.#bindShadowEvents();
    this.loading = false;
    this.isHome = true;
    this.#renderHome();
  }

  get canBack() { return this.index > 0; }
  get canForward() { return this.index < this.entries.length - 1; }

  #buildButton() {
    this.button = document.createElement('div');
    this.button.className = 'tab';
    this.favEl = document.createElement('span');
    this.favEl.className = 'fav home';
    this.titleEl = document.createElement('span');
    this.titleEl.className = 'title';
    this.titleEl.textContent = this.title;
    const close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.textContent = '×';
    close.title = 'Cerrar pestaña';
    close.addEventListener('click', (e) => { e.stopPropagation(); this.manager.close(this.id); });
    this.button.append(this.favEl, this.titleEl, close);
    this.button.addEventListener('click', () => this.manager.activate(this.id));
    this.button.addEventListener('auxclick', (e) => { if (e.button === 1) this.manager.close(this.id); });
  }

  #bindShadowEvents() {
    const openAnchor = (e) => e.composedPath().find((n) => n instanceof Element && n.matches('a[href]'));

    this.shadow.addEventListener('click', (e) => {
      const a = openAnchor(e);
      if (!a) return;
      if (a.dataset.pxHref) {
        e.preventDefault();
        if (e.button !== 0) return;
        if (e.ctrlKey || e.metaKey || a.target === '_blank') this.manager.create(a.dataset.pxHref, { activate: !e.ctrlKey && !e.metaKey ? true : false });
        else this.navigate(a.dataset.pxHref);
        return;
      }
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#')) {
        e.preventDefault();
        const id = decodeURIComponent(href.slice(1));
        const target = id && (this.shadow.getElementById(id) || this.shadow.querySelector(`[name="${CSS.escape(id)}"]`));
        if (target) target.scrollIntoView(); else this.host.scrollTop = 0;
      }
    });

    this.shadow.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      const a = openAnchor(e);
      if (a?.dataset.pxHref) { e.preventDefault(); this.manager.create(a.dataset.pxHref, { activate: false }); }
    });

    this.shadow.addEventListener('submit', (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      e.preventDefault();
      if (form.dataset.home) {
        const target = normalizeInput(String(new FormData(form).get('q') || ''));
        if (target) this.navigate(target);
        return;
      }
      const action = form.dataset.pxAction || this.url;
      const method = (form.getAttribute('method') || 'GET').toUpperCase();
      const entries = [...new FormData(form)].filter(([, v]) => typeof v === 'string');
      if (method === 'GET') {
        const u = new URL(action);
        u.search = '';
        entries.forEach(([k, v]) => u.searchParams.append(k, v));
        this.navigate(u.href);
      } else {
        this.navigate(action, { method: 'POST', body: new URLSearchParams(entries) });
      }
    });
  }

  /* ── Navegación ── */

  async navigate(url, { method = 'GET', body = null, history = 'push' } = {}) {
    // Sitios con mucho JavaScript: modo completo (se llama antes de cualquier await para que el navegador permita la ventana)
    if (method === 'GET' && FULL_HOSTS.test(hostOf(url)) && this.manager.openFull(url)) {
      this.loadId++;
      this.url = url;
      this.#setFavicon(url);
      this.#renderMessage('Abierto en una pestaña completa',
        `${url}\n\nEste sitio necesita JavaScript, así que se ha abierto en una pestaña nueva del navegador a través del proxy.\nMantén esta pestaña abierta mientras lo uses.`);
      this.#setTitle(hostOf(url));
      this.#setLoading(false);
      this.manager.sync(this);
      return;
    }
    const id = ++this.loadId;
    this.#setLoading(true);
    this.url = url;
    this.manager.sync(this);

    try {
      const res = await fetch(encodeProxy(url), { method, body, redirect: 'follow', credentials: 'same-origin' });
      if (id !== this.loadId) return;

      let finalUrl = url;
      if (res.url.startsWith(location.origin + CFG.prefix)) {
        try { finalUrl = decodeProxy(res.url.slice(location.origin.length)); } catch { /* conserva url */ }
      }
      const type = res.headers.get('content-type') || '';

      if (/html|xml/i.test(type) || !type) {
        const html = await res.text();
        if (id !== this.loadId) return;
        await this.#renderHtml(html, finalUrl);
        if (id !== this.loadId) return;
      } else {
        res.body?.cancel();
        this.#renderBinary(finalUrl, type);
      }

      this.url = finalUrl;
      this.isHome = false;
      this.#setFavicon(finalUrl);
      if (history === 'push') {
        this.entries = this.entries.slice(0, this.index + 1);
        this.entries.push(finalUrl);
        this.index = this.entries.length - 1;
      } else if (history === 'replace' && this.index >= 0) {
        this.entries[this.index] = finalUrl;
      }
    } catch (err) {
      if (id !== this.loadId) return;
      console.error(err);
      this.#renderMessage('No se pudo cargar la página', `${url}\n\n${err.message || err}`);
      this.#setTitle(new URL(url).hostname);
    } finally {
      if (id === this.loadId) { this.#setLoading(false); this.manager.sync(this); }
    }
  }

  back() { if (this.canBack) { this.index--; this.navigate(this.entries[this.index], { history: 'none' }); } }
  forward() { if (this.canForward) { this.index++; this.navigate(this.entries[this.index], { history: 'none' }); } }
  reload() { if (this.url) this.navigate(this.url, { history: 'replace' }); }

  /* ── Renderizado (Shadow DOM) ── */

  #renderHtml(html, finalUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const baseEl = doc.querySelector('base[href]');
    const base = (baseEl && absolutize(baseEl.getAttribute('href'), finalUrl)) || finalUrl;
    this.fontFaces = [];

    // Hojas de estilo enlazadas: se descargan, se reescriben y se insertan como <style>
    const links = [...doc.querySelectorAll('link[rel~="stylesheet"]')]
      .map((el) => ({ el, abs: absolutize(el.getAttribute('href'), base) }));

    const scriptCount = doc.querySelectorAll('script').length;
    doc.querySelectorAll(DROP).forEach((n) => n.remove());
    doc.querySelectorAll('*').forEach((el) => this.#sanitize(el, base, finalUrl));

    const pending = links.map(async ({ el, abs }) => {
      if (!abs) return el.remove();
      try {
        const r = await fetch(encodeProxy(abs));
        const style = doc.createElement('style');
        style.textContent = this.#processCss(await r.text(), abs);
        el.replaceWith(style);
      } catch { el.remove(); }
    });

    const loadId = this.loadId;
    return Promise.all(pending).then(() => {
      if (loadId !== this.loadId) return;

      doc.querySelectorAll('style').forEach((s) => { s.textContent = this.#processCss(s.textContent, base, !s.dataset.done); s.dataset.done = '1'; });
      this.fontStyle.textContent = this.fontFaces.join('\n');

      const root = this.shadow;
      root.replaceChildren();
      const baseStyle = document.createElement('style');
      baseStyle.textContent = BASE_CSS;
      root.append(baseStyle);
      [...doc.head.querySelectorAll('style')].forEach((s) => root.append(s));

      const htmlDiv = document.createElement('div');
      htmlDiv.className = ('px-html ' + doc.documentElement.className).trim();
      const bodyDiv = document.createElement('div');
      bodyDiv.className = ('px-body ' + (doc.body?.className || '')).trim();
      if (doc.body?.hasAttribute('style')) bodyDiv.setAttribute('style', urlsOnly(doc.body.getAttribute('style'), base));
      bodyDiv.append(...(doc.body ? [...doc.body.childNodes] : []));
      htmlDiv.append(bodyDiv);
      root.append(htmlDiv);
      const force = document.createElement('style');
      force.textContent = FORCE_CSS;
      root.append(force);
      if (scriptCount > 3) root.insertBefore(this.#fullBanner(), htmlDiv);

      this.host.scrollTop = 0;
      this.#setTitle(doc.title.trim() || new URL(finalUrl).hostname);
    });
  }

  #processCss(css, base, scope = true) {
    let out = css;
    if (scope) out = out.replace(SELECTOR_MAP, mapSelector);
    out = urlsOnly(out, base);
    out = out.replace(/@font-face\s*\{[^}]*\}/gi, (m) => { this.fontFaces.push(m); return ''; });
    return out;
  }

  #sanitize(el, base, pageUrl) {
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase();
      if (n.startsWith('on') || n.startsWith('__uv')) el.removeAttribute(attr.name);
    }
    const tag = el.localName;

    if (tag === 'a' || tag === 'area') {
      const raw = el.getAttribute('href') || '';
      const abs = absolutize(raw, base);
      if (abs) { el.dataset.pxHref = abs; el.setAttribute('href', '#'); }
      else if (/^javascript:/i.test(raw.trim())) el.removeAttribute('href');
      el.removeAttribute('ping');
    } else if (tag === 'form') {
      el.dataset.pxAction = absolutize(el.getAttribute('action') || '', base) || pageUrl;
      el.removeAttribute('action');
    } else {
      for (const a of ['src', 'poster', 'data-src']) {
        if (el.hasAttribute(a)) el.setAttribute(a, proxify(el.getAttribute(a), base));
      }
      for (const a of ['srcset', 'data-srcset']) {
        if (el.hasAttribute(a)) el.setAttribute(a, proxifySrcset(el.getAttribute(a), base));
      }
    }
    if (el.hasAttribute('style')) el.setAttribute('style', urlsOnly(el.getAttribute('style'), base));
  }

  #renderBinary(url, type) {
    const root = this.shadow;
    root.replaceChildren();
    const style = document.createElement('style');
    style.textContent = BASE_CSS + '.px-body{margin:24px}';
    const wrap = document.createElement('div');
    wrap.className = 'px-body';
    if (/^image\//i.test(type)) {
      const img = document.createElement('img');
      img.src = encodeProxy(url);
      wrap.append(img);
    } else {
      const a = document.createElement('a');
      a.href = encodeProxy(url);
      a.download = '';
      a.textContent = `Descargar archivo (${type})`;
      wrap.append(a);
    }
    root.append(style, wrap);
    this.#setTitle(url.split('/').pop() || new URL(url).hostname);
  }

  #renderMessage(heading, text) {
    const root = this.shadow;
    root.replaceChildren();
    const style = document.createElement('style');
    style.textContent = BASE_CSS + `.px-body{margin:0;padding:48px 24px;text-align:center;color:#444}
      h1{font-size:20px;margin:0 0 12px} p{white-space:pre-wrap;word-break:break-word;margin:0}`;
    const wrap = document.createElement('div');
    wrap.className = 'px-body';
    const h = document.createElement('h1'); h.textContent = heading;
    const p = document.createElement('p'); p.textContent = text;
    wrap.append(h, p);
    root.append(style, wrap);
  }

  #fullBanner() {
    const bar = el('div', 'px-banner');
    bar.append(el('span', null, 'Esta página usa JavaScript; aquí solo se muestra su contenido estático.'));
    const open = el('button', 'px-banner-btn', 'Abrir completa ↗');
    open.addEventListener('click', () => this.manager.openFull(this.url));
    const close = el('button', 'px-banner-x', '×');
    close.addEventListener('click', () => bar.remove());
    bar.append(open, close);
    return bar;
  }

  #setFavicon(url) {
    const host = hostOf(url);
    this.favEl.className = 'fav';
    this.favEl.textContent = (host[0] || '?').toUpperCase();
    this.favEl.style.background = `hsl(${hue(host)} 62% 46%)`;
  }

  #renderHome() {
    const root = this.shadow;
    root.replaceChildren();
    this.isHome = true;
    this.url = '';
    this.favEl.className = 'fav home';
    this.favEl.textContent = '';
    this.favEl.style.background = '';
    this.#setTitle('Nueva pestaña');

    const style = document.createElement('style');
    style.textContent = BASE_CSS + HOME_CSS;

    const home = el('div', 'home');
    const logo = el('div', 'logo');
    logo.append(el('span', 'logo-mark', '◆'), el('span', 'logo-text', 'Shadow'), el('span', 'logo-gx', 'GX'));

    const form = el('form', 'search');
    form.dataset.home = '1';
    const ico = el('span', 'search-ico');
    ico.innerHTML = SEARCH_SVG;
    const input = el('input');
    input.name = 'q';
    input.type = 'text';
    input.placeholder = 'Busca en DuckDuckGo o escribe una URL';
    input.autocomplete = 'off';
    input.spellcheck = false;
    form.append(ico, input);

    const grid = el('div', 'grid');
    const seen = new Set();
    const sites = [...DEFAULT_SITES, ...Bookmarks.list.map((b) => ({ name: b.title, url: b.url }))];
    for (const s of sites) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      const a = el('a', 'tile');
      a.setAttribute('href', '#');
      a.dataset.pxHref = s.url;
      const tIco = el('span', 'tile-ico', (s.name[0] || '?').toUpperCase());
      tIco.style.background = `hsl(${hue(s.name)} 62% 46%)`;
      a.append(tIco, el('span', 'tile-name', s.name));
      grid.append(a);
    }

    home.append(logo, form, grid, el('p', 'hint', 'Cada pestaña se renderiza en un Shadow DOM aislado, sin iframes.'));
    root.append(style, home);
  }

  #setTitle(t) { this.title = t; this.titleEl.textContent = t; this.titleEl.title = t; }
  #setLoading(on) { this.loading = on; this.button.classList.toggle('loading', on); }

  destroy() { this.fontStyle.remove(); this.host.remove(); this.button.remove(); }
}

/* ───────────── Gestor de pestañas ───────────── */

class TabManager {
  constructor({ tabsEl, viewport, input, backBtn, fwdBtn, reloadBtn, newBtn }) {
    Object.assign(this, { tabsEl, viewport, input, backBtn, fwdBtn, reloadBtn });
    this.tabs = new Map();
    this.activeId = null;

    newBtn.addEventListener('click', () => this.create());
    backBtn.addEventListener('click', () => this.active?.back());
    fwdBtn.addEventListener('click', () => this.active?.forward());
    reloadBtn.addEventListener('click', () => this.active?.reload());
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const url = normalizeInput(input.value);
      if (url) { this.active?.navigate(url); input.blur(); }
    });
  }

  get active() { return this.tabs.get(this.activeId); }

  create(url = null, { activate = true } = {}) {
    const tab = new Tab(this);
    this.tabs.set(tab.id, tab);
    this.tabsEl.append(tab.button);
    this.viewport.append(tab.host);
    tab.host.hidden = true;
    if (activate || !this.active) this.activate(tab.id);
    if (url) tab.navigate(url);
    else if (this.activeId === tab.id) this.input.focus();
    return tab;
  }

  activate(id) {
    if (!this.tabs.has(id)) return;
    this.activeId = id;
    for (const t of this.tabs.values()) {
      const on = t.id === id;
      t.host.hidden = !on;
      t.button.classList.toggle('active', on);
    }
    this.active.button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.sync(this.active);
  }

  close(id) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    const ids = [...this.tabs.keys()];
    const idx = ids.indexOf(id);
    tab.loadId++;
    tab.destroy();
    this.tabs.delete(id);
    if (this.tabs.size === 0) { this.create(); return; }
    if (this.activeId === id) this.activate(ids[idx + 1] ?? ids[idx - 1]);
  }

  openFull(url) {
    if (!url) return false;
    return !!window.open(CFG.prefix + CFG.encodeUrl(url), '_blank');
  }

  sync(tab) {
    if (tab !== this.active) return;
    if (document.activeElement !== this.input) this.input.value = tab.url;
    this.backBtn.disabled = !tab.canBack;
    this.fwdBtn.disabled = !tab.canForward;
    document.title = tab.title ? `${tab.title} — Shadow GX` : 'Shadow GX';
    this.onChange?.(tab);
  }
}

/* ───────────── Service Worker + transporte ───────────── */

async function registerProxy() {
  if (!('serviceWorker' in navigator)) throw new Error('Este navegador no soporta Service Workers (¿HTTPS?).');

  // Scope "/" (no el prefix): la página principal debe estar controlada por el SW,
  // porque sus fetch()/<img> hacia CFG.prefix solo se interceptan si es "cliente" del SW.
  // sw.js importa uv.sw.js y solo procesa URLs bajo CFG.prefix.
  await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  await navigator.serviceWorker.ready;

  if (!navigator.serviceWorker.controller) {
    await Promise.race([
      new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true })),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    if (!navigator.serviceWorker.controller) { location.reload(); return new Promise(() => {}); }
  }

  const wisp = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/wisp/`;
  const connection = new BareMux.BareMuxConnection('/baremux/worker.js');
  await connection.setTransport('/epoxy/index.mjs', [{ wisp }]);
}

/* ───────────── Interfaz: temas, marcadores y menú ───────────── */

const THEMES = ['gx', 'chrome', 'light'];

function applyTheme(name) {
  if (!THEMES.includes(name)) name = 'gx';
  document.documentElement.dataset.theme = name;
  Store.set('sp.theme', name);
  document.querySelectorAll('[data-theme-pick]').forEach((b) => b.classList.toggle('on', b.dataset.themePick === name));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = { gx: '#08080c', chrome: '#202124', light: '#dee1e6' }[name];
}

function renderBookmarksBar(manager) {
  const bar = $('#bookmarks');
  bar.replaceChildren();
  for (const b of Bookmarks.list) {
    const host = hostOf(b.url);
    const btn = el('button', 'bm');
    const ico = el('span', 'bm-ico', (host[0] || '?').toUpperCase());
    ico.style.background = `hsl(${hue(host)} 62% 46%)`;
    btn.append(ico, el('span', 'bm-name', b.title));
    btn.title = b.url + '\nClic derecho: quitar';
    btn.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) manager.create(b.url);
      else manager.active?.navigate(b.url);
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      Bookmarks.remove(b.url);
      renderBookmarksBar(manager);
      if (manager.active) manager.sync(manager.active);
    });
    bar.append(btn);
  }
  const visible = Store.get('sp.bar', true);
  bar.hidden = !visible || Bookmarks.list.length === 0;
  $('#toggle-bar').classList.toggle('on', visible);
}

/* ───────────── Arranque ───────────── */

(async function boot() {
  applyTheme(Store.get('sp.theme', 'gx'));
  const status = $('#status');
  try {
    await registerProxy();
  } catch (err) {
    console.error(err);
    status.classList.add('error');
    status.querySelector('.msg').textContent = 'Error iniciando el proxy: ' + (err.message || err);
    return;
  }
  status.hidden = true;

  const manager = new TabManager({
    tabsEl: $('#tabs'),
    viewport: $('#viewport'),
    input: $('#url'),
    backBtn: $('#back'),
    fwdBtn: $('#forward'),
    reloadBtn: $('#reload'),
    newBtn: $('#new-tab'),
  });
  window.tabs = manager; // útil para depurar desde la consola

  const star = $('#star');
  const secure = $('#secure');
  const progress = $('#progress');
  const openFull = $('#open-full');
  manager.onChange = (tab) => {
    star.disabled = !tab.url;
    star.classList.toggle('on', !!tab.url && Bookmarks.has(tab.url));
    secure.dataset.state = !tab.url ? 'none' : tab.url.startsWith('https:') ? 'ok' : 'warn';
    progress.classList.toggle('active', !!tab.loading);
    openFull.disabled = !tab.url;
  };

  star.addEventListener('click', () => {
    const tab = manager.active;
    if (!tab?.url) return;
    Bookmarks.toggle(tab.url, tab.title);
    renderBookmarksBar(manager);
    manager.sync(tab);
  });

  openFull.addEventListener('click', () => manager.openFull(manager.active?.url));

  // Barra lateral estilo Opera GX
  $('#sb-logo').addEventListener('click', () => manager.create());
  const sidebarSites = $('#sb-sites');
  for (const s of DEFAULT_SITES.slice(0, 5)) {
    const b = el('button', 'sb-btn');
    b.title = s.name;
    const i = el('span', 'sb-ico', s.name[0]);
    i.style.background = `hsl(${hue(s.name)} 62% 46%)`;
    b.append(i);
    b.addEventListener('click', () => manager.create(s.url));
    sidebarSites.append(b);
  }

  // Menú
  const menu = $('#menu');
  const toggleMenu = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  $('#menu-btn').addEventListener('click', toggleMenu);
  $('#sb-menu').addEventListener('click', toggleMenu);
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.hidden = true; });
  document.querySelectorAll('[data-theme-pick]').forEach((b) =>
    b.addEventListener('click', () => { applyTheme(b.dataset.themePick); menu.hidden = true; }));
  $('#menu-new').addEventListener('click', () => { menu.hidden = true; manager.create(); });
  $('#toggle-bar').addEventListener('click', () => {
    Store.set('sp.bar', !Store.get('sp.bar', true));
    renderBookmarksBar(manager);
  });

  applyTheme(Store.get('sp.theme', 'gx'));
  renderBookmarksBar(manager);
  manager.create();
})();
