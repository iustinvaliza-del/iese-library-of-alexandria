# IESE Alexandria kit

This kit copies your own 2nd-year IESE course materials from Blackboard into one zip file per course and uploads the zips to Radu's private course library on Google Drive, until he rebuilds the library for everyone. Claude Code does the work; you only sign in to Blackboard when a browser window asks you to.

## What gets shared

- Your 2nd-year course materials (courses whose Blackboard name ends in " - TF"): case PDFs, readings, slides, spreadsheets and images. The exact file types are in `allowlist.json`. Videos and other files are not downloaded; the receipt lists them as skipped.
- Never your grades, submissions, class lists, announcements or messages.
- Case PDFs usually carry your name as a watermark, so your name travels with those files.
- Each zip also carries a small `manifest.json`: the course name, your first name, a short code made from your Blackboard user id (not the id itself), and the list of files.

Nothing else on your computer is read. You type your Blackboard password only into the Blackboard page in the browser window; the kit does not read it and saves no login. Every run starts signed out.

You can stop at any time: close the browser window or tell Claude to stop. An unfinished upload is not kept on the other side, and running the kit again continues where it stopped.

## How to use it

Paste the message you were sent into Claude Code. Claude downloads this kit, reads `CLAUDE.md` and runs it. When a browser window opens, sign in to Blackboard there. At the end Claude shows you a receipt: for each course, how many files went in, the size, what was skipped and why, and whether the upload worked.

By hand, from this folder:

1. Setup: Windows `powershell -NoProfile -ExecutionPolicy Bypass -File setup.ps1`; Mac `sh setup.sh`. This puts a private copy of Node.js in the `.node` folder here. It needs no admin rights and changes nothing else on the computer.
2. Run: Windows `.node\node.exe kit.mjs run --code <code>`; Mac `.node/bin/node kit.mjs run --code <code>`.

The steps also run one at a time: `login` (sign in and list the courses that would be shared), `collect` (download and zip), `upload`.

## Removing it afterwards

Delete this kit folder. That removes everything the kit put on your computer: the private Node.js (`.node`), the zips (`output`) and its notes (`.state.json`, `progress.json`, `receipt.txt`).

If Microsoft Edge (Windows) or Google Chrome (Mac) could not be opened, the kit downloaded its own Chromium browser. Delete that too:
- Windows: the folder `ms-playwright` in `%LOCALAPPDATA%` (paste `%LOCALAPPDATA%` into the File Explorer address bar)
- Mac: `~/Library/Caches/ms-playwright`

## For the technically curious

- Node.js `v24.22.0`, checked against the SHA-256 checksums nodejs.org publishes.
- Two packages: `playwright-core` (drives the browser) and `fflate` (writes the zips), installed with install scripts turned off.
- Tests: `npm test`. The Mac setup script has not been tested on a Mac yet.
