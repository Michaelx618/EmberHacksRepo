"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Camera capture straight into the graph.
 *
 * The flow it is built around: write on paper, hold the page up, watch the
 * nodes appear. So a frame is read in FULL -- every idea on the page, not just
 * what changed since the last shot -- and the note exists from the moment the
 * camera opens, so there is somewhere visible for it all to land.
 *
 * Everything below the network call is about not paying for the same page
 * twice. The camera produces ~85 frames a minute and almost all of them show a
 * page we have already read, so two cheap in-browser tests gate the upload:
 * has the picture stopped moving, and does it differ from the last frame we
 * actually sent. "Read this page" skips both.
 */

export type LiveNote = { id: string; title: string };

/** How often we look at the camera. Cheap -- it never leaves the browser. */
const TICK_MS = 700;

/** Downscaled grayscale grid used for both motion and change detection. Small
 *  on purpose: at 64x48 a moving hand is unmistakable and a pen stroke still
 *  registers, while JPEG noise and flicker average out. */
const SAMPLE_W = 64;
const SAMPLE_H = 48;

/**
 * Mean per-pixel difference, 0-255.
 *
 * STILL: below this the picture has settled. Loose enough for a page held in
 *   the hand, which never stops moving slightly -- the thing it has to reject
 *   is a page being waved into position or swapped for another.
 * CHANGED: how different the view must be from the last frame we sent before
 *   it is worth sending again. Deliberately low: a few extra lines of writing
 *   move very few pixels, and missing them is worse than the occasional call
 *   that comes back with nothing.
 */
const STILL = 6;
const CHANGED = 3;

/** Floor between uploads. Longer after a frame that found nothing, so a page
 *  sitting in front of the camera doesn't bill a call every two seconds. */
const COOLDOWN_ACTIVE_MS = 2000;
const COOLDOWN_IDLE_MS = 6000;

/** Long edge of the frame we upload. A whole page of handwriting at arm's
 *  length needs the pixels -- at 1280 the smaller writing starts coming back
 *  as [?]. 1600 keeps the JPEG near 250KB, which is still fine every few
 *  seconds. */
const UPLOAD_WIDTH = 1600;

type Status = "idle" | "starting" | "watching" | "settling" | "reading" | "error";

type FrameResult = {
  noteTitle: string;
  outcomes: { action: string; title: string; rationale?: string }[];
  edgesCreated: number;
};

