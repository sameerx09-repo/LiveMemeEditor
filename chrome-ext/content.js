const CLIPMEME_URL = "http://localhost:3000";
const DIRECT_STORAGE_UPLOAD = false;

if (window.location.origin === CLIPMEME_URL) {
  // Running inside the editor — nothing to inject
} else {

const hostname = location.hostname;
let activated = false;
let observer = null;
let injected;

// Holds a clip that couldn't upload due to missing/expired token
let pendingUpload = null; // { blob, btn, timerEl }

// Gate everything behind per-site opt-in
chrome.storage.sync.get("enabledSites", ({ enabledSites = {} }) => {
  if (enabledSites[hostname]) activate();
});

// Popup can enable/disable without a page reload; background notifies when token arrives
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "CM_ENABLE_SITE") activate();
  if (msg.type === "CM_DISABLE_SITE") deactivate();
  if (msg.type === "CM_TOKEN_READY" && pendingUpload) {
    const { blob, btn, timerEl } = pendingUpload;
    pendingUpload = null;
    btn.textContent = "⏳ Uploading…";
    btn.style.background = "rgba(220,38,38,0.92)";
    btn.disabled = true;
    sendClip(blob, btn, timerEl);
  }
});

function activate() {
  if (activated) return;
  activated = true;
  document.querySelectorAll("video").forEach(injectButton);
  observer = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === "VIDEO") injectButton(node);
        node.querySelectorAll?.("video").forEach(injectButton);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function deactivate() {
  activated = false;
  observer?.disconnect();
  observer = null;
  document.querySelectorAll(".clipmeme-wrap").forEach((el) => el.remove());
  injected = new WeakSet();
}

injected = new WeakSet();

