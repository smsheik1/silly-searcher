const form = document.querySelector("#settings"),
  keyInput = document.querySelector("#api-key"),
  testButton = document.querySelector("#test"),
  status = document.querySelector("#status");

chrome.storage.local.get(["apiKey"]).then((data) => {
  if (data.apiKey) keyInput.placeholder = "Key saved — paste a new one to replace it";
});

function setStatus(text, isError = false) {
  status.textContent = text;
  status.classList.toggle("error", isError);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = keyInput.value.trim();
  if (!key) {
    setStatus("Paste your TypeSafe API key first.", true);
    return;
  }
  setStatus("Checking key…");
  testButton.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "NEEDLE_TEST", key });
    if (!result || !result.ok) throw new Error(result?.error || "Connection test failed.");
    await chrome.storage.local.set({ apiKey: key });
    keyInput.value = "";
    keyInput.placeholder = "Key saved — paste a new one to replace it";
    setStatus("Key saved and verified. Open a webpage and click the Needle icon.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not verify the key.", true);
  } finally {
    testButton.disabled = false;
  }
});

document.querySelector("#remove").addEventListener("click", async () => {
  await chrome.storage.local.remove("apiKey");
  keyInput.placeholder = "Paste TypeSafe API key";
  setStatus("Key removed.");
});
