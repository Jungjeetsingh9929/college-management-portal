import { useEffect, useState } from "react";

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

export function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem("pwa-install-dismissed") === "1");

  useEffect(() => {
    if (isStandalone()) return undefined;

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setDismissed(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  if (dismissed || isStandalone() || (!installEvent && !(isIos && !showIosHint))) return null;

  async function install() {
    if (!installEvent) {
      setShowIosHint(true);
      return;
    }
    await installEvent.prompt();
    setInstallEvent(null);
  }

  function dismiss() {
    sessionStorage.setItem("pwa-install-dismissed", "1");
    setDismissed(true);
  }

  return (
    <aside className="pwa-install-prompt" aria-label="Install College Portal">
      <div>
        <strong>Install College Portal</strong>
        <span>{showIosHint ? "Tap Share, then Add to Home Screen." : "Keep attendance and schedules one tap away."}</span>
      </div>
      <div className="pwa-install-actions">
        {!showIosHint && <button className="primary-button" onClick={install}>Install</button>}
        <button className="ghost-button" onClick={dismiss}>Not now</button>
      </div>
    </aside>
  );
}
