# prototype-map

Screenshot capture and journey map generator for browser-based prototypes.

Recorded data lives inside your project, like this:

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
        thumbs/
          01-start.png
          02-check-details.png
```

Install:

```bash
npm install
npx playwright install chromium
```

**CLI**

The CLI is the lowest-level way to work with the project. It creates projects, captures screenshots, generates maps, and deploys screenshot output.

Available commands:

| Command | What it does |
|---|---|
| `init` | Create a project directory under `projects/` |
| `serve` | Start the local server and dashboard |
| `capture` | Replay a journey and save screenshots |
| `map` | Build HTML/PNG/SVG map output |
| `run` | Run `capture` then `map` |
| `deploy` | Copy a journey's screenshots folder to another location |

Examples:

```bash
npx prototype-map init
npx prototype-map serve
npx prototype-map capture --project my-project --journey happy-path
npx prototype-map map --project my-project --journey happy-path --format html --embed-screenshots
npx prototype-map run --project my-project --journey happy-path --format html --embed-screenshots
npx prototype-map deploy --project my-project --journey happy-path --target ../somewhere/screens
```

Notes:

- `capture` writes screenshots to `projects/<project>/<journey>/screenshots/`
- `map` writes output to `projects/<project>/<journey>/maps/`
- `map --embed-screenshots` now creates thumbnail assets in `maps/thumbs/`
- full-size screenshot viewing uses the original screenshot files, not duplicated copies in `maps/`
- if `deploy.target` is set in `config.yaml`, `deploy` can use that as the destination

Config shape:

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
      - id: error
        label: "Validation error"
        formData:
          - { field: "#name", value: "" }
        submit: true

steps:
  - { from: start, to: name, label: "Start now" }
```

`pages` define what exists. `steps` define the ordered journey used for replay and map generation.

Supported page state inputs:

- query params via `params`
- cookies via `cookies`
- form population via `formData`
- submit via `submit`
- custom Playwright setup via `setup`

**Web Interface**

The dashboard is served from:

```text
http://localhost:4444/dashboard/
```

Current behavior:

- if there is at least one project, the first project is selected by default
- selecting a project shows its journeys
- selecting a journey shows the map view for that journey
- the main action is `Make the map`, which captures screenshots and regenerates the map in one flow
- the journey detail view includes:
  - embedded map preview
  - `Open full size` link for the generated HTML map
  - `Deploy`
  - `Delete` with confirmation
- each journey can also be deleted from the journey list/sidebar with confirmation

The embedded map is generated from the same server-side map builder used by the CLI. It is not a separate client-side renderer.

Map behavior:

- the main flow is rendered left-to-right in visit order
- repeated visits can appear as separate nodes
- local detours like `A -> B -> A` are rendered as compact sub-journeys
- multi-state visits can expand into short local state sequences
- node thumbnails use generated images from `maps/thumbs/`
- clicking a node opens the original full-size screenshot

If there is no generated map yet, the journey view will prompt you to make one.

**Chrome Extension**

The Chrome extension records journeys from your running prototype.

Install it by loading the [`extension/`](/Users/roobottom/git/prototype-map/extension) folder as an unpacked extension in Chrome.

Current behavior:

- it injects into `http://localhost/*`
- it records:
  - page navigations
  - click text for transition labels
  - form submissions
  - certain DOM-mutating clicks used in form flows
- it writes the recording to:

```text
projects/<project-slug>/<journey-slug>/config.yaml
```

Label behavior for new recordings:

- page labels default to the page `<title>`
- if `<title>` is missing or empty, the extension falls back to the page `h1`
- form submission states are written using the page label rather than generic `Form submitted`

Toolbar icon states:

- normal when the server is reachable and the extension is idle
- red while recording
- grey when the local server is not reachable

Typical recording flow:

1. Start the server with `npx prototype-map serve`
2. Open your prototype in Chrome
3. Open the extension popup
4. Select a project
5. Enter a journey name
6. Start recording
7. Click through the prototype
8. Stop recording

Recording the same journey name again replaces that journey's config.
