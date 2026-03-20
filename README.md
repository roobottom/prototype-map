# prototype-map

Screenshot capture and journey map generator for browser-based prototypes.

The tool has four parts:

1. Register a project in `projects/<project-slug>/`
2. Record a journey with the Chrome extension
3. Refine the generated `config.yaml`
4. Replay that journey to capture screenshots and generate a map

## Install

```bash
npm install
npx playwright install chromium
```

## Project layout

Recorded data lives inside this repo:

```text
projects/
  <project-slug>/
    <journey-slug>/
      config.yaml
      screenshots/
        manifest.json
        01-start.png
        02-check-details.png
      maps/
        journey-map.html
        journey-map.png
        journey-map.svg
```

Each journey has its own config and output directory.

## Quick start

### 1. Install the browser extension

1. Open Chrome and go to `chrome://extensions`
2. Enable Developer mode
3. Click Load unpacked
4. Select the [`extension/`](/Users/roobottom/git/prototype-map/extension) folder

The extension only injects into `http://localhost/*` pages by default.

### 2. Create a project

```bash
npx prototype-map init
```

This creates `projects/<project-slug>/`.

### 3. Start the local server

```bash
npm run serve
```

That starts:

- the extension API at `http://localhost:4444`
- the dashboard at `http://localhost:4444/dashboard/`

### 4. Record a journey

1. Open your prototype in Chrome
2. Open the Prototype Map extension popup
3. Select a project
4. Enter a journey name
5. Click Start recording
6. Click through the prototype
7. Click Stop recording

The server writes the result to:

```text
projects/<project-slug>/<journey-slug>/config.yaml
```

Recording the same journey name again replaces that journey's config.

### 5. Refine the generated config

The recorder captures pages, transitions, query-param states, and form submissions, but the generated YAML is intended to be edited.

Example:

```yaml
name: "Apply for a juggling licence"
baseUrl: "http://localhost:3000"
viewport: { width: 1280, height: 900 }

pages:
  - id: start
    path: /
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

steps:
  - { from: start, to: name, label: "Start now" }
  - { from: name, to: address }
  - { from: address, to: check }
  - { from: check, to: done, label: "Submit" }
```

`pages` define what can be visited. `steps` define the ordered transitions used for the map and journey replay.

### 6. Capture screenshots

```bash
npm run capture -- --project my-project --journey happy-path
```

Screenshots are written to:

```text
projects/my-project/happy-path/screenshots/
```

Each image gets a step prefix for stable ordering, for example `01-start.png` or `03-name--error.png`.

### 7. Generate the map

```bash
npm run map -- --project my-project --journey happy-path --format all --embed-screenshots
```

Map output is written to:

```text
projects/my-project/happy-path/maps/
```

### Or run both

```bash
npm run run -- --project my-project --journey happy-path --format all --embed-screenshots
```

## Commands

| Command | What it does |
|---|---|
| `init` | Create a project directory under `projects/` |
| `serve` | Start the local server and dashboard |
| `capture` | Replay a journey and save screenshots |
| `map` | Build HTML/PNG/SVG map output |
| `run` | Run `capture` then `map` |
| `deploy` | Copy a journey's screenshots folder to another location |

## CLI usage

### `capture`

```bash
npx prototype-map capture --project <project-slug> --journey <journey-slug>
```

### `map`

```bash
npx prototype-map map --project <project-slug> --journey <journey-slug> [--format html|png|svg|all] [--embed-screenshots]
```

### `run`

```bash
npx prototype-map run --project <project-slug> --journey <journey-slug> [--format html|png|svg|all] [--embed-screenshots]
```

### `deploy`

```bash
npx prototype-map deploy --project <project-slug> --journey <journey-slug> [--target <path>]
```

If `--target` is omitted, the tool uses:

```yaml
deploy:
  target: ../somewhere/screens
```

from that journey's `config.yaml`.

## Page states

States let you capture the same page in different conditions.

### Query parameters

```yaml
states:
  - id: error
    label: "With error"
    params: { error: true }
```

### Cookies

```yaml
states:
  - id: prefilled
    label: "With previous answer"
    cookies: { name: "Jo Smith" }
```

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

Supported actions:

- text input: `{ field: "#name", value: "Jo Smith" }`
- checkbox: `{ field: "#agree", action: check }`
- uncheck: `{ field: "#agree", action: uncheck }`
- select: `{ field: "#country", value: "Wales", action: select }`
- click: `{ field: "button:has-text(\"Add another\")", action: click }`

### Setup scripts

For complex setup, run Playwright code directly:

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

## Manifest format

Each capture writes `screenshots/manifest.json`:

```json
[
  {
    "step": "01-start",
    "file": "01-start.png",
    "title": "Start page",
    "url": "http://localhost:3000/",
    "capturedAt": "2026-03-19T10:30:00.000Z",
    "note": ""
  }
]
```

## Notes

- The recorder captures the basics, not a perfect final config.
- The dashboard can trigger capture and deploy, but map generation is currently CLI-driven.
- The map generator requires `steps`; it will fail if a config only defines pages.
