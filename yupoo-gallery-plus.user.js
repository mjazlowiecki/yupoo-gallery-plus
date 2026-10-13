// ==UserScript==
// @name         Yupoo Gallery+
// @namespace    https://github.com/mjazlowiecki/yupoo-gallery-plus
// @version      0.1.0
// @description  Jest larger album tiles and a hover preview for Yupoo galleries.
// @match        https://*.yupoo.com/*
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==
 
/**
 * Yupoo Gallery+
 *
 * Two features:
 *   1. Re-lays out the album grid with larger tiles (CSS Grid).
 *   2. TODO: Shows a floating, full-size preview of the album cover on hover.
 *
 * The script does not depend on Yupoo's CSS class names. It locates the grid
 * by looking for links to /albums/ and walking up the DOM, so small markup
 * changes on the site should not break it.
 */

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  const CONFIG = {
    tileMinWidth: 300, // px, minimum tile width; larger value = fewer, bigger tiles
    gap: 16,           // px, gap between tiles
    previewMaxW: 560,  // px, max width of the hover preview
    previewMaxH: 760,  // px, max height of the hover preview
    hoverDelay: 120,   // ms, delay before the preview shows (avoids flicker)
  };

  /** Selector for links that point to an album page. */
  const ALBUM_LINK = 'a[href*="/albums/"]';

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------
  // !important is needed because the yupoo's own stylesheet sets fixed tile sizes.

  const style = document.createElement('style');
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
    }
    .yg-tile img {
      width: 100% !important;
      height: auto !important;
      aspect-ratio: 1 / 1;
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
      max-height: ${CONFIG.previewMaxH}px;
      border-radius: 4px;
    }
  `;
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

  /**
   * Find the element that contains all album tiles.
   *
   * how?: collect every album link that has an image, then climb from the
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
   * Apply the grid layout and upgrade thumbnails to a higher resolution.
   * Safe to call repeatedly: already-upgraded images are skipped.
   */
   function enlarge() {
    const found = findGrid();
    if (!found) return;
 
    const { grid } = found;
    grid.classList.add('yg-grid');
    [...grid.children].forEach((child) => child.classList.add('yg-tile'));
 
    grid.querySelectorAll('img').forEach((img) => {
      if (img.dataset.ygUp) return; // already processed
      const url = imgUrl(img);
      if (!/photo\.yupoo\.com/.test(url)) return; // only touch Yupoo photos
 
      img.dataset.ygUp = '1';
      const bigger = withSize(url, 'medium');
      if (bigger !== url) {
        // Fall back to the original thumbnail if the larger size 404s.
        img.addEventListener('error', () => { img.src = url; }, { once: true });
        img.src = bigger;
      }
    });
  }