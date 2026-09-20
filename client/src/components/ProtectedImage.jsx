import React, { useEffect, useState } from "react";
import { apiDownload } from "../context/api.js";

// Photo endpoints require the bearer token, so a plain <img src> can't load
// them. This fetches through apiDownload (which also handles the 401 ->
// refresh retry), shows the bytes via a blob: URL, and revokes it on unmount.
// `refreshKey` forces a reload when the same photo id must be re-fetched.
export function ProtectedImage({ photoId, alt = "", className = "", fallback = null, refreshKey = 0 }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setSrc("");
    setFailed(false);
    if (!photoId) return undefined;
    apiDownload(`/photos/${photoId}/image`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId, refreshKey]);

  if (!photoId || failed || !src) return fallback;
  return <img className={className} src={src} alt={alt} />;
}
