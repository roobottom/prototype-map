# prototype-map

Screenshot capture and journey map generator for prototypes.

Two things eat up time when building prototypes: taking screenshots of pages (especially different states like error screens) and creating journey maps that show how screens connect. This tool automates both.

## How it works

```
1. RECORD         2. EDIT CONFIG       3. CAPTURE + MAP
   Click through  →  Refine the YAML  →  Screenshots + journey map
   your prototype    that was generated   generated automatically
```

You record a journey once by clicking through your prototype. The tool generates a YAML config file. You tweak it — add labels, define page states, draw journey connections. Then one command captures every screenshot and builds an interactive journey map.

## Install

```bash
npm install
npx playwright install chromium
```

## Quick start

### 1. Install the browser extension

The extension runs in your normal Chrome, captures navigation, form submissions, and click interactions, then writes the config file.

1. Open Chrome and go to `chrome://extensions`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked" and select the `extension/` folder in this project

### 2. Record a journey

1. Start the recording server:
   ```bash
   npm run serve
   ```
2. Open your prototype in Chrome (e.g. `http://localhost:3000`)
3. Click the Prototype Map extension icon in the toolbar
4. Give your recording a name (e.g. "Round 1") and optional description
5. Check the port matches (default: 4444) and click **Start recording**
6. Click through your prototype — every page navigation, form submission, and click interaction is captured
7. When done, click **Stop recording** in the extension popup
8. The server writes `prototype-map.yaml` and logs a summary

To add a second journey to an existing config, tick **Append to existing config** before starting. This keeps your existing pages and adds a new journey.

### 3. Edit the config

Open `prototype-map.yaml`. The recorder captures the basics — pages visited, form data, the order, link text — but you'll want to refine it. Add labels, define page states, and describe the journeys.

Here's what a config looks like:

```yaml
name: "Apply for a juggling licence"
baseUrl: "http://localhost:3000"
viewport: { width: 1280, height: 900 }
round: 1

pages:
  - id: start
    path: /start
    label: "Start page"

  - id: name
    path: /name
    label: "What is your name?"
    states:
      - id: blank
        label: "Empty form"
      - id: error
        label: "Validation error"
        formData:
          - { field: "#name", value: "" }
        submit: true
      - id: prefilled
        label: "With previous answer"
        cookies: { name: "Jo Smith" }

  - id: address
    path: /address
    label: "What is your address?"

  - id: check
    path: /check-answers
    label: "Check your answers"

  - id: done
    path: /confirmation
    label: "Application submitted"

journeys:
  - id: happy-path
    label: "Happy path"
    steps:
      - { from: start, to: name, label: "Start now" }
      - { from: name, to: address }
      - { from: address, to: check }
      - { from: check, to: done, label: "Submit" }
```

Pages and journeys are separate concerns. Pages define what exists. Journeys define how they connect.

### 4. Capture screenshots

```bash
npm run capture
```

Screenshots land in `prototype-map-output/screenshots/round-1/`. Each page gets a PNG with a step number prefix for easy sorting: `01-start.png`, `02-name--blank.png`, `03-name--error.png`.

### 5. Generate a journey map

```bash
npx prototype-map map --format all
```

This produces an interactive HTML file (with pan, zoom, and a lightbox for full screenshots) plus a static PNG and SVG for pasting into blog posts or slide decks. Output goes to `prototype-map-output/maps/`.

### Or do both at once

```bash
npm run run -- --format all --embed-screenshots
```

## Commands

| Command | What it does |
|---|---|
| `serve` | Start the recording server for the browser extension |
| `capture` | Take screenshots from config |
| `map` | Generate journey map |
| `run` | Capture + map in one step |

### Common options

```
-c, --config <path>       Config file (default: prototype-map.yaml)
-o, --out <dir>           Output directory (default: prototype-map-output)
--round <n>               Override the round number
--page <id>               Capture a specific page only
--journey <id>            Capture/map a specific journey only
--format <html|png|svg|all>  Map output format (default: html)
--embed-screenshots       Show screenshot thumbnails inside map nodes
```

## Page states

States let you capture the same page in different conditions. There are several ways to trigger a state:

### Query parameters

```yaml
states:
  - id: error
    label: "With error"
    params: { error: true }
```

Visits `/name?error=true`.

### Cookies

```yaml
states:
  - id: prefilled
    label: "With previous answer"
    cookies: { name: "Jo Smith" }
```

Sets cookies before visiting the page. Useful for prototypes that store answers in session.

### Form data

```yaml
states:
  - id: validation-error
    label: "Submit with empty name"
    formData:
      - { field: "#name", value: "" }
      - { field: "#email", value: "bad" }
      - { field: "#agree", action: check }
      - { field: "#country", value: "Wales", action: select }
      - { field: "button:has-text(\"Add another\")", action: click }
    submit: true
```

Fills in form fields and optionally submits. Supported actions:

- **Text fields**: `{ field: "#name", value: "Jo Smith" }`
- **Checkboxes**: `{ field: "#agree", action: check }` or `action: uncheck`
- **Dropdowns**: `{ field: "#country", value: "Wales", action: select }`
- **Click**: `{ field: "button:has-text(\"Add another\")", action: click }` — clicks an element (e.g. to reveal hidden fields)
- **Submit**: `submit: true` clicks the submit button. Use `submit: ".my-button"` for a specific button.

The browser extension captures all of these automatically during recording, including clicks that trigger DOM changes (like "Add another" buttons that reveal extra form fields).

### Setup scripts

For anything the above can't handle, write Playwright code directly:

```yaml
states:
  - id: filled
    label: "All answers completed"
    setup: |
      await page.goto(baseUrl + '/name');
      await page.fill('#name', 'Jo Smith');
      await page.click('button[type=submit]');
      await page.fill('#address', '10 Downing St');
      await page.click('button[type=submit]');
```

## Rounds

Bump the `round` number in your config each design iteration. Screenshots are organised by round:

```
prototype-map-output/
  screenshots/
    round-1/
    round-2/
    round-3/
```

Or override it on the command line:

```bash
npx prototype-map capture --round 3
```

This makes it easy to compare screenshots across design rounds for blog posts or stakeholder reviews.

## Output

```
prototype-map-output/
├── screenshots/
│   ├── round-1/
│   │   ├── 01-start.png
│   │   ├── 02-name--blank.png
│   │   ├── 03-name--error.png
│   │   ├── 04-name--prefilled.png
│   │   ├── 05-address.png
│   │   ├── 06-check.png
│   │   └── 07-done.png
│   └── round-2/
│       └── ...
└── maps/
    ├── happy-path.html      # interactive, with pan/zoom
    ├── happy-path.png       # static, for blog posts
    └── happy-path.svg       # static, for slides
```

## Works with any prototype

This tool doesn't care what your prototype is built with. It just needs a URL. GOV.UK Prototype Kit, static HTML, React, Next.js, whatever — if it runs in a browser, it works.
