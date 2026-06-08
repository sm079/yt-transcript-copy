// Adds a "Copy transcript" button to the action row under YouTube videos.
// Transcript comes from YouTube's own caption tracks (no speech-to-text),
// falling back to scraping the built-in transcript panel.

const BTN_ID = 'ytc-copy-btn';
const LABEL = 'Copy transcript';

function videoId() {
  return new URLSearchParams(location.search).get('v');
}

const PLAYER_CLIENT = { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30 };

function pickTrack(tracks) {
  const lang = (document.documentElement.lang || 'en').slice(0, 2);
  const manual = tracks.filter((t) => t.kind !== 'asr');
  return (
    manual.find((t) => t.languageCode.startsWith(lang)) ||
    tracks.find((t) => t.languageCode.startsWith(lang)) ||
    manual[0] ||
    tracks[0]
  );
}

// Web caption URLs now require a proof-of-origin token, but the ANDROID
// player client still hands out caption URLs that work without one.
async function fromCaptions(id, progress) {
  const res = await fetch('/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: { client: { ...PLAYER_CLIENT, hl: 'en' } }, videoId: id }),
  });
  const tracks = (await res.json())?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) throw new Error('No caption tracks');
  progress(0.5);
  const url = new URL(pickTrack(tracks).baseUrl);
  url.searchParams.set('fmt', 'json3');
  const { events = [] } = await (await fetch(url, { credentials: 'omit' })).json();
  const lines = events
    .map((e) => (e.segs || []).map((s) => s.utf8).join('').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!lines.length) throw new Error('Empty transcript');
  return lines.join('\n');
}

// Fallback: open YouTube's transcript panel and read its text.
async function fromPanel() {
  const read = () =>
    [...document.querySelectorAll('ytd-transcript-segment-renderer .segment-text')]
      .map((e) => e.textContent.trim())
      .filter(Boolean);
  if (!read().length) {
    document.querySelector('ytd-video-description-transcript-section-renderer button')?.click();
    for (let t = 0; t < 50 && !read().length; t++) await new Promise((r) => setTimeout(r, 100));
  }
  const lines = read();
  if (!lines.length) throw new Error('No transcript available');
  return lines.join('\n');
}

const SVG_NS = 'http://www.w3.org/2000/svg';
// Filled outline icons, same 2px weight as YouTube's own icon set.
const ICONS = {
  copy: 'M15 6H5a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V8a2 2 0 00-2-2Zm0 14H5V8h10v12ZM19 2H9a2 2 0 00-2 2v2h2V4h10v12h-2v2h2a2 2 0 002-2V4a2 2 0 00-2-2Z',
  done: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z',
  fail: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z',
};
// Classes that make a button a text pill or a pressed/disabled state.
const DROP_CLASS = /IconLeading|IconTrailing|Segmented|Disabled|Toggled/;

// Wrapper element of a button inside the actions row.
function hostOf(el) {
  return el?.closest('yt-button-view-model, ytd-button-renderer, ytd-download-button-renderer') || el;
}

// YouTube A/B-tests the action row, so instead of rebuilding its button we
// clone a real neighbouring one (classes, icon wrappers, hover and rim-light
// layers) and only swap the icon, label and click handler.
function createButton(ref) {
  const btn = ref.cloneNode(true);
  btn.className = btn.className
    .split(/\s+/)
    .filter((c) => c && !DROP_CLASS.test(c))
    .concat('ytSpecButtonShapeNextIconButton')
    .filter((c, i, all) => all.indexOf(c) === i)
    .join(' ');
  for (const a of ['aria-pressed', 'aria-disabled', 'disabled', 'style']) btn.removeAttribute(a);
  btn.querySelectorAll('.ytSpecButtonShapeNextButtonTextContent').forEach((e) => e.remove());
  btn.title = LABEL;
  btn.setAttribute('aria-label', LABEL);
  const path = btn.querySelector('.ytSpecButtonShapeNextIcon svg path');
  path.parentNode.replaceChildren(path);
  path.setAttribute('d', ICONS.copy);

  // Progress ring drawn around the button edge.
  const ring = document.createElementNS(SVG_NS, 'circle');
  ring.setAttribute('class', 'ytc-ring');
  for (const [k, v] of Object.entries({ cx: 20, cy: 20, r: 19 })) ring.setAttribute(k, v);
  const ringLen = 2 * Math.PI * 19;
  ring.style.strokeDasharray = ringLen;
  const progress = document.createElementNS(SVG_NS, 'svg');
  progress.setAttribute('class', 'ytc-progress');
  progress.setAttribute('viewBox', '0 0 40 40');
  progress.append(ring);
  btn.append(progress);

  const host = document.createElement('div');
  host.id = BTN_ID;
  const cs = getComputedStyle(hostOf(ref));
  host.style.marginLeft = cs.marginLeft;
  host.style.marginRight = cs.marginRight;
  host.append(btn);

  const setProgress = (f) => {
    ring.style.strokeDashoffset = ringLen * (1 - f);
    ring.style.opacity = f ? 1 : 0;
  };
  setProgress(0);
  btn.addEventListener('click', async () => {
    if (host.classList.contains('ytc-busy')) return;
    host.classList.add('ytc-busy');
    setProgress(0.15);
    let ok = true;
    try {
      const text = await fromCaptions(videoId(), setProgress).catch(() => fromPanel());
      setProgress(0.9);
      await navigator.clipboard.writeText(text);
      setProgress(1);
    } catch (e) {
      console.warn('[yt-transcript-copy]', e);
      ok = false;
    }
    host.classList.remove('ytc-busy');
    path.setAttribute('d', ok ? ICONS.done : ICONS.fail);
    btn.title = ok ? 'Transcript copied' : 'No transcript available';
    setTimeout(() => {
      path.setAttribute('d', ICONS.copy);
      btn.title = LABEL;
      setProgress(0);
    }, 1500);
  });
  return host;
}

// Place between "Ask" (AI) and "Save"; fall back to the end of the main button row.
function place(host, save, ask, actions) {
  if (save && save !== host.nextElementSibling) save.before(host);
  else if (!save && ask && ask !== host.previousElementSibling) ask.after(host);
  else if (!save && !ask && !host.isConnected)
    actions.querySelector('#top-level-buttons-computed')?.append(host);
}

let button;
let queued = false;
function inject() {
  if (queued || location.pathname !== '/watch') return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const actions = document.querySelector('ytd-watch-metadata #actions');
    if (!actions) return;
    const saveBtn = actions.querySelector('button[aria-label^="Save" i]');
    const askBtn = actions.querySelector('button[aria-label^="Ask" i]');
    const ref = saveBtn || askBtn || actions.querySelector('button[aria-label="Share"]');
    if (!ref?.querySelector('.ytSpecButtonShapeNextIcon svg path')) return;
    button ||= createButton(ref);
    place(button, hostOf(saveBtn), hostOf(askBtn), actions);
  });
}

new MutationObserver(inject).observe(document.body, { childList: true, subtree: true });
inject();
