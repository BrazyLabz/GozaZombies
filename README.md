# Westvale Zombies: Pirates of the Red Moon

2.5D pixel-art zombie survival at Westvale High, starring GozaPlayz. Plays on iPhone, iPad, Android and PC.

## Put it on GitHub Pages

1. Create a new **public** repository on github.com (for example `westvale-zombies`).
2. Click **Add file → Upload files** and drag in **everything inside this folder** (`index.html`, `game.js`, `style.css`, `manifest.webmanifest`, `sw.js`, `.nojekyll`, `README.md` and the `icons` folder). Commit.
   - `.nojekyll` is a hidden file; on a Mac press **Cmd+Shift+.** in Finder to see it. The game works without it, it just makes Pages publish faster.
3. Go to **Settings → Pages**. Under *Build and deployment* pick **Deploy from a branch**, branch **main**, folder **/ (root)**, Save.
4. After about a minute the game is live at `https://YOUR-NAME.github.io/westvale-zombies/`.

## Install on iPhone / iPad

1. Open the link in **Safari**.
2. Tap **Share → Add to Home Screen → Add**.
3. Launch it from the home-screen icon: it runs full screen with no browser bars, works offline after the first load, and keeps your save game and settings.

Turn the phone sideways (landscape). Left thumb moves, right thumb aims and shoots.

## Controls on PC

WASD move, mouse aim, left click shoot, right click heavy attack, R reload, Q / Tab / scroll / 1-3 swap guns, E or F buy / interact (hold to rebuild boards), V knife, Esc pause.

## Updating

Replace `game.js`, `index.html` and `sw.js` with a newer build and commit. The offline cache is versioned, so players get the new version the next time they open the game (sometimes it takes one extra launch).
