<h1 align="center">selection-toolbar</h1>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-6E56CF?style=for-the-badge" alt="Version 1.0.0">
  <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="MIT License">
</p>

`selection-toolbar` is a compact selection toolbar for Obsidian. When you select text in the editor, it shows a Notion-style floating toolbar with quick formatting, color, list, and comment actions.

The plugin keeps notes readable and lightweight. Standard Markdown actions write Markdown, while visual annotations such as custom colors, underline, and comments are stored in plugin data instead of being written into the note body as HTML or hidden syntax.

## Features

- Compact two-row toolbar that appears when text is selected.
- Bulleted list toggle.
- Text color and background color picker with a Notion-style palette.
- Bold, italic, underline, highlight, and strikethrough controls.
- Link insertion and removal helper.
- Inline code and inline math helpers.
- Comment annotations for selected text.
- More menu with Copy, Paste, and Cut.
- Dynamic positioning so the toolbar stays inside the visible editor area.

## Toolbar Layout

```text
List  Text color  Bold  Italic  Underline  Highlight
Link  Strike      Code  Math    Comment    More
```

The More menu contains:

```text
Copy
Paste
Cut
```

## Comments

Comments are stored as plugin-local annotations and attached to selected text ranges.

Current comment behavior:

- Commented text is highlighted and underlined.
- After creating or revealing a comment, the comment card appears near the commented text.
- The comment card automatically hides after a short delay.
- Clicking highlighted commented text shows the comment card again.
- Selecting text that already has a comment and pressing the comment button opens the existing comment for editing instead of creating a duplicate.
- Pressing the `X` button on a comment card deletes that comment.

## Stored Data

The following annotations are stored in the plugin data file:

- Text colors
- Background colors
- Underline ranges
- Comment ranges and comment text

These annotations are not written into Markdown. If the plugin is disabled or the note is opened outside Obsidian, plugin-local annotations will not be visible.

Markdown-native actions such as bold, italic, strikethrough, links, inline code, inline math, and lists still modify the Markdown text directly.

## Reading Mode

Reading mode applies available visual annotations where possible:

- Text colors
- Background colors
- Underline ranges
- Comment highlight marks

Interactive comment cards and comment editing are available in the editor.

## Limitations

- Desktop only.
- The toolbar is suppressed in embedded or fragment editors such as Live Preview table cell editors.
- Plugin-local annotations depend on this plugin being enabled.
- Comment cards are editor interactions; Reading mode only renders the comment highlight mark.

## Installation

### BRAT

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat).
2. Open the command palette and run `BRAT: Add a beta plugin for testing`.
3. Enter this repository URL:

```text
https://github.com/QuinYim/selection-toolbar
```

4. Enable `selection-toolbar` in Obsidian's Community Plugins settings.

### Manual Install

1. Download the latest release from:

```text
https://github.com/QuinYim/selection-toolbar/releases
```

2. Extract the release files into:

```text
<your-vault>/.obsidian/plugins/selection-toolbar/
```

3. Make sure the folder contains:

```text
main.js
manifest.json
styles.css
```

4. Reload Obsidian and enable `selection-toolbar` in Community Plugins.

## Development

Install dependencies:

```bash
npm install
```

Build the plugin:

```bash
npm run build
```

The build output is written to:

```text
build/
```

Deploy to a local test vault:

```bash
OBSIDIAN_VAULT_PLUGINS_DIR="<your-vault>/.obsidian/plugins" npm run deploy
```

## Official Release Checklist

Before submitting to the official Obsidian community plugin directory:

- Keep `manifest.json` `id` as `selection-toolbar`.
- Keep `manifest.json` `version` in `x.y.z` format, such as `1.0.0`.
- Create a GitHub release whose tag matches `manifest.json` `version`.
- Attach `main.js`, `manifest.json`, and `styles.css` from the production build to the release.
- Submit a pull request to `obsidianmd/obsidian-releases` that adds this plugin to `community-plugins.json`.

Suggested `community-plugins.json` entry:

```json
{
  "id": "selection-toolbar",
  "name": "selection-toolbar",
  "author": "QuinYim",
  "description": "A compact selection toolbar for formatting, colors, and comments in Obsidian.",
  "repo": "QuinYim/selection-toolbar"
}
```

## Author

Created and maintained by [QuinYim](https://github.com/QuinYim).

## Credits

Originally forked from [Quorafind/Obsidian-Mini-Toolbar](https://github.com/Quorafind/Obsidian-Mini-Toolbar), with additional work inspired by later mini-toolbar implementations.

## License

MIT
