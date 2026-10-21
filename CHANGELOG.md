# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.6.0] - 2026-10-20

### Added

- Sort albums by newest, oldest, cheapest or most expensive (selector in the bottom-right corner).

## [0.5.0] - 2026-10-18

### Added

- Album date badges. Dates are read from a few sampled album pages and interpolated for the rest.
- Age filter that hides albums older than 1, 2, 3 or 5 years.

## [0.4.0] - 2026-10-16

### Added

- Price badges: the CNY price is parsed from the album title and converted to your currency.
- Tampermonkey menu commands for the CNY rate and for toggling price badges.

## [0.3.0] - 2026-10-15

### Added

- Album title shown under the hover preview.

## [0.2.0] - 2026-10-15

### Added

- Persistent settings with a Tampermonkey menu (`localStorage` fallback in the extension build).
- `Esc` closes the hover preview.

## [0.1.2] - 2026-10-14

### Added

- `tileAspect` option for the aspect ratio of tile images.

### Fixed

- A late-loading preview image no longer reappears after the pointer has left the tile.
- Preview height is clamped to the viewport.

## [0.1.1] - 2026-10-13

### Added

- Larger album tiles and a hover preview.
