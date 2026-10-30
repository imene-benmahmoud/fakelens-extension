const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const urlEl = document.getElementById("page-url");
const pingBtn = document.getElementById("ping");

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

// Le clic sur l'action accorde activeTab : tab.url est lisible sans permission "tabs".
async function init() {
  const tab = await activeTab();
  urlEl.textContent = tab?.url ?? "Onglet indisponible";
}

pingBtn.addEventListener("click", async () => {
  pingBtn.disabled = true;
  statusEl.textContent = "Envoi…";

  try {
    const tab = await activeTab();
    if (!tab?.id) throw new Error("aucun onglet actif");

    const response = await chrome.tabs.sendMessage(tab.id, { type: "FAKELENS_PING" });
    statusEl.textContent = `Content script actif — ${response.imageCount} image(s)`;
  } catch (error) {
    // Pas de content script : pages système, Web Store, ou iframe ciblée par erreur.
    statusEl.textContent = `Échec : ${error.message}`;
  } finally {
    pingBtn.disabled = false;
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "FAKELENS_RESULT") {
    resultEl.textContent = JSON.stringify(message.report, null, 2);
  }
});

init();
