const button = document.getElementById("contract-copy");
const address = String(window.TruthFeedConfig?.CONTRACT_ADDRESS || "").trim();
const configured = /^0x[0-9a-fA-F]{40}$/.test(address);

button.dataset.address = configured ? address : "";
button.textContent = configured ? `${address.slice(0, 8)}…${address.slice(-4)}` : "not configured";
button.disabled = !configured;

button.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(address);
    const old = button.textContent;
    button.textContent = "copied!";
    setTimeout(() => (button.textContent = old), 1200);
  } catch {
    // Clipboard access can be unavailable on non-secure local origins.
  }
});
