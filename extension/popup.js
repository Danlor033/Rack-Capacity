// The toolbar button: how the last sync went, and a way to run one now.
"use strict";

const dot = document.getElementById("dot");
const text = document.getElementById("text");
const when = document.getElementById("when");
const now = document.getElementById("now");

async function render() {
  const { last } = await chrome.storage.local.get("last");
  if (!last) return;
  dot.className = last.ok ? "ok" : "bad";
  text.textContent = last.text;
  when.textContent = new Date(last.at).toLocaleTimeString() + " · every 30 seconds";
}

now.addEventListener("click", async function () {
  now.disabled = true;
  await chrome.runtime.sendMessage("sync-now");
  await render();
  now.disabled = false;
});

chrome.storage.onChanged.addListener(render);
render();
