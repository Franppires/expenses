(function () {
  "use strict";

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js?v=5").catch(() => {});
    });
  }

  let deferredPrompt = null;
  const bar = document.createElement("div");
  bar.id = "pwaInstallBar";
  bar.className = "pwa-install hidden";
  bar.innerHTML =
    '<p><strong>Instalar no celular</strong> — atalho na tela inicial, como um app.</p>' +
    '<div class="btn-row"><button type="button" class="btn btn-primary btn-sm" id="pwaInstallBtn">Instalar</button>' +
    '<button type="button" class="btn btn-ghost btn-sm" id="pwaInstallDismiss">Agora não</button></div>';
  document.body.appendChild(bar);

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (sessionStorage.getItem("pwa-dismiss") !== "1") {
      bar.classList.remove("hidden");
    }
  });

  document.getElementById("pwaInstallBtn")?.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    bar.classList.add("hidden");
  });

  document.getElementById("pwaInstallDismiss")?.addEventListener("click", () => {
    sessionStorage.setItem("pwa-dismiss", "1");
    bar.classList.add("hidden");
  });
})();
