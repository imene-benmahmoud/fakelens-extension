const API_ENDPOINT = "http://localhost:8000/explain";
const MIN_INTRINSIC_EDGE = 100;
const REQUEST_TIMEOUT_MS = 20000;
const LOAD_TIMEOUT_MS = 5000;

let active = null;

function resolveImageSource(img) {
  try {
    return new URL(img.currentSrc || img.src, location.href).href;
  } catch {
    return "";
  }
}

function findImage(srcUrl) {
  return [...document.images].find((img) => resolveImageSource(img) === srcUrl) ?? null;
}

function waitForDecode(img) {
  if (img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
    setTimeout(done, LOAD_TIMEOUT_MS);
  });
}

function verdictTone(label) {
  if (/fake|ai|gen|synth|deepfake|manip/i.test(label)) return "fake";
  if (/real|authentic|human|genuine|original/i.test(label)) return "real";
  return "unknown";
}

function normalizeScore(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return null;
  return Math.round(value <= 1 ? value * 100 : value);
}

async function postExplain(srcUrl, signal) {
  const response = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image_url: srcUrl }),
    credentials: "omit",
    cache: "no-store",
    signal,
  });

  if (!response.ok) throw new Error(`backend ${response.status} ${response.statusText}`);
  return response.json();
}

const OVERLAY_CSS = `
  .fl-box { position: absolute; inset: 0; font: 600 12px/1.3 system-ui, sans-serif; }
  .fl-heat {
    display: none; position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: fill; opacity: .65;
  }
  .fl-badge {
    display: none; position: absolute; top: 8px; left: 8px; gap: 6px; align-items: center;
    padding: 5px 8px; border-radius: 999px; color: #fff; pointer-events: auto;
    background: #4b5563; box-shadow: 0 1px 4px rgb(0 0 0 / .35);
  }
  .fl-badge[data-tone="fake"] { background: #dc2626; }
  .fl-badge[data-tone="real"] { background: #16a34a; }
  .fl-score { font-variant-numeric: tabular-nums; opacity: .9; }
  .fl-close {
    border: 0; margin: 0 0 0 2px; padding: 0 3px; border-radius: 999px; cursor: pointer;
    background: rgb(255 255 255 / .22); color: #fff; font: inherit; line-height: 1.2;
  }
  .fl-status {
    display: none; position: absolute; top: 8px; left: 8px; max-width: 90%;
    padding: 5px 8px; border-radius: 999px; background: #111827; color: #f9fafb;
    pointer-events: auto; box-shadow: 0 1px 4px rgb(0 0 0 / .35);
  }
  .fl-state-pending .fl-status,
  .fl-state-error .fl-status { display: block; }
  .fl-state-done .fl-badge { display: flex; }
  .fl-state-done .fl-heat { display: block; }
`;

function unmount() {
  if (!active) return;
  active.teardown();
  active = null;
}

function mount(img) {
  unmount();

  const host = document.createElement("div");
  host.setAttribute("data-fakelens", "");
  host.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none";

  const root = host.attachShadow({ mode: "open" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(OVERLAY_CSS);
  // Feuille constructible : ni <style> ni attribut inline, donc insensible à la CSP style-src du site.
  root.adoptedStyleSheets = [sheet];

  const box = document.createElement("div");
  box.className = "fl-box fl-state-pending";
  box.innerHTML = `
    <img class="fl-heat" alt="" />
    <span class="fl-status">Analyse en cours…</span>
    <span class="fl-badge"><span class="fl-label"></span><span class="fl-score"></span><button class="fl-close" type="button" title="Fermer">×</button></span>
  `;
  root.append(box);
  (document.body ?? document.documentElement).append(host);
  img.classList.add("fakelens-flagged");

  // Position fixe recalée sur le rect : envelopper le <img> casserait le layout du site.
  // Une boucle rAF plutot que scroll/resize : un reflow du au chargement d'un contenu au-dessus
  // de l'image ne declenche ni l'un ni l'autre, et l'overlay resterait decalle.
  let lastKey = "";
  let frame = 0;
  const loop = () => {
    if (!img.isConnected) {
      unmount();
      return;
    }
    const rect = img.getBoundingClientRect();
    const key = `${rect.left}|${rect.top}|${rect.width}|${rect.height}`;
    if (key !== lastKey) {
      lastKey = key;
      host.style.left = `${rect.left}px`;
      host.style.top = `${rect.top}px`;
      host.style.width = `${rect.width}px`;
      host.style.height = `${rect.height}px`;
    }
    frame = requestAnimationFrame(loop);
  };
  loop();

  const statusEl = box.querySelector(".fl-status");
  const heatEl = box.querySelector(".fl-heat");
  const badgeEl = box.querySelector(".fl-badge");
  const onClose = () => unmount();
  box.querySelector(".fl-close").addEventListener("click", onClose);

  const teardown = () => {
    cancelAnimationFrame(frame);
    img.classList.remove("fakelens-flagged");
    host.remove();
  };

  const overlay = {
    fail(message) {
      statusEl.textContent = message;
      box.className = "fl-box fl-state-error";
    },
    show({ label, score, heatmap }) {
      if (heatmap) heatEl.src = heatmap.startsWith("data:") ? heatmap : `data:image/png;base64,${heatmap}`;
      badgeEl.querySelector(".fl-label").textContent = label;
      badgeEl.querySelector(".fl-score").textContent = score === null ? "" : `${score}%`;
      badgeEl.dataset.tone = verdictTone(label);
      box.className = "fl-box fl-state-done";
    },
    teardown,
  };

  active = overlay;
  return overlay;
}

async function analyze(message) {
  const img = findImage(message.srcUrl);

  if (!img) {
    return { found: false, reason: "image absente du DOM", requestedSrc: message.srcUrl };
  }

  await waitForDecode(img);

  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (width < MIN_INTRINSIC_EDGE || height < MIN_INTRINSIC_EDGE) {
    return { found: true, skipped: true, src: resolveImageSource(img), naturalWidth: width, naturalHeight: height, reason: `image trop petite (${width}×${height})` };
  }

  const overlay = mount(img);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let payload;
  try {
    payload = await postExplain(resolveImageSource(img), controller.signal);
  } catch (error) {
    const reason = error.name === "AbortError" ? "délai dépassé" : error.message;
    overlay.fail(`FakeLens : ${reason}`);
    return { found: true, error: reason, src: resolveImageSource(img) };
  } finally {
    clearTimeout(timer);
  }

  const label = String(payload.label ?? payload.verdict ?? "inconnu");
  const score = normalizeScore(payload.score ?? payload.confidence);
  overlay.show({ label, score, heatmap: payload.heatmap ?? payload.heatmap_base64 ?? "" });

  const report = {
    found: true,
    src: resolveImageSource(img),
    naturalWidth: width,
    naturalHeight: height,
    label,
    score,
    tone: verdictTone(label),
    pageUrl: location.href,
  };

  // Personne n'écoute FAKELENS_RESULT côté worker : le rejet est attendu.
  chrome.runtime.sendMessage({ type: "FAKELENS_RESULT", report }).catch(() => {});
  return report;
}

addEventListener("keydown", (event) => {
  if (event.key === "Escape") unmount();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "FAKELENS_PING") {
    sendResponse({ ok: true, imageCount: document.images.length, pageUrl: location.href });
    return;
  }

  if (message?.type !== "FAKELENS_VERIFY_IMAGE") return;

  analyze(message).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
  // Le canal doit rester ouvert pendant le await du fetch.
  return true;
});
