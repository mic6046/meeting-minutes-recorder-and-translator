import { useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const RELOAD_DELAY_MS = 3000;

interface BuildMeta {
  buildId: string;
  builtAt: string;
}

async function fetchBuildMeta(): Promise<BuildMeta | null> {
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function AppUpdateNotifier() {
  const currentBuildId = useRef<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    const checkForUpdate = async () => {
      const meta = await fetchBuildMeta();
      if (!meta?.buildId) return;

      if (currentBuildId.current === null) {
        currentBuildId.current = meta.buildId;
        return;
      }

      if (meta.buildId !== currentBuildId.current) {
        setUpdateAvailable(true);
        setTimeout(() => {
          const url = new URL(window.location.href);
          url.searchParams.set("_v", meta.buildId);
          window.location.replace(url.toString());
        }, RELOAD_DELAY_MS);
      }
    };

    void checkForUpdate();

    const pollTimer = setInterval(() => void checkForUpdate(), POLL_INTERVAL_MS);
    const onFocus = () => void checkForUpdate();
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(pollTimer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-[9999] rounded-lg bg-indigo-950 px-4 py-3 text-sm font-medium text-indigo-100 shadow-lg"
    >
      Update available — reloading…
    </div>
  );
}
