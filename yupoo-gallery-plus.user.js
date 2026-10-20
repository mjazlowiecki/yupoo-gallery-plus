// ==UserScript==
// @name         Yupoo Gallery+
// @namespace    https://github.com/mjazlowiecki/yupoo-gallery-plus
// @version      0.6.0
// @description  Larger album tiles and a hover preview for Yupoo galleries.
// @match        https://*.yupoo.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/mjazlowiecki/yupoo-gallery-plus/main/yupoo-gallery-plus.user.js
// @updateURL    https://raw.githubusercontent.com/mjazlowiecki/yupoo-gallery-plus/main/yupoo-gallery-plus.user.js
// ==/UserScript==

/**
 * Yupoo Gallery+
 *
 * Two features:
 *   1. Re-lays out the album grid with larger tiles (CSS Grid).
 *   2. Shows a floating, full-size preview of the album cover on hover.
 *
 * The script does not depend on Yupoo's CSS class names. It locates the grid
 * by looking for links to /albums/ and walking up the DOM, so small markup
 * changes on the site should not break it.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  const DEFAULTS = {
    tileMinWidth: 300,
    gap: 16,
    previewMaxW: 560,
    previewMaxH: 760,
    hoverDelay: 120,
    tileAspect: '1 / 1',
    previewEnabled: true,
    currency: 'PLN', // target currency (ISO code)
    cnyRate: 0.55, // 1 CNY in the target currency; change from the menu
    showPrices: true,
    bareNumberIsCny: false, // treat a leading bare number ("138 be123") as CNY
    showDates: true,
    dateSamples: 6, // albums fetched per page to calibrate date estimates (min 2)
    maxAgeYears: 0, // hide albums older than this many years (0 = no filter)
    sort: 'default', // 'default' | 'newest' | 'oldest' | 'cheapest' | 'priciest'
  };

  /** Persistent storage: GM_* in a userscript manager, localStorage in the extension build. */
  const store = {
    get(key, fallback) {
      try {
        if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
        const raw = localStorage.getItem('yg:' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        if (typeof GM_setValue === 'function') GM_setValue(key, value);
        else localStorage.setItem('yg:' + key, JSON.stringify(value));
      } catch {
        /* storage unavailable: settings just won't persist */
      }
    },
  };

  const CONFIG = { ...DEFAULTS, ...store.get('config', {}) };
  const saveConfig = () =>
    store.set(
      'config',
      Object.fromEntries(Object.entries(CONFIG).filter(([k, v]) => v !== DEFAULTS[k]))
    );

  /** Selector for links that point to an album page. */
  const ALBUM_LINK = 'a[href*="/albums/"]';

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------
  // !important is needed because the Yupoo's own stylesheet sets fixed tile sizes.
  const style = document.createElement('style');
  const renderStyles = () => {
    style.textContent = `
    .yg-grid {
      display: grid !important;
      grid-template-columns: repeat(auto-fill, minmax(${CONFIG.tileMinWidth}px, 1fr)) !important;
      gap: ${CONFIG.gap}px !important;
      width: 100% !important;
      float: none !important;
    }
    .yg-tile {
      width: auto !important;
      max-width: none !important;
      margin: 0 !important;
      float: none !important;
      position: relative;
    }
    .yg-price,
    .yg-date {
      position: absolute;
      top: 8px;
      z-index: 2;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.75);
      color: #fff;
      font: 600 12px/1.5 system-ui, sans-serif;
      pointer-events: none; /* keep hover on the tile working */
    }
    .yg-price { left: 8px; }
    .yg-date { right: 8px; }
    .yg-old { display: none !important; }
    #yg-bar {
      position: fixed;
      right: 12px;
      bottom: 12px;
      z-index: 2147483646;
      padding: 6px 12px;
      border-radius: 999px;
      background: #fff;
      color: #222;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
      font: 13px system-ui, sans-serif;
    }
    #yg-bar select { font: inherit; border: 0; background: transparent; }
    .yg-tile img {
      width: 100% !important;
      height: auto !important;
      aspect-ratio: ${CONFIG.tileAspect};
      object-fit: cover;
      display: block;
    }
    #yg-preview {
      position: fixed;
      z-index: 2147483647;
      display: none;
      pointer-events: none; /* never steal hover/click from the tile underneath */
      background: #fff;
      padding: 6px;
      border-radius: 8px;
      box-shadow: 0 10px 40px rgba(0,0,0,.35);
    }
    #yg-preview img {
      display: block;
      max-width: ${CONFIG.previewMaxW}px;
      max-height: min(${CONFIG.previewMaxH}px, calc(100vh - 68px));
      border-radius: 4px;
    }
    #yg-bar label + label { margin-left: 12px; }
    #yg-preview .yg-caption {
      margin: 6px 2px 0;
      max-width: ${CONFIG.previewMaxW}px;
      font: 13px/1.3 system-ui, sans-serif;
      color: #222;
      overflow-wrap: anywhere;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    #yg-preview .yg-caption:empty { display: none; }
    `;
  };
  renderStyles();
  document.head.appendChild(style);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Yupoo serves the same image in several sizes under one path:
   * square / small / medium / big. Swap the size suffix in a photo URL.
   *
   * @param {string} url  Image URL, e.g. ".../abc123/small.jpg"
   * @param {'square'|'small'|'medium'|'big'} size  Target size.
   * @returns {string} URL pointing to the requested size (unchanged if no match).
   */
  const withSize = (url, size) =>
    url.replace(/\/(square|small|medium|big)\.(jpe?g|png|webp)/i, `/${size}.$2`);

  /**
   * Get the best available source URL of a (possibly lazy-loaded) <img>.
   * Yupoo keeps the real URL in `data-origin-src` until the image is loaded.
   *
   * @param {HTMLImageElement} img
   * @returns {string} Absolute URL, or an empty string if none is available.
   */
  const imgUrl = (img) => {
    const u = img.getAttribute('data-origin-src') || img.currentSrc || img.src || '';
    return u.startsWith('//') ? location.protocol + u : u;
  };

  /** Patterns sellers use for a CNY price in an album title (first match wins). */
  const PRICE_PATTERNS = [
    /[\uFFE5\u00A5]\s*(\d+(?:[.,]\d+)?)/, // ￥138, ¥138
    /(\d+(?:[.,]\d+)?)\s*(?:RMB|CNY|\u5143)/i, // 138RMB, 138 元
    /(?:RMB|CNY)\s*(\d+(?:[.,]\d+)?)/i, // RMB 138
  ];

  /**
   * Extract a CNY price from an album title.
   *
   * @param {string} title
   * @returns {number | null} Price in CNY, or null if none was recognised.
   */
  const parsePriceCny = (title) => {
    for (const re of PRICE_PATTERNS) {
      const m = title.match(re);
      if (m) return parseFloat(m[1].replace(',', '.'));
    }
    if (CONFIG.bareNumberIsCny) {
      const m = title.match(/^\s*(\d{2,4})(?![\w.])/);
      if (m) return Number(m[1]);
    }
    return null;
  };

  /**
   * @param {number} cny  Price in CNY.
   * @returns {string} Converted price, e.g. "≈ 76 zł".
   */
  const formatPrice = (cny) =>
    '≈ ' +
    new Intl.NumberFormat(navigator.language, {
      style: 'currency',
      currency: CONFIG.currency,
      maximumFractionDigits: 0,
    }).format(cny * CONFIG.cnyRate);

  /**
   * Best-effort album title for a tile: link title, image alt, or the tile's visible text.
   *
   * @param {HTMLAnchorElement} link
   * @param {HTMLImageElement} img
   * @returns {string} Single-line title, at most 120 characters (empty if none found).
   */
  const captionOf = (link, img) => {
    const tile = link.closest('.yg-tile') || link;
    const cny = tile && tile.dataset.ygCny;
    previewCaption.textContent =
      captionOf(tileLink, img) + (CONFIG.showPrices && cny ? '  ' + formatPrice(Number(cny)) : '');
    const raw = link.getAttribute('title') || img.alt || tile.textContent || '';
    return raw.replace(/\s+/g, ' ').trim().slice(0, 120);
  };
  /**
   * Find the element that contains all album tiles.
   *
   * Strategy: collect every album link that has an image, then climb from the
   * first one until the parent contains (almost) all of them. That parent is
   * the grid container.
   *
   * @returns {{grid: HTMLElement, links: HTMLAnchorElement[]} | null}
   *          null when the page has no album grid (fewer than 4 albums).
   */
  function findGrid() {
    const withImg = (a) => a.querySelector('img');
    const links = [...document.querySelectorAll(ALBUM_LINK)].filter(withImg);
    if (links.length < 4) return null;

    let el = links[0];
    while (
      el.parentElement &&
      [...el.parentElement.querySelectorAll(ALBUM_LINK)].filter(withImg).length < links.length * 0.9
    ) {
      el = el.parentElement;
    }
    return { grid: el.parentElement, links };
  }

  // ---------------------------------------------------------------------------
  // Feature 1: larger tiles
  // ---------------------------------------------------------------------------

  /**
   * Create or refresh the price badge of a tile. The CNY price is parsed once and
   * cached in data-yg-cny; later calls only re-render (e.g. after the rate changed).
   *
   * @param {HTMLElement} tile  Grid child wrapping one album.
   */
  function updatePriceBadge(tile) {
    if (tile.dataset.ygCny === undefined) {
      const link = tile.querySelector(ALBUM_LINK);
      const title = (link && link.getAttribute('title')) || tile.textContent || '';
      const cny = parsePriceCny(title);
      tile.dataset.ygCny = cny === null ? '' : String(cny);
    }

    let badge = tile.querySelector(':scope > .yg-price');
    if (!CONFIG.showPrices || tile.dataset.ygCny === '') {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'yg-price';
      tile.appendChild(badge);
    }
    const text = formatPrice(Number(tile.dataset.ygCny));
    // Only touch the DOM when the text changed, otherwise the MutationObserver loops.
    if (badge.textContent !== text) badge.textContent = text;
  }

  const renderPrices = () => document.querySelectorAll('.yg-tile').forEach(updatePriceBadge);

  /**
   * Apply the grid layout and upgrade thumbnails to a higher resolution.
   * Safe to call repeatedly: already-upgraded images are skipped.
   */
  function enlarge() {
    const found = findGrid();
    if (!found) return;

    const { grid } = found;
    grid.classList.add('yg-grid');
    [...grid.children].forEach((child) => {
      child.classList.add('yg-tile');
      updatePriceBadge(child);
    });

    if (!bar.isConnected) document.body.appendChild(bar);
    renderDates();
    renderOrder();
    loadDates();

    grid.querySelectorAll('img').forEach((img) => {
      if (img.dataset.ygUp) return; // already processed
      const url = imgUrl(img);
      if (!/photo\.yupoo\.com/.test(url)) return; // only touch Yupoo photos

      img.dataset.ygUp = '1';
      const bigger = withSize(url, 'medium');
      if (bigger !== url) {
        // Fall back to the original thumbnail if the larger size 404s.
        img.addEventListener(
          'error',
          () => {
            img.src = url;
          },
          { once: true }
        );
        img.src = bigger;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Feature 2: hover preview
  // ---------------------------------------------------------------------------
  const preview = document.createElement('div');
  preview.id = 'yg-preview';
  const previewImg = document.createElement('img');
  const previewCaption = document.createElement('div');
  previewCaption.className = 'yg-caption';
  preview.append(previewImg, previewCaption);
  document.body.appendChild(preview);

  /** @type {number | null} Pending "show preview" timeout. */
  let timer = null;
  /** @type {HTMLAnchorElement | null} Tile the pointer is currently over. */
  let currentTile = null;

  /**
   * Place the preview next to the cursor, keeping it inside the viewport.
   * Defaults to the right of the cursor; flips to the left near the right edge.
   *
   * @param {{clientX: number, clientY: number}} e  Pointer position.
   */
  function position(e) {
    const offset = 20;
    const margin = 8;
    const w = preview.offsetWidth;
    const h = preview.offsetHeight;

    let x = e.clientX + offset;
    if (x + w > window.innerWidth - margin) x = e.clientX - w - offset;

    let y = e.clientY - h / 2; // vertically centred on the cursor
    y = Math.max(margin, Math.min(y, window.innerHeight - h - margin));

    preview.style.left = Math.max(margin, x) + 'px';
    preview.style.top = y + 'px';
  }

  /**
   * Load the full-size cover of a tile and show it.
   *
   * @param {HTMLAnchorElement} tileLink  Album link wrapping the thumbnail.
   * @param {{clientX: number, clientY: number}} e  Pointer position.
   */
  function show(tileLink, e) {
    const img = tileLink.querySelector('img');
    if (!img) return;

    const url = imgUrl(img);
    previewCaption.textContent = captionOf(tileLink, img);

    const reveal = () => {
      if (currentTile !== tileLink) return; // pointer already left or moved to another tile
      preview.style.display = 'block';
      position(e);
    };

    previewImg.onload = reveal;
    // If "big" does not exist for this photo, fall back to the thumbnail URL.
    previewImg.onerror = () => {
      if (previewImg.src !== url) previewImg.src = url;
    };
    previewImg.src = withSize(url, 'big');

    // Cached image: onload may not fire again, so show immediately.
    if (previewImg.complete && previewImg.naturalWidth) reveal();
  }

  /** Hide the preview and cancel any pending show. */
  function hide() {
    clearTimeout(timer);
    currentTile = null;
    preview.style.display = 'none';
  }

  // Event delegation: one set of listeners for the whole page instead of one
  // per tile, so tiles added later work without extra setup.
  document.addEventListener('mouseover', (e) => {
    if (!CONFIG.previewEnabled) return;
    const link = e.target.closest && e.target.closest(ALBUM_LINK);
    if (!link || !link.querySelector('img') || !link.closest('.yg-grid')) return;
    if (link === currentTile) return;

    currentTile = link;
    clearTimeout(timer);
    const pos = { clientX: e.clientX, clientY: e.clientY };
    timer = setTimeout(() => show(link, pos), CONFIG.hoverDelay);
  });

  document.addEventListener('mousemove', (e) => {
    if (preview.style.display === 'block') position(e);
  });

  document.addEventListener('mouseout', (e) => {
    const link = e.target.closest && e.target.closest(ALBUM_LINK);
    // Ignore moves between children of the same tile.
    if (link && link === currentTile && !link.contains(e.relatedTarget)) hide();
  });

  window.addEventListener('scroll', hide, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });

  // ---------------------------------------------------------------------------
  // Feature 3: album dates and age filter
  // ---------------------------------------------------------------------------
  // The listing has no dates, but every album page carries "datePublished" in its
  // JSON-LD. Albums are ~220 KB each, so we fetch only a few per page and
  // interpolate the rest from the (global, increasing) album ids.
  const DAY = 86400000;
  /** @type {Record<string, string>} Real dates fetched so far: album id -> 'YYYY-MM-DD'. */
  const knownDates = store.get('dates', {});
  /** Ids whose fetch failed in this session, so a broken request is not retried in a loop. */
  const failedIds = new Set();
  let datesBusy = false;

  /**
   * @param {HTMLElement} tile
   * @returns {number | null} Album id taken from the tile's link.
   */
  const idOf = (tile) => {
    const link = tile.querySelector(ALBUM_LINK);
    const m = link && link.getAttribute('href').match(/\/albums\/(\d+)/);
    return m ? Number(m[1]) : null;
  };

  /**
   * @param {string} url  Album page URL.
   * @returns {Promise<string | null>} Publish date as 'YYYY-MM-DD', if found.
   */
  async function fetchAlbumDate(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const m = (await res.text()).match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }

  /**
   * Linear interpolation between the two known albums surrounding `id`.
   *
   * @param {number} id
   * @param {Array<[number, number]>} list  Known [id, timestamp] pairs sorted by id.
   * @returns {number | null} Timestamp in ms, or null outside the known range.
   */
  function estimateTime(id, list) {
    let lo = null;
    let hi = null;
    for (const a of list) {
      if (a[0] <= id) lo = a;
      else {
        hi = a;
        break;
      }
    }
    if (lo && lo[0] === id) return lo[1];
    if (!lo || !hi) return null; // never extrapolate
    return lo[1] + ((id - lo[0]) / (hi[0] - lo[0])) * (hi[1] - lo[1]);
  }

  /** Up to `n` tiles evenly spaced by album id, always including the oldest and newest. */
  function pickSamples(tiles, n) {
    const sorted = tiles.filter((t) => idOf(t) !== null).sort((a, b) => idOf(a) - idOf(b));
    if (sorted.length <= n) return sorted;
    return Array.from(
      { length: n },
      (_, i) => sorted[Math.round((i * (sorted.length - 1)) / (n - 1))]
    );
  }
  const SORTS = [
    ['default', 'Default'],
    ['newest', 'Newest'],
    ['oldest', 'Oldest'],
    ['cheapest', 'Cheapest'],
    ['priciest', 'Most expensive'],
  ];

  // Small control bar: age filter and sort order.
  const bar = document.createElement('div');
  bar.id = 'yg-bar';

  const ageBox = document.createElement('label');
  ageBox.append('Age: ');
  const ageSelect = document.createElement('select');
  [
    [0, 'any'],
    [1, '≤ 1 year'],
    [2, '≤ 2 years'],
    [3, '≤ 3 years'],
    [5, '≤ 5 years'],
  ].forEach(([v, text]) => ageSelect.add(new Option(text, v)));
  ageSelect.value = String(CONFIG.maxAgeYears);
  ageSelect.addEventListener('change', () => {
    CONFIG.maxAgeYears = Number(ageSelect.value);
    saveConfig();
    renderDates();
  });
  ageBox.append(ageSelect);

  const sortBox = document.createElement('label');
  sortBox.append('Sort: ');
  const sortSelect = document.createElement('select');
  SORTS.forEach(([v, text]) => sortSelect.add(new Option(text, v)));
  sortSelect.value = CONFIG.sort;
  sortSelect.addEventListener('change', () => {
    CONFIG.sort = sortSelect.value;
    saveConfig();
    renderOrder();
  });
  sortBox.append(sortSelect);

  bar.append(ageBox, sortBox);

  /** Show date badges and hide albums older than the chosen age. Safe to call repeatedly. */
  function renderDates() {
    ageBox.style.display = CONFIG.showDates ? '' : 'none';
    ageSelect.value = String(CONFIG.maxAgeYears);
    sortSelect.value = CONFIG.sort;
    const list = Object.entries(knownDates)
      .map(([id, d]) => [Number(id), Date.parse(d)])
      .filter(([, t]) => !Number.isNaN(t))
      .sort((a, b) => a[0] - b[0]);
    const cutoff = CONFIG.maxAgeYears > 0 ? Date.now() - CONFIG.maxAgeYears * 365.25 * DAY : null;

    document.querySelectorAll('.yg-tile').forEach((tile) => {
      const id = idOf(tile);
      const t = CONFIG.showDates && id !== null ? estimateTime(id, list) : null;
      tile.classList.toggle('yg-old', cutoff !== null && t !== null && t < cutoff);

      let badge = tile.querySelector(':scope > .yg-date');
      if (t === null) {
        if (badge) badge.remove();
        return;
      }
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'yg-date';
        tile.appendChild(badge);
      }
      const text = knownDates[id] || '~' + new Date(t).toISOString().slice(0, 7);
      if (badge.textContent !== text) badge.textContent = text; // avoid MutationObserver loops
    });
  }

  /**
   * Reorder tiles visually with CSS `order` (the DOM order stays untouched).
   * Albums without the needed data (no price / no id) go to the end.
   * Newest/oldest use the album id, which grows with publish date.
   */
  function renderOrder() {
    const tiles = [...document.querySelectorAll('.yg-tile')];
    const price = (t) => (t.dataset.ygCny ? Number(t.dataset.ygCny) : null);
    const id = (t) => idOf(t);
    const keys = {
      newest: (t) => (id(t) === null ? null : -id(t)),
      oldest: id,
      cheapest: price,
      priciest: (t) => (price(t) === null ? null : -price(t)),
    };
    const keyFn = keys[CONFIG.sort];
    if (!keyFn) {
      // 'default' or an unknown stored value: keep Yupoo's own order
      tiles.forEach((t) => {
        t.style.order = '';
      });
      return;
    }
    tiles
      .map((t) => {
        const k = keyFn(t);
        return [t, k === null ? Infinity : k];
      })
      .sort((a, b) => (a[1] === b[1] ? 0 : a[1] < b[1] ? -1 : 1))
      .forEach(([t], rank) => {
        t.style.order = String(rank);
      });
  }

  /** Fetch the real date of a few sample albums on this page, then re-render. */
  async function loadDates() {
    if (datesBusy || !CONFIG.showDates) return;
    datesBusy = true;
    try {
      const tiles = [...document.querySelectorAll('.yg-tile')];
      for (const tile of pickSamples(tiles, Math.max(2, CONFIG.dateSamples))) {
        const id = idOf(tile);
        if (knownDates[id] || failedIds.has(id)) continue;
        try {
          const date = await fetchAlbumDate(tile.querySelector(ALBUM_LINK).href);
          if (date) {
            knownDates[id] = date;
            store.set('dates', knownDates);
            renderDates();
          } else {
            failedIds.add(id);
          }
        } catch {
          failedIds.add(id); // network or HTTP error: skip this sample
        }
        await new Promise((resolve) => setTimeout(resolve, 400)); // be gentle with the server
      }
    } finally {
      datesBusy = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  if (typeof GM_registerMenuCommand === 'function') {
    const change = (fn) => () => {
      fn();
      saveConfig();
      renderStyles();
      renderPrices();
      renderDates();
      loadDates();
    };
    GM_registerMenuCommand(
      'Tiles: bigger',
      change(() => {
        CONFIG.tileMinWidth = Math.min(600, CONFIG.tileMinWidth + 50);
      })
    );
    GM_registerMenuCommand(
      'Tiles: smaller',
      change(() => {
        CONFIG.tileMinWidth = Math.max(150, CONFIG.tileMinWidth - 50);
      })
    );
    GM_registerMenuCommand(
      'Toggle hover preview',
      change(() => {
        CONFIG.previewEnabled = !CONFIG.previewEnabled;
        if (!CONFIG.previewEnabled) hide();
      })
    );
    GM_registerMenuCommand(
      'Reset settings',
      change(() => {
        Object.assign(CONFIG, DEFAULTS);
      })
    );
    GM_registerMenuCommand(
      'Toggle price badges',
      change(() => {
        CONFIG.showPrices = !CONFIG.showPrices;
      })
    );
    GM_registerMenuCommand(
      'Toggle album dates',
      change(() => {
        CONFIG.showDates = !CONFIG.showDates;
      })
    );
    GM_registerMenuCommand('Set CNY rate…', () => {
      const v = parseFloat(
        String(prompt(`1 CNY in ${CONFIG.currency}:`, CONFIG.cnyRate)).replace(',', '.')
      );
      if (v > 0)
        change(() => {
          CONFIG.cnyRate = v;
        })();
    });
  }
  enlarge();

  // Re-run when the page adds or lazy-loads tiles (debounced).
  let debounce;
  new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(enlarge, 250);
  }).observe(document.body, { childList: true, subtree: true });
})();
