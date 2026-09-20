import { useState } from "react";
import { usePwaInstall } from "../hooks/usePwaInstall.js";

// Full-width, hard-to-miss "install the app" banner. Shown at the top of
// Login and Home (not floated globally) so it's seen before or alongside
// the login form on first visit. Once the app is installed/standalone,
// usePwaInstall reports isStandalone and this renders nothing, for good on
// that device.
export function PwaInstallBanner() {
  const { isStandalone, canPrompt, showIosHint, promptInstall } = usePwaInstall();
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem("pwa-install-dismissed") === "1");

  if (isStandalone || dismissed || !canPrompt) return null;

  function dismiss() {
    sessionStorage.setItem("pwa-install-dismissed", "1");
    setDismissed(true);
  }

  return (
    <div className="pwa-install-banner" role="banner" aria-label="Install College Portal">
      <div className="pwa-install-banner-copy">
        <strong>Install College Portal</strong>
        <span>{showIosHint ? "Tap Share, then Add to Home Screen." : "Keep attendance and schedules one tap away."}</span>
      </div>
      <div className="pwa-install-banner-actions">
        {!showIosHint && (
          <button className="primary-button small" onClick={promptInstall}>
            Install the app
          </button>
        )}
        <button className="ghost-button small" onClick={dismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}
