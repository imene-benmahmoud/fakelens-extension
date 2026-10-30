const MENU_ID = "fakeLens-verify-image";

const RESTRICTED_SCHEMES = ["chrome://", "chrome-search://", "edge://", "devtools://", "chrome-extension://"];

function isReachable(url) {
  return typeof url === "string" && !RESTRICTED_SCHEMES.some((scheme) => url.startsWith(scheme));
}

function buildMenu() {
  // Les menus survivent aux mises à jour du worker : removeAll évite les doublons.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      menuId: MENU_ID,
      title: "Vérifier cette image avec FakeLens",
      contexts: ["image"],
    });
  });
}

chrome.runtime.onInstalled.addListener(buildMenu);
chrome.runtime.onStartup.addListener(buildMenu);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id || !info.srcUrl) return;

  if (!isReachable(tab.url)) {
    console.warn("FakeLens : injection impossible sur", tab.url);
    return;
  }

  const payload = {
    type: "FAKELENS_VERIFY_IMAGE",
    srcUrl: info.srcUrl,
    pageUrl: info.pageUrl ?? tab.url,
    linkUrl: info.linkUrl,
    mediaType: info.mediaType,
    frameId: info.frameId,
  };

  try {
    const result = await chrome.tabs.sendMessage(tab.id, payload, { frameId: info.frameId });
    console.log("FakeLens : analyse transmise", result);
  } catch (error) {
    // Le content script n'est pas présent dans cette frame (page installée tard, iframe, etc.).
    console.warn("FakeLens : aucun content script pour recevoir le message.", error.message);
  }
});
