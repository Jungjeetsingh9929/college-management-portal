import { useCallback, useEffect, useState } from "react";

function computeIsStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

// Shared by every place that wants to offer "install the app" (currently a
// full-width banner on Login and Home). Centralizing the
// beforeinstallprompt/appinstalled wiring here means each caller just reads
// isStandalone/canPrompt instead of re-subscribing to those events itself.
export function usePwaInstall() {
  const [installEvent, setInstallEvent] = useState(null);
  const [isStandalone, setIsStandalone] = useState(() => computeIsStandalone());
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (computeIsStandalone()) {
      setIsStandalone(true);
      return undefined;
    }

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setIsStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  const promptInstall = useCallback(async () => {
    if (!installEvent) {
      // iOS never fires beforeinstallprompt, so there is nothing to
      // programmatically prompt — show the manual instructions instead.
      setShowIosHint(true);
      return;
    }
    await installEvent.prompt();
    setInstallEvent(null);
  }, [installEvent]);

  // Anything worth showing at all: a real captured install prompt, or an
  // iOS device where we can only ever offer the manual instructions.
  const canPrompt = Boolean(installEvent) || isIos;

  return { isStandalone, canPrompt, isIos, showIosHint, promptInstall };
}
