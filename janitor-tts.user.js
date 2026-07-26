// ==UserScript==
// @name         JanitorAI + ElevenLabs TTS
// @namespace    http://tampermonkey.net/
// @version      1.6.1
// @description  Auto-play bot responses via ElevenLabs TTS on JanitorAI
// @author       you
// @match        https://janitorai.com/chats/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=janitorai.com
// @homepageURL  https://github.com/phototix/Janitor-TTS-Tampermonkey
// @supportURL   https://github.com/phototix/Janitor-TTS-Tampermonkey/issues
// @updateURL    https://raw.githubusercontent.com/phototix/Janitor-TTS-Tampermonkey/main/janitor-tts.user.js
// @downloadURL  https://raw.githubusercontent.com/phototix/Janitor-TTS-Tampermonkey/main/janitor-tts.user.js
// @run-at       document-end
// @grant        GM.xmlHttpRequest
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    ELEVENLABS_API_KEY: '',
    TTS_VOICE_ID: '',
    TTS_MODEL_ID: 'eleven_multilingual_v2',
    AUTO_PLAY: true,
  };
  let ttsAudio = null;
  let audioCtx = null;
  let currentSource = null;
  let lastSeenHash = '';
  let pendingText = '';
  let pendingTimer = null;

  // ---- GM.xmlHttpRequest wrappers ----
  function gmRequest(method, url, headers, body, responseType) {
    return new Promise((resolve, reject) => {
      GM.xmlHttpRequest({
        method, url, headers, data: body, responseType: responseType || '',
        onload: (r) => resolve(r),
        onerror: (e) => reject(e),
        ontimeout: () => reject(new Error('Timeout')),
      });
    });
  }

  async function fetchVoices() {
    if (!CONFIG.ELEVENLABS_API_KEY) return [];
    try {
      const r = await gmRequest('GET', 'https://api.elevenlabs.io/v1/voices', {
        'xi-api-key': CONFIG.ELEVENLABS_API_KEY,
      });
      return JSON.parse(r.responseText).voices || [];
    } catch { return []; }
  }

  async function speak(text) {
    stopTTS();
    if (!CONFIG.ELEVENLABS_API_KEY || !CONFIG.TTS_VOICE_ID || !text.trim()) return;
    setStatus('speaking', '🔊 Speaking...');
    try {
      const r = await gmRequest('POST',
        `https://api.elevenlabs.io/v1/text-to-speech/${CONFIG.TTS_VOICE_ID}`,
        { 'Content-Type': 'application/json', 'xi-api-key': CONFIG.ELEVENLABS_API_KEY },
        JSON.stringify({
          text,
          model_id: CONFIG.TTS_MODEL_ID,
          voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
        }),
        'arraybuffer'
      );
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const arrayBuffer = r.response;
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      currentSource = audioCtx.createBufferSource();
      currentSource.buffer = audioBuffer;
      currentSource.connect(audioCtx.destination);
      currentSource.onended = () => {
        currentSource = null;
        setStatus('idle', '🔇 Idle');
      };
      currentSource.start(0);
    } catch (err) {
      console.error('TTS error:', err);
      setStatus('idle', '🔇 Error');
    }
  }

  function stopTTS() {
    if (ttsAudio) { ttsAudio.pause(); ttsAudio = null; }
    if (currentSource) {
      try { currentSource.stop(0); } catch (e) {}
      currentSource.disconnect();
      currentSource = null;
    }
    setStatus('idle', '🔇 Idle');
  }

  function setStatus(cls, text) {
    const el = document.getElementById('jtts-status');
    if (el) { el.className = 'val ' + cls; el.textContent = text; }
  }

  // ---- Bot message detection: look for _nameIcon (only on bot msgs) ----
  function findNewBotMessage(root) {
    // Bot messages always have a character name icon element
    const icon = root.querySelector && root.querySelector('[class*="_nameIcon_"]');
    if (!icon) return null;

    // Walk up to find the message container
    let el = icon.closest('[class*="_messageContent_"]') ||
             icon.closest('[class*="_messageBody_"]');
    if (!el) {
      // Try finding the wrapper
      el = icon.closest('[class*="_messageDisplayWrapper_"]');
      if (el) el = el.querySelector('[class*="_messageContent_"]') || el;
    }

    return el || root;
  }

  function getMsgText(msgEl) {
    const pars = msgEl.querySelectorAll('p[node]');
    if (pars.length > 0) {
      return Array.from(pars).map(p => p.textContent.trim()).filter(Boolean).join('\n');
    }
    const body = msgEl.querySelector('[class*="_messageBody_"]');
    return (body || msgEl).textContent.trim();
  }

  function toHash(text) {
    return text.slice(0, 120);
  }

  function queueSpeakWhenStable(text) {
    pendingText = text;
    if (pendingTimer) {
      clearTimeout(pendingTimer);
    }
    pendingTimer = setTimeout(() => {
      const finalText = pendingText;
      pendingText = '';
      pendingTimer = null;
      if (finalText && CONFIG.AUTO_PLAY) {
        setStatus('speaking', '🔊 Queued...');
        speak(finalText);
      }
    }, 1400);
  }

  function getLatestBotMessage(scroller) {
    const icons = Array.from(scroller.querySelectorAll('[class*="_nameIcon_"]'));
    if (icons.length === 0) return null;

    let best = null;
    for (const icon of icons) {
      const msgEl = icon.closest('[class*="_messageContent_"]') || icon.closest('[class*="_messageBody_"]');
      if (!msgEl) continue;
      const indexEl = icon.closest('[data-index]');
      const idx = indexEl ? Number(indexEl.getAttribute('data-index')) : -1;
      if (!best || idx > best.idx) {
        best = { msgEl, idx };
      } else if (best && idx === best.idx) {
        // if same index, keep latest in DOM order
        best = { msgEl, idx };
      }
    }
    return best ? best.msgEl : null;
  }

  // ---- Poll latest bot message on virtual scroller ----
  function startWatcher() {
    const scroller = document.querySelector('[class*="_scroller_"]');
    if (!scroller) {
      setTimeout(startWatcher, 1000);
      return;
    }

    console.log('[JanitorTTS] Watcher started on scroller');

    // Seed with current latest bot message so we don't replay history
    const initial = getLatestBotMessage(scroller);
    if (initial) {
      const t = getMsgText(initial);
      if (t) lastSeenHash = toHash(t);
    }
    console.log('[JanitorTTS] Seeded latest hash');

    setInterval(() => {
      const latest = getLatestBotMessage(scroller);
      if (!latest || !CONFIG.AUTO_PLAY) return;
      const text = getMsgText(latest);
      if (!text || text.length < 3) return;

      const hash = toHash(text);
      if (hash === lastSeenHash) return;

      lastSeenHash = hash;
      console.log('[JanitorTTS] New bot msg:', text.slice(0, 80));
      queueSpeakWhenStable(text);
    }, 900);
  }

  // ---- UI ----
  function initUI() {
    const style = document.createElement('style');
    style.textContent = `
      #jtts-panel {
        position: fixed; bottom: 80px; right: 16px; z-index: 9999;
        background: #1a1a1a; border: 1px solid #333; border-radius: 12px;
        padding: 12px; width: 280px;
        font: 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: #e0e0e0; box-shadow: 0 4px 20px rgba(0,0,0,0.5); user-select: none;
      }
      #jtts-panel .hdr { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; font-weight:600; color:#c2b3ff; }
      #jtts-panel .row { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
      #jtts-panel .row label { flex-shrink:0; min-width:36px; color:#93959c; font-size:12px; }
      #jtts-panel input, #jtts-panel select { flex:1; background:#2a2a2a; color:#e0e0e0; border:1px solid #3a3a3a; padding:4px 8px; border-radius:6px; font-size:12px; }
      #jtts-panel input:focus, #jtts-panel select:focus { border-color:#6b5b9a; outline:none; }
      #jtts-panel .st { display:flex; align-items:center; justify-content:space-between; margin-top:4px; padding-top:6px; border-top:1px solid #2a2a2a; }
      #jtts-panel .st .lbl { font-size:12px; color:#93959c; }
      #jtts-panel .st .val.speaking { color:#4ade80; }
      #jtts-panel .st .val.idle { color:#93959c; }
      #jtts-panel .btn { background:#4a3a7a; color:#fff; border:none; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer; }
      #jtts-panel .btn:hover { background:#5b5b9a; }
      .tts-cb input { accent-color:#6b5b9a; }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'jtts-panel';
    panel.innerHTML = `
      <div class="hdr"><span>🎤 TTS</span><button class="btn" id="jtts-min">−</button></div>
      <div id="jtts-body">
        <div class="row"><label>Key</label><input type="password" id="jtts-key" placeholder="ElevenLabs API key"></div>
        <div class="row"><label>Voice</label><select id="jtts-voice"><option value="">Enter key first</option></select></div>
        <div class="row tts-cb"><label>Auto</label><input type="checkbox" id="jtts-auto" checked><label style="min-width:auto">Auto-play</label></div>
        <div class="st"><span class="lbl">Status:</span><span class="val idle" id="jtts-status">🔇 Idle</span><button class="btn" id="jtts-stop">⏹ Stop</button></div>
      </div>`;
    document.body.appendChild(panel);

    let minimized = false;
    document.getElementById('jtts-min').onclick = () => {
      minimized = !minimized;
      document.getElementById('jtts-body').style.display = minimized ? 'none' : 'block';
      document.getElementById('jtts-min').textContent = minimized ? '+' : '−';
    };
    document.getElementById('jtts-stop').onclick = stopTTS;
    document.getElementById('jtts-auto').onchange = function () { CONFIG.AUTO_PLAY = this.checked; };

    const keyIn = document.getElementById('jtts-key');
    const voiceSel = document.getElementById('jtts-voice');

    keyIn.onchange = async function () {
      CONFIG.ELEVENLABS_API_KEY = this.value;
      voiceSel.innerHTML = '<option value="">Loading...</option>';
      const voices = await fetchVoices();
      if (voices.length === 0) {
        voiceSel.innerHTML = '<option value="">No voices found</option>';
        return;
      }
      voiceSel.innerHTML = '<option value="">Select a voice...</option>';
      for (const v of voices) {
        const opt = document.createElement('option');
        opt.value = v.voice_id;
        opt.textContent = v.name + (v.labels?.accent ? ` (${v.labels.accent})` : '');
        voiceSel.appendChild(opt);
      }
    };
    voiceSel.onchange = function () { CONFIG.TTS_VOICE_ID = this.value; };

    // Start watcher after page settles
    setTimeout(startWatcher, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
