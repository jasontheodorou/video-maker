# Video assembly

Type a short brief in plain English and get back finished, on-brand videos. Each video comes with a British voiceover, captions burned in and a separate subtitle file (.srt). You get three versions, all 1080p:

- landscape 16:9
- portrait 9:16
- square 1:1

The engine reads the facts in the brief and picks a short, medium or long video. It runs on your own Mac. Scripts and brand files stay on the machine.

## How it works

1. **The brief interpreter** reads the brief. A model call pulls out the facts, the engine picks the length, and a second model call writes a small JSON spec: the title, the script and which scene type to use for each part.
2. **The engine** owns everything about the look: every colour, font, size, duration, curve, transition and crop. It reads these from the brand pack and `config/engine.json`. The model never writes HTML, CSS or animation code.
3. **The pipeline** records the voice (Kokoro), times the captions word by word (whisper), checks that every piece of text fits with the real fonts, makes a contact sheet and renders the videos (HyperFrames).

There are 10 scene types: Title, Statement, Points, Stat, Quote, Full photo, Photo with text, Icon row, Video clip and End card. This list is closed. A new scene type is an engine change, never something made up during a job.

## Start it

You need a Mac (or Linux) with Node 18 or later, FFmpeg and FFprobe, Chrome, Python 3 with `kokoro-onnx` and `soundfile`, and `whisper-cli` from whisper-cpp. `npm run doctor` tells you what is missing.

```
npm install
npm run doctor -- --fix     # checks tools and downloads the voice and caption models the first time
npm run app
```

Then open http://localhost:3006 in your browser. `npm run app` builds the pages first (a few seconds). To start the server without building, use `npm run app:serve`. The first version of the pages is still at http://localhost:3006/classic for comparison.

The brief interpreter uses the Claude Code command line (`claude`) on this Mac by default. If `ANTHROPIC_API_KEY` is set, it uses the Anthropic API instead.

Keep HyperFrames at exactly 0.9.8. Do not run `npm audit fix --force`.

## Make a video

1. Open http://localhost:3006.
2. Type the brief. Say what is happening, when, who it is for and what people should do. Include dates, prices, phone numbers and web addresses exactly as they should appear. You can ask for a length, for example "under 20 seconds" or "about a minute".
3. Pick the brand, the voice and the formats.
4. Add photos or video clips if you have them, with a short description of each.
5. Press **Make video**.

The page shows each step as it happens. A short video usually takes 2 to 4 minutes on an M1 Pro. When it is ready you see:

- the length chosen and why
- any "things to check", for example a detail the brief did not give
- a contact sheet with a still of every scene in every format
- the three videos, with MP4 and subtitle downloads

To change the words, edit the script on the results page and press save. The video is made again without reading the brief again.

If a brief is too vague, for example "a video about the new recycling stuff", the app stops before writing a script and asks what is changing, when, and what people should do.

You can also work from the command line: `npm run interpret -- jobs/<name>` reads `jobs/<name>/brief.md` and writes `spec.json`, then `npm run make -- jobs/<name>` makes the videos. `skill/SKILL.md` lets Claude Code do the same.

## Add or change a brand

Every video names the brand it uses. A brand is a folder, `brands/<id>/`, holding `brand.json` plus its fonts, logos and icons. Scenes only ever read brand tokens, so a new brand changes the look with no code changes.

The sample brand is **Northvale Council** (`brands/demo/`). It is fictional. Its guidelines are in `brands/demo/guidelines.md`.

### In the web app

Open http://localhost:3006/brands. You can:

- create a brand (it starts from a copy of an existing one), duplicate one or delete one (the demo brand cannot be deleted)
- set the name and colours, with a live AAA contrast check (7 to 1) for every text pair. A failing pair shows its ratio, a plain message and a passing colour you can use with one click
- upload font files, or search for an open font and download it
- upload a logo for light backgrounds, dark backgrounds or both (SVG preferred, PNG accepted)
- choose the default icon weight, and upload your own icons and graphics. An icon with the same name as a library icon replaces it
- choose the voice and its speed, and play a sample
- write tone of voice notes, guidelines and do and don't rules. The brief interpreter reads these
- upload a guidelines PDF, Markdown or text file. The app suggests colours, fonts, tone and rules from it. Nothing is used until you tick it

The preview shows Title, Statement and End card in all three formats and updates as you edit. Uploads save straight away. Other changes save when you press **Save brand**.

Settings you have not confirmed yet are marked provisional. They show as warnings until you confirm them.

### From a folder of files

If a client sends a folder of fonts, logos, a colour list and a guidelines PDF:

```
npm run brand-import -- <folder> --name="Client name" --preview
```

