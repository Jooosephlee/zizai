// Only inject into the same isolated document that requested the runtime.
const contentRuntimeLoads = new Map();

async function loadContentRuntime(sender) {
  const { tab, frameId, documentId } = sender;
  const key = tab.id + ":" + (documentId || frameId);
  if (contentRuntimeLoads.has(key)) return contentRuntimeLoads.get(key);
  const target = documentId ? { tabId: tab.id, documentIds: [documentId] } : { tabId: tab.id, frameIds: [frameId] };
  const loading = chrome.scripting.executeScript({
    target,
    files: ["site-images.js", "site-posts.js", "image-geometry.js", "content.js"]
  });
  contentRuntimeLoads.set(key, loading);
  try {
    await loading;
  } finally {
    contentRuntimeLoads.delete(key);
  }
}