export default function LiveCapture({
  onSessionStart,
  onGraphChanged,
  onSessionEnd,
}: {
  onSessionStart: (note: LiveNote) => void;
  onGraphChanged: () => void;
  onSessionEnd: (note: LiveNote, opts: { deleted: boolean }) => void;
}) {
  const [note, setNote] = useState<LiveNote | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<{ action: string; title: string }[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const sampleCanvas = useRef<HTMLCanvasElement | null>(null);
  const uploadCanvas = useRef<HTMLCanvasElement | null>(null);

  // The callbacks are inline arrows in the parent, so a new identity arrives
  // every render. Reached through a ref they can't get into a dependency
  // array, which is what keeps the watch interval from being torn down and
  // restarted on each render.
  const callbacks = useRef({ onSessionStart, onGraphChanged, onSessionEnd });
  useEffect(() => {
    callbacks.current = { onSessionStart, onGraphChanged, onSessionEnd };
  });

  // Read inside the interval, so they must not go through React state.
  const noteRef = useRef<LiveNote | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const cooldownRef = useRef(0);
  const prevSample = useRef<Uint8Array | null>(null); // previous tick -> motion
  const baseline = useRef<Uint8Array | null>(null); // last uploaded -> change
  const capturedCount = useRef(0);

  const open = status !== "idle";

  const grab = useCallback((): Uint8Array | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return null;

    const canvas = (sampleCanvas.current ??= document.createElement("canvas"));
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
    const { data } = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
    const gray = new Uint8Array(SAMPLE_W * SAMPLE_H);
    for (let i = 0; i < gray.length; i++) {
      const p = i * 4;
      gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    }
    return gray;
  }, []);

  const stop = useCallback(
    async ({ skipDelete = false }: { skipDelete?: boolean } = {}) => {
      const finished = noteRef.current;
      noteRef.current = null;

      setStream((s) => {
        s?.getTracks().forEach((t) => t.stop());
        return null;
      });
      prevSample.current = null;
      baseline.current = null;
      setStatus("idle");
      setNote(null);
      setCaptured([]);
      setError(null);

      if (!finished) return;

      // A session that read nothing leaves an empty note behind, which is pure
      // clutter in the sidebar -- so take it back out.
      const deleted = capturedCount.current === 0 && !skipDelete;
      if (deleted) {
        await fetch(`/api/notes/${finished.id}`, { method: "DELETE" }).catch(() => {});
      }
      capturedCount.current = 0;
      callbacks.current.onSessionEnd(finished, { deleted });
    },
    [],
  );

  const send = useCallback(
    async (atCapture: Uint8Array | null, { force = false }: { force?: boolean } = {}) => {
      const video = videoRef.current;
      const current = noteRef.current;
      if (!video || !current || busyRef.current) return;

      busyRef.current = true;
      let found = false;
      setStatus("reading");

      try {
        const canvas = (uploadCanvas.current ??= document.createElement("canvas"));
        const scale = Math.min(1, UPLOAD_WIDTH / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.8),
        );
        if (!blob) throw new Error("Could not read a frame from the camera.");

        const body = new FormData();
        body.append("noteId", current.id);
        body.append("frame", blob, "frame.jpg");
        if (force) body.append("force", "1");

        const res = await fetch("/api/live/frame", { method: "POST", body });
        const data = (await res.json()) as FrameResult & { error?: string; gone?: boolean };

        if (res.status === 410 || data.gone) {
          // The note was deleted from the sidebar while we were filming.
          // skipDelete: there is nothing left to delete.
          void stop({ skipDelete: true });
          return;
        }
        if (!res.ok) throw new Error(data.error ?? `Frame failed (${res.status})`);

        setError(null);
        // Only frames that actually landed become the new baseline: if a frame
        // errors out, the page it showed is still uncaptured and the next tick
        // should try again rather than treat it as already read.
        baseline.current = atCapture;

        found = data.outcomes.length > 0;
        if (found) {
          capturedCount.current += data.outcomes.length;
          setCaptured((c) => [
            ...data.outcomes.map((o) => ({ action: o.action, title: o.title })),
            ...c,
          ]);
          setNote((n) => (n && data.noteTitle ? { ...n, title: data.noteTitle } : n));
          callbacks.current.onGraphChanged();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Frame failed");
      } finally {
        // Back off when the page had nothing left to give; stay responsive
        // while it is still producing, which is when they are turning pages.
        cooldownRef.current = Date.now() + (found ? COOLDOWN_ACTIVE_MS : COOLDOWN_IDLE_MS);
        busyRef.current = false;
        if (noteRef.current) setStatus("watching");
      }
    },
    [stop],
  );

  async function start() {
    setError(null);
    setCaptured([]);
    capturedCount.current = 0;
    setStatus("starting");

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser will only open a camera on https:// or localhost.");
      setStatus("error");
      return;
    }

    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        // environment = the rear camera on a phone/tablet; laptops just ignore it.
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch (e) {
      setError(cameraError(e));
      setStatus("error");
      return;
    }

    try {
      const res = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as LiveNote & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Could not start capture (${res.status})`);

      noteRef.current = { id: data.id, title: data.title };
      setNote({ id: data.id, title: data.title });
      setStream(media);
      setStatus("watching");
      callbacks.current.onSessionStart({ id: data.id, title: data.title });
    } catch (e) {
      media.getTracks().forEach((t) => t.stop());
      setError(e instanceof Error ? e.message : "Could not start capture");
      setStatus("error");
    }
  }

  // Attach the stream once the <video> is on the page.
  useEffect(() => {
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  // The watch loop: decide, per tick, whether this frame is worth a call.
  useEffect(() => {
    if (!stream || !note) return;

    const id = setInterval(() => {
      const now = grab();
      if (!now) return;

      const previous = prevSample.current;
      prevSample.current = now;
      if (!previous) return;

      if (busyRef.current || Date.now() < cooldownRef.current) return;

      // A hand, or the page being moved. Wait for the picture to settle.
      if (diff(now, previous) > STILL) {
        setStatus("settling");
        return;
      }

      // Still, but nothing has been added since the last frame we sent.
      if (baseline.current && diff(now, baseline.current) < CHANGED) {
        setStatus("watching");
        return;
      }

      void send(now);
    }, TICK_MS);

    return () => clearInterval(id);
  }, [stream, note, grab, send]);

  // Never leave the camera light on because the page navigated away.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <>
      <div className="px-3 pb-3">
        <button
          onClick={() => (open ? void stop() : void start())}
          className={`w-full rounded-lg border px-3 py-2 text-xs transition flex items-center justify-center gap-2 ${
            open
              ? "border-contradicts/50 text-contradicts hover:bg-contradicts/10"
              : "border-border text-muted hover:border-border-strong hover:text-foreground"
          }`}
        >
          <CameraIcon />
          {open ? "Stop live capture" : "Scan a page live"}
        </button>
      </div>

      {open && (
        <div className="fixed bottom-4 left-[248px] z-40 w-[300px] rounded-xl border border-border-strong bg-panel shadow-2xl overflow-hidden fade-up">
          <div className="relative bg-black aspect-[4/3]">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-cover"
            />
            {status === "starting" && (
              <div className="absolute inset-0 grid place-items-center text-xs text-muted">
                Opening camera…
              </div>
            )}
            {status === "reading" && (
              <div className="absolute inset-0 border-2 border-accent pointer-events-none scan-pulse" />
            )}
            <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full shrink-0"
                style={{ background: statusDot(status) }}
              />
              <span className="text-[10px] text-white/80 drop-shadow truncate">
                {STATUS_TEXT[status]}
              </span>
              <button
                // force: read the page from scratch, whatever we already hold.
                // Sample fresh rather than reusing the last tick's, so this
                // shot becomes the baseline and the loop doesn't re-send it.
                onClick={() => void send(grab(), { force: true })}
                disabled={status === "reading" || status === "starting"}
                className="ml-auto shrink-0 rounded px-2 py-0.5 text-[10px] font-medium bg-accent text-background hover:brightness-110 disabled:opacity-40"
              >
                Read this page
              </button>
            </div>
          </div>

          <div className="p-2.5 space-y-2">
            <div className="text-[11px] font-medium truncate">{note?.title ?? "Live capture"}</div>

            {error && <p className="text-[10px] text-contradicts leading-snug">{error}</p>}

            {captured.length === 0 ? (
              <p className="text-[10px] text-muted leading-snug">
                Hold your page up to the camera. It reads the whole page on its own once the
                shot settles — or press <span className="text-foreground">Read this page</span>{" "}
                to do it now.
              </p>
            ) : (
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {captured.map((c, i) => (
                  <li key={`${c.title}-${i}`} className="flex gap-1.5 text-[11px] fade-up">
                    <span className={outcomeColor(c.action)}>{outcomeIcon(c.action)}</span>
                    <span className="truncate">{c.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Mean absolute difference between two grayscale samples, 0-255. */
function diff(a: Uint8Array, b: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

const STATUS_TEXT: Record<Status, string> = {
  idle: "",
  starting: "Opening camera…",
  watching: "Ready — show it a page",
  settling: "Hold the page steady…",
  reading: "Reading your handwriting…",
  error: "Camera stopped",
};

function statusDot(status: Status): string {
  if (status === "reading") return "var(--accent)";
  if (status === "settling") return "var(--mastery-mid)";
  if (status === "error") return "var(--rel-contradicts)";
  return "var(--mastery-hot)";
}

function cameraError(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "NotAllowedError")
    return "Camera permission was denied. Allow it in the address bar, then try again.";
  if (name === "NotFoundError") return "No camera found on this device.";
  if (name === "NotReadableError") return "The camera is already in use by another app.";
  return e instanceof Error ? e.message : "Could not open the camera.";
}

const outcomeIcon = (a: string) =>
  ({ created: "+", reinforced: "↑", superseded: "⟳", contradicted: "⚠" }[a] ?? "•");

const outcomeColor = (a: string) =>
  ({
    created: "text-accent",
    reinforced: "text-example",
    superseded: "text-prerequisite",
    contradicted: "text-contradicts",
  }[a] ?? "text-muted");

function CameraIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1" y="3.5" width="12" height="9" rx="1.5" />
      <circle cx="7" cy="8" r="2.5" />
      <path d="M5 3.5l1-2h2l1 2" />
    </svg>
  );
}
