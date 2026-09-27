# LifeDots

The source of the LifeDots Chrome extension: <https://chromewebstore.google.com/detail/lifedots/jnilnnaeidhijpogedkmchpbiphngdkc>

LifeDots counts the minutes you actively spend on the websites you choose for one habit, and fills one dot per day when you reach your target. It pauses when you step away from the keyboard. It has no streaks, never blocks a site, and needs no account.

It knows you were on the page. It does not know whether you did the work.

## It makes no network requests. Check it yourself

This repository exists so you don't have to take that on trust.

```bash
# 1. No network APIs anywhere in the source (the only URLs are test fixtures)
grep -rnE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts" src

# 2. Build; the package check fails on remote code or a request for every site
npm ci
npm test
npm run build
```

`tools/check-package.mjs` runs on every build and in CI. It fails if the package loads a remote script or stylesheet, if `host_permissions` asks for every site at install time, or if the manifest points at a file that doesn't exist.

Permissions are listed with the reason for each in [`PERMISSIONS.md`](PERMISSIONS.md). There is no `tabs` permission. The manifest lists `*://*/*` under `optional_host_permissions`: that grants nothing by itself, it only lets the extension ask. It asks for one site at a time, when you add that site, and Chrome shows you the prompt.

Everything is stored in `chrome.storage.local` on your own machine.

## Build and load it

```bash
npm ci
npm run build   # typecheck, bundle to dist/, then check the package
```

Open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick `dist/`.

## How this repository is maintained

This is a published copy. Development happens in a private repository, and each store release is copied here as one commit named after the version it matches. So the latest commit here is the code in the Chrome Web Store.

Issues and pull requests are welcome. An accepted change is made in the private repository and arrives here with the next release, so a pull request is closed rather than merged, with credit in the release commit.

## Licence

GPL-3.0-only. You can read, build, change and redistribute LifeDots, and anything you distribute that is based on it must be released under the same licence with its source. Full text in [`LICENSE`](LICENSE).