function injectButton(video) {
  if (injected.has(video)) return;
  injected.add(video);

  // Ensure the parent can host absolute children
  const parent = video.parentElement;
  if (!parent) return;
  const ps = window.getComputedStyle(parent);
  if (ps.position === "static") parent.style.position = "relative";

  const wrap = Object.assign(document.createElement("div"), {
    className: "clipmeme-wrap",
    style: `
      position:absolute;top:10px;right:10px;z-index:2147483647;
      display:flex;align-items:center;gap:6px;pointer-events:auto;
    `.replace(/\s+/g, " "),
  });

  const btn = Object.assign(document.createElement("button"), {
    textContent: "🎬 Clip",
    style: `
      background:rgba(220,38,38,0.92);color:#fff;border:none;
      border-radius:6px;padding:5px 11px;font-size:13px;font-weight:700;
      cursor:pointer;font-family:system-ui,sans-serif;box-shadow:0 2px 8px #0008;
      transition:background .15s;
    `.replace(/\s+/g, " "),
  });

  const timerEl = Object.assign(document.createElement("span"), {
    style: `
      background:rgba(0,0,0,.75);color:#fff;border-radius:4px;
      padding:3px 7px;font-size:12px;font-family:monospace;display:none;
    `.replace(/\s+/g, " "),
  });

  wrap.append(btn, timerEl);
  parent.appendChild(wrap);

  let recorder = null;
  let timerInterval = null;
  let recordedTracks = [];
  let removeVideoEndHandler = null;
  let audioMonitor = null;
  let starting = false;
  let finishing = false;

  function rememberFlakyElementCapture() {
    console.warn("[ClipMeme] No video data received. Replay the video and retry Clip.");
  }

  function stopRecordedTracks() {
    recordedTracks.forEach((track) => {
      try { track.stop(); } catch { /* ignore */ }
    });
    recordedTracks = [];
  }

  function stopAudioMonitor() {
    try { audioMonitor?.source?.disconnect(); } catch { /* ignore */ }
    try { audioMonitor?.ctx?.close(); } catch { /* ignore */ }
    audioMonitor = null;
  }

  function clearRecordingHooks() {
    clearInterval(timerInterval);
    timerInterval = null;
    removeVideoEndHandler?.();
    removeVideoEndHandler = null;
  }

  function keepTabAudioAudible(stream) {
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;

    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContextCtor();
      const source = ctx.createMediaStreamSource(new MediaStream(audioTracks));
      source.connect(ctx.destination);
      audioMonitor = { ctx, source };
    } catch (err) {
      console.warn("[ClipMeme] could not monitor tab audio:", err?.message);
    }
  }


  async function getRecordingStream() {
    const stream = video.captureStream();
    const videoTracks = stream.getVideoTracks();

    if (videoTracks.length === 0) {
      throw new Error("No video tracks in captureStream — page may be using DRM");
    }

    // Try to get tab audio via tabCapture (catches players that route audio
    // outside the video element). Falls back to video-only if unavailable.
    let audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      try {
        const { streamId, error } = await new Promise((resolve) =>
          chrome.runtime.sendMessage({ type: "GET_TAB_AUDIO_STREAM_ID" }, resolve)
        );
        if (streamId) {
          const tabAudioStream = await navigator.mediaDevices.getUserMedia({
            audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
            video: false,
          });
          keepTabAudioAudible(tabAudioStream);
          audioTracks = tabAudioStream.getAudioTracks();
        } else {
          console.warn("[ClipMeme] tabCapture stream ID unavailable:", error);
        }
      } catch (err) {
        console.warn("[ClipMeme] tabCapture audio failed, recording video only:", err?.message);
      }
    }

    return { stream: new MediaStream([...videoTracks, ...audioTracks]), label: "element" };
  }


  function stopRecording(reason = "manual") {
    if (!recorder) return;

    const activeRecorder = recorder;
    recorder = null;
    finishing = true;
    clearRecordingHooks();
    btn.textContent = "⏳ Sending…";
    btn.disabled = true;

    console.log(`[ClipMeme] stopping recorder: ${reason}`);
    if (activeRecorder.state !== "inactive") {
      activeRecorder.stop();
    }
  }

  function watchVideoEnd(activeRecorder) {
    let frameId = null;
    const onVideoEnded = () => stopRecording("video ended");
    const checkEnd = () => {
      if (recorder !== activeRecorder) return;
      const remaining = video.duration - video.currentTime;
      // Some players tear down capture tracks at ended, losing the encoder's tail.
      // Flush just before that teardown, without pausing or seeking the player.
      if (!video.paused && !video.seeking && Number.isFinite(video.duration) &&
          video.duration > 0 && remaining > 0 && remaining <= 0.1) {
        stopRecording("video finishing");
      }
    };
    const onFrame = () => {
      checkEnd();
      if (recorder === activeRecorder) frameId = video.requestVideoFrameCallback(onFrame);
    };
    const endInterval = setInterval(checkEnd, 50);
    video.addEventListener("ended", onVideoEnded, { once: true });
    if (video.requestVideoFrameCallback) frameId = video.requestVideoFrameCallback(onFrame);
    removeVideoEndHandler = () => {
      clearInterval(endInterval);
      video.removeEventListener("ended", onVideoEnded);
      if (frameId !== null) video.cancelVideoFrameCallback?.(frameId);
    };
  }

  btn.addEventListener("click", async (e) => {
    // Prevent click from bubbling to the video player (YouTube pauses on click)
    e.stopPropagation();
    e.preventDefault();
    if (starting || finishing) return;

    if (!recorder) {
      // ── START ──────────────────────────────────
      starting = true;
      btn.disabled = true;
      btn.textContent = "Starting...";
      try {
        stopAudioMonitor();
        stopRecordedTracks();
        // Restart paused/ended playback before capturing, so tracks are fresh.
        if (video.paused) await video.play();
        const { stream: recStream, label: captureMode } = await getRecordingStream();
        const videoTracks = recStream.getVideoTracks();
        const audioTracks = recStream.getAudioTracks();

        const hasAudio = audioTracks.length > 0;
        const videoMimes = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
        const audioVideoMimes = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
        const mime = (hasAudio ? audioVideoMimes : videoMimes).find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";

        recordedTracks = [...new Set([...recordedTracks, ...recStream.getTracks()])];

        console.log(`[ClipMeme] recording via ${captureMode}: ${videoTracks.length}v + ${audioTracks.length}a tracks, mime: ${mime}`);

        const chunks = [];
        const activeRecorder = new MediaRecorder(recStream, { mimeType: mime });
        recorder = activeRecorder;
        let finalized = false;
        activeRecorder.ondataavailable = (ev) => { if (ev.data.size > 0) chunks.push(ev.data); };
        activeRecorder.onerror = (ev) => {
          // Let the recorder deliver its final dataavailable/stop before cleanup.
          console.error("[ClipMeme] recorder error:", ev);
        };
        activeRecorder.onstop = async () => {
          if (finalized) return;
          finalized = true;
          finishing = true;
          if (recorder === activeRecorder) recorder = null;
          btn.disabled = true;
          const blob = new Blob(chunks, { type: mime });
          console.log(`[ClipMeme] recorded blob via ${captureMode}: ${blob.size} bytes, ${blob.type || "unknown"}, ${chunks.length} chunks`);
          clearRecordingHooks();
          stopAudioMonitor();
          stopRecordedTracks();
          try {
            await sendClip(blob, btn, timerEl, () => {
              if (captureMode === "element") rememberFlakyElementCapture();
            });
          } finally { finishing = false; }
        };
        activeRecorder.start(200);
        finishing = false;
        watchVideoEnd(activeRecorder);

        // If the player paused itself before we could stop propagation, resume it
        if (video.paused) {
          video.play().catch(() => {});
        }

        let secs = 0;
        timerEl.style.display = "";
        timerEl.textContent = "0s";
        timerInterval = setInterval(() => { timerEl.textContent = `${++secs}s`; }, 1000);

        btn.textContent = "⏹ Stop";
        btn.style.background = "rgba(239,83,80,0.95)";
        btn.disabled = false;
      } catch (err) {
        finishing = false;
        clearRecordingHooks();
        stopAudioMonitor();
        stopRecordedTracks();
        console.error("[ClipMeme] Capture failed:", err.message);
        btn.textContent = "Retry Clip";
        btn.disabled = false;
        timerEl.style.display = "";
        timerEl.textContent = err.message;
        timerEl.style.maxWidth = "280px";
        timerEl.style.whiteSpace = "normal";
        recorder = null;
      } finally { starting = false; }
    } else {
      // ── STOP ───────────────────────────────────
      stopRecording();
    }
  });

  // Also block pointer events on the wrapper from reaching the player
  wrap.addEventListener("pointerdown", (e) => e.stopPropagation());
  wrap.addEventListener("mousedown",   (e) => e.stopPropagation());
}

