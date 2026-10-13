# Yupoo Gallery+

A small userscript that makes browsing [Yupoo](https://yupoo.com) galleries less painful:

- **Larger album tiles**: responsive grid with higher-resolution thumbnails.
- **Hover preview**: move the cursor over an album to see its cover in full size, without opening it.

## Demo

| Before | After |
| :---: | :---: |
| ![Before: default Yupoo grid](imgs/before.png) | ![After: larger tiles](imgs/after.png) |

![Hover preview demo](imgs/demo.gif)

## Install

### As a userscript (recommended)

1. Install a userscript manager, e.g. [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open the raw script file: [`yupoo-gallery-plus.user.js`](https://raw.githubusercontent.com/mjazlowiecki/yupoo-gallery-plus/main/yupoo-gallery-plus.user.js)
   (the manager should offer to install it), or create a new script and paste the file contents.
3. Open any Yupoo gallery page and refresh.

### As a browser extension (unpacked)

1. Download or clone this repository.
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select the repository folder.

## Configuration

Edit the `CONFIG` object at the top of `yupoo-gallery-plus.user.js`:

| Option          | Default | Description                                            |
| --------------- | ------- | ------------------------------------------------------ |
| `tileMinWidth`  | `300`   | Minimum tile width in px. Higher = fewer, bigger tiles |
| `gap`           | `16`    | Gap between tiles in px                                |
| `previewMaxW`   | `560`   | Max width of the hover preview in px                   |
| `previewMaxH`   | `760`   | Max height of the hover preview in px                  |
| `hoverDelay`    | `120`   | Delay before the preview appears, in ms                |

## How it works

- The album grid is found by locating links to `/albums/` and walking up the DOM, so the script
  does not rely on Yupoo's CSS class names.
- Yupoo serves each photo in several sizes (`square`, `small`, `medium`, `big`). The script swaps the
  size in the image URL: `medium` for tiles, `big` for the preview, with a fallback to the original
  thumbnail if a size is missing.
- Hover handling uses event delegation, and a `MutationObserver` re-applies the layout when
  tiles are added dynamically.

## Limitations

- The preview shows the album **cover** only, not the other photos in the album.
- Built against the current Yupoo markup. If the site changes its HTML, selectors may need updating.
- Tested on Chromium-based browsers with Tampermonkey.

## Contributing

Issues and pull requests are welcome. If something looks broken on a particular gallery page,
please include the page URL and (if possible) the HTML of one album tile.

## Disclaimer

This project is not affiliated with or endorsed by Yupoo. It only changes how pages are displayed
in your own browser and does not collect or transmit any data.

## License

[MIT](./LICENSE)