This creates `brands/<id>/`, reads what it can, picks colours that pass AAA, makes preview stills and lists the gaps. Other options: `--id=`, `--from=demo`, `--overwrite`, `--offline` and `--json`. Check the result on the Brands page.

## Icons

The engine uses Phosphor Icons 2.1.1 (MIT licence): 1,512 icons in six weights, in `engine/icons/`. Icons are picked by meaning, for example "bin collection" or "council tax", and take their colours from the brand.

To add your own icons:

- upload them on the Brands page, or
- put SVG files in `brands/<id>/icons/`, named in lower case with hyphens, for example `bin.svg`.

A one-colour icon is changed so that it takes the brand colours. An icon named like a library icon replaces it for that brand only. To help the search find library icons for a topic, add meanings to `engine/icons/synonyms.ts`.

`npm run icons-sheet` makes a sheet of 60 common icons in a brand's colours so you can check them.

## Where settings live

| Setting | Where |
| --- | --- |
| Target seconds for short, medium and long | `config/engine.json`, `sizes` |
| Rules for picking the size | `config/engine.json`, `sizeRules` and `channelCaps` |
| Default voice and speaking speed for the budget | `config/engine.json`, `voice` |
| Voice for one brand | the Brands page, or `voice` in `brands/<id>/brand.json` |
| Frame rate (60, chosen by measurement) | `config/engine.json`, `fps` |
| Reading time, caption rules, timings | `config/engine.json`, `reading`, `captions`, `timing` |
| Safe areas and caption bands for each format | `config/engine.json`, `formats` |
| Interpreter model and backend | environment variables `VIDEO_INTERPRETER_BACKEND`, `VIDEO_INTERPRETER_MODEL`, `VIDEO_INTERPRETER_CLAUDE`, `VIDEO_INTERPRETER_TIMEOUT` |
| Where jobs, brands and caches are kept | environment variable `DATA_DIR` (default: this folder) |
| Password for a hosted copy | environment variable `APP_PASSWORD` (no sign-in page when it is not set) |

The default lengths are short 15 to 25 seconds, medium 30 to 50 seconds and long 60 to 90 seconds.

`docs/CONTRACTS.md` describes every part of the engine in detail.

## Put it online

On a Linux machine that stays on, one line sets up everything: Docker, the app, a password and a private HTTPS link through Tailscale Funnel.

```
curl -fsSL https://raw.githubusercontent.com/jasontheodorou/video-maker/main/install.sh | bash
```

`home-server/README.md` covers the day-to-day commands. `docs/DEPLOY.md` explains how to run the app on a free Oracle Cloud server with Docker (`Dockerfile`, `docker-compose.yml`, `Caddyfile`), behind a password and HTTPS.

## Checks

- `npm run selftest`: fast rule checks.
- `npm run typecheck`: checks the TypeScript.
- `npm run icons-check`: icon library, search and brand module checks.
- `npm run verify -- jobs/<name> --determinism`: checks finished videos (size, frame rate, frame count, audio) and that two renders give the same frames.
- `npx tsx scripts/motion-check.ts jobs/<name> --lossless`: checks motion is smooth frame by frame.
- `npm run e2e`: drives the web app in a browser from brief to finished videos.

`demo-output/` holds three sample videos (short, medium and long) made through the web app.

## Known limits

- **Sample brand only.** No real client assets have been loaded yet. Northvale Council is fictional.
- **Voice.** Kokoro's British voices are clear but sound synthetic in places. There are three British voices: Emma (the default), Isabella and George.
- **Speed.** Videos are made one at a time. A busy machine, or a Mac that goes to sleep, makes jobs much slower. Keep the Mac awake while videos are being made.
- **Length asked for.** If a brief asks for more seconds than its content fills, the video comes out shorter rather than padded, and the results page says why. Add more detail to the brief for a longer video.
- **Scripts.** The interpreter sometimes adds a filler line or a small claim that the brief did not make. Read the script before publishing.
- **Text fit.** Character counts are a guide. The engine also measures the real text early and names the part to shorten. It never shrinks text to fit.
- **Captions** may now and then split a phrase in a slightly odd place. They stay within 6 words and 2 lines.
- **Video clips** at 24, 25 or 50 frames a second play up to 20% faster, and clips are always silent. This is fine for background footage, not for people talking.
- **PNG logos** are accepted but only SVG logos stay sharp.
- **Identical frames** are guaranteed on this machine. For identical pixels across different machines, render with `--software-gpu`, which is slower.
- **Open font search** needs the internet. Once a font is downloaded, rendering works offline.
- **One app at a time.** The job queue lives in one process. If the app restarts mid-job, that job shows a Try again button.