function isContextInvalidated(e) {
  return e?.message?.includes("Extension context invalidated");
}

async function getBlobHeaderHex(blob, byteCount = 4) {
  const bytes = new Uint8Array(await blob.slice(0, byteCount).arrayBuffer());
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

function isWebMHeaderHex(headerHex) {
  return headerHex === "1a 45 df a3";
}

function isInvalidRecordingError(err) {
  return String(err?.message || "").startsWith("invalid recording:");
}

async function sendClip(blob, btn, timerEl, onInvalidRecording) {
  timerEl.style.display = "none";

  // ── 1. Upload ────────────────────────────────────────────────────────────
  let clipId;
  let uploadStage = "validate recording";
  try {
    btn.textContent = "⏳ Uploading…";
    btn.title = "";

    const headerHex = await getBlobHeaderHex(blob);
    if (!blob.size || !isWebMHeaderHex(headerHex)) {
      throw new Error(`invalid recording: ${blob.size} bytes, ${blob.type || "unknown"}, header ${headerHex || "empty"}`);
    }

    // Read auth token from extension storage (synced by editor-bridge.js when editor is open)
    let authToken = null;
    try {
      const data = await new Promise((resolve, reject) => {
        try { chrome.storage.local.get("clipmeme_auth_token", resolve); }
        catch (e) { reject(e); }
      });
      authToken = data?.clipmeme_auth_token ?? null;
    } catch (e) {
      if (isContextInvalidated(e)) {
        btn.textContent = "↺ Reload page";
        btn.style.background = "rgba(255,152,0,.9)";
        btn.disabled = false;
        btn.onclick = () => location.reload();
        return;
      }
      console.warn("[ClipMeme] Could not read auth token:", e?.message);
    }

    if (!authToken) {
      // Hold the clip — it will auto-upload once the user logs in
      pendingUpload = { blob, btn, timerEl };
      btn.textContent = "🔑 Log in to upload";
      btn.style.background = "rgba(255,152,0,.9)";
      btn.disabled = false;
      chrome.runtime.sendMessage({ type: "OPEN_CLIPMEMEEDITOR", url: `${CLIPMEME_URL}/` });
      return;
    }

    uploadStage = DIRECT_STORAGE_UPLOAD ? "prepare upload" : "relay upload";
    console.info(`[ClipMeme] Upload stage: ${uploadStage}`, { bytes: blob.size });
    const uploadRes = await fetch(`${CLIPMEME_URL}/api/presign`, {
      method: DIRECT_STORAGE_UPLOAD ? "GET" : "POST",
      body: DIRECT_STORAGE_UPLOAD ? undefined : blob,
      headers: { "Content-Type": blob.type || "video/webm", "Authorization": `Bearer ${authToken}` },
    });
    if (!uploadRes.ok) {
      const errorText = await uploadRes.text().catch(() => "");
      if (uploadRes.status === 401) {
        // Token expired — hold the clip and prompt re-login; will auto-retry on token refresh
        chrome.storage.local.remove("clipmeme_auth_token");
        pendingUpload = { blob, btn, timerEl };
        btn.textContent = "🔑 Session expired";
        btn.style.background = "rgba(255,152,0,.9)";
        btn.disabled = false;
        chrome.runtime.sendMessage({ type: "OPEN_CLIPMEMEEDITOR", url: `${CLIPMEME_URL}/` });
        return;
      }
      throw new Error(`upload failed: ${uploadRes.status}${errorText ? ` ${errorText.slice(0, 160)}` : ""}`);
    }
    uploadStage = "read upload ticket";
    const uploadData = await uploadRes.json();
    clipId = uploadData.clipId;
    if (DIRECT_STORAGE_UPLOAD) {
      uploadStage = "storage upload";
      console.info("[ClipMeme] Upload stage: storage upload", { bytes: blob.size, origin: location.origin });
      const stored = await fetch(uploadData.uploadUrl, { method: "PUT", body: blob, headers: { "Content-Type": "video/webm" } });
      if (!stored.ok) throw new Error(`Storage upload failed: ${stored.status}`);
    }
    console.log(`[ClipMeme] uploaded ${DIRECT_STORAGE_UPLOAD ? "directly to storage" : "via relay"}, clipId:`, clipId);
  } catch (err) {
    if (isInvalidRecordingError(err)) {
      onInvalidRecording?.();
      console.warn("[ClipMeme] Recording discarded:", err.message);
      btn.textContent = "⚠ Empty clip";
      btn.style.background = "rgba(255,152,0,.9)";
      setTimeout(() => {
        btn.textContent = "🎬 Clip";
        btn.style.background = "rgba(220,38,38,0.92)";
        btn.disabled = false;
      }, 4000);
      return;
    }

    // Upload itself failed — fall back to downloading the file
    const uploadError = `${uploadStage}: ${err.message}`;
    console.warn("[ClipMeme] Upload failed:", uploadError);
    if (uploadStage === "storage upload" && err.message === "Failed to fetch") {
      console.info("[ClipMeme] Check R2 CORS permits PUT with Content-Type from this origin:", location.origin);
    }
    btn.textContent = `⚠ ${uploadError.slice(0, 30)}`;
    btn.title = uploadError;
    btn.style.background = "rgba(255,152,0,.9)";
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: "clipmeme-capture.webm" }).click();
    setTimeout(() => { btn.textContent = "🎬 Clip"; btn.style.background = "rgba(220,38,38,0.92)"; btn.disabled = false; }, 6000);
    return;
  }

  // ── 2. Open editor tab ───────────────────────────────────────────────────
  btn.textContent = "✓ Done";
  btn.style.background = "rgba(76,175,80,.9)";
  setTimeout(() => { btn.textContent = "🎬 Clip"; btn.style.background = "rgba(220,38,38,0.92)"; btn.disabled = false; }, 3000);

  const editorUrl = `${CLIPMEME_URL}/?clip=${clipId}`;
  try {
    chrome.runtime.sendMessage({ type: "OPEN_CLIPMEMEEDITOR", url: editorUrl });
  } catch (e) {
    // Extension context invalidated after a reload — open the tab directly
    window.open(editorUrl, "_blank");
  }
}
} // end: not editor page

