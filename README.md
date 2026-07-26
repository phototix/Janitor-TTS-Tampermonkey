# Janitor-TTS-Tampermonkey

Tampermonkey userscript that adds auto Text-to-Speech (ElevenLabs) to JanitorAI chat replies.

## Features

- Auto-detects new bot replies on JanitorAI chat pages
- Speaks replies via ElevenLabs
- Voice picker (loads voices from your ElevenLabs account)
- Auto-play toggle
- Stop button
- Floating control panel UI

## Files

- `janitor-tts.user.js` - Tampermonkey userscript
- `index.html` - local helper page
- `server.js` - tiny local static server for easy install/update

## Quick start

1. Install Tampermonkey in your browser.
2. Run local server:

```bash
node server.js
```

3. Open:

```text
http://localhost:8015/janitor-tts.user.js
```

4. Install/update the script in Tampermonkey.
5. Open JanitorAI chat page (`https://janitorai.com/chats/...`).
6. Enter ElevenLabs API key in the panel and pick a voice.

## Notes

- Script uses `GM.xmlHttpRequest` to bypass JanitorAI CSP for ElevenLabs API calls.
- Audio playback uses Web Audio API to avoid `blob:` media CSP restrictions.

## Changelog

### v1.7.2

- Added draggable icon on floating panel header
- Panel can be moved by drag-and-drop
- Panel position is saved and restored with `localStorage`

### v1.7.1

- Removed Enter-key input hook to avoid chat send/input conflicts
- Kept manual save flow: key -> refresh -> voice -> save

### v1.7.0

- Added persistent settings (`localStorage`) for API key, voice, and auto-play
- Added explicit Save button workflow
- Added refresh button for loading voices

### v1.6.1

- Switched bot reply detection to DOM watcher on virtual scroller
- Added stable-text queueing before speaking
- Switched playback to Web Audio API to avoid CSP `blob:` media block
