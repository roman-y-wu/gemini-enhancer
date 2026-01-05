# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gemini Enhancer is a Chrome extension (Manifest V3) that enhances gemini.google.com with:
- **Follow-up toolbar**: Appears when selecting AI response text with actions (Ask, Explain, Examples, Copy)
- **Slash commands**: Custom prompt shortcuts triggered by typing `/` in the input box
- **Wide mode**: Expands conversation width

## Build Commands

```bash
cd extension
npm install          # Install dependencies
npm run build        # Build TypeScript to dist/, copies manifest/popup/styles
npm run watch        # Watch mode for development
```

After building, load the extension in Chrome from `extension/dist/` via chrome://extensions/ with Developer Mode enabled.

## Architecture

### File Structure

```
extension/
├── src/
│   ├── content.ts      # Main content script (injected into Gemini)
│   ├── popup.ts        # Extension popup UI logic
│   └── types/globals.d.ts  # Global TypeScript declarations
├── styles.css          # Injected styles for toolbar/autocomplete
├── popup.html          # Popup UI markup and embedded styles
├── manifest.json       # Extension manifest (Manifest V3)
└── dist/               # Build output (loaded as extension)
```

### Content Script Architecture (content.ts)

The content script uses an IIFE wrapper to prevent global scope pollution (content scripts aren't ES modules).

**Key Components:**

1. **EnhancerState class** - Centralized state management with:
   - Dot-notation path access (`state.get('features.followUpEnabled')`)
   - Event bus for state change subscriptions
   - Cleanup function registry for proper teardown

2. **EventCoordinator class** - Manages UI feature conflicts with priority system:
   - `follow-up`: priority 3 (highest)
   - `slash-commands`: priority 2
   - `auto-save`: priority 1

3. **Duplicate injection prevention** - Uses `window.__GEMINI_ENHANCER_ACTIVE__` flag to handle SPA navigation re-injections

**DOM Selector Strategy:**

The extension uses selector arrays to handle Gemini's dynamic UI:
- `AI_RESPONSE_SELECTORS` - Identifies AI response containers for text selection validation
- `INPUT_BOX_SELECTORS` - Locates the chat input (supports both textarea and contenteditable)

### Communication

- **Popup → Content Script**: `chrome.tabs.sendMessage()` with `PopupMessage` union type
- **Storage sync**: `chrome.storage.sync` for cross-device settings persistence
- **Storage change listener**: Content script reacts to `storage.onChanged` events

### Cross-Browser Compatibility

Uses `browserAPI` variable that falls back to Firefox's `browser` API if available:
```typescript
const browserAPI: typeof chrome = typeof browser !== 'undefined' ? browser : chrome;
```

## Key Implementation Details

### Text Selection Validation

The `isSelectionFromAIResponse()` function validates selections by:
1. Checking minimum length (CJK-aware: 1 char for CJK, 2 chars for others)
2. Excluding editable areas (textareas, contenteditable, inputs)
3. Matching against AI response selectors and class patterns
4. Verifying valid bounding rect exists

### Input Handling

Input text operations (`setInputText`, `getInputText`, `setCursorPosition`) handle both:
- Standard inputs: `HTMLTextAreaElement`, `HTMLInputElement`
- Rich inputs: `contenteditable` divs (uses `execCommand('insertText')` for framework compatibility)

### Styling

All injected elements use the `ge-` or `gemini-enhancer-` prefix to avoid CSS conflicts. Theme support uses CSS custom properties and `prefers-color-scheme` media queries.
