let activeSession = null;

export async function openCameraCapture(options = {}) {
  if (activeSession) await activeSession.close("A new camera session was opened.");

  const session = createCameraSession(options);
  activeSession = session;
  try {
    return await session.run();
  } finally {
    if (activeSession === session) activeSession = null;
  }
}

export function cameraAvailabilityMessage(environment = globalThis) {
  if (!environment.isSecureContext) return "The in-app camera needs a secure HTTPS connection. Use Photos instead.";
  if (!environment.navigator?.mediaDevices?.getUserMedia) return "This browser does not provide controlled camera capture. Use Photos instead.";
  return "";
}

export function formatCameraDiagnostics(diagnostics = {}) {
  const preview = diagnostics.streamWidth && diagnostics.streamHeight
    ? `Preview ${diagnostics.streamWidth}×${diagnostics.streamHeight}`
    : "Preview resolution unavailable";
  const captured = diagnostics.captureWidth && diagnostics.captureHeight
    ? `captured ${diagnostics.captureWidth}×${diagnostics.captureHeight}`
    : "capture pending";
  const source = diagnostics.source === "image-capture"
    ? "native still photo (maximum resolution requested)"
    : diagnostics.source === "video-frame" ? "video-frame fallback" : "camera preview";
  return `${preview}; ${captured}; ${source}; ${lightStatusLabel(diagnostics)}.`;
}

export function lightStatusLabel(diagnostics = {}) {
  if (diagnostics.torchObserved === true) return "torch confirmed active";
  if (diagnostics.fillLightModeRequested && diagnostics.fillLightModeSupported) return "still-photo flash requested (browser cannot confirm firing)";
  if (diagnostics.lightRequested && diagnostics.fillLightModeSupported) return "still-photo flash ready";
  if (diagnostics.torchRequested && diagnostics.torchApplied) return "torch requested (browser did not confirm it active)";
  if (diagnostics.torchRequested && diagnostics.torchRejected) return "torch request rejected";
  if (diagnostics.lightRequested && !diagnostics.torchSupported && !diagnostics.fillLightModeSupported) return "flash/torch unsupported";
  return "flash/torch off";
}

function createCameraSession(options) {
  let stream = null;
  let track = null;
  let imageCapture = null;
  let root = null;
  let video = null;
  let status = null;
  let captureButton = null;
  let lightButton = null;
  let settled = false;
  let resolveResult;
  let completionPromise = null;
  let generation = 1;
  let lightRequested = true;
  let photoCapabilities = null;
  let lightMode = "unsupported";
  let fallbackUsed = false;
  const invokingElement = options.invoker || document.activeElement;
  const diagnostics = {
    source: "",
    streamWidth: 0,
    streamHeight: 0,
    captureWidth: 0,
    captureHeight: 0,
    facingMode: "",
    rearCameraRequested: true,
    imageCaptureSupported: false,
    torchSupported: false,
    torchRequested: false,
    torchApplied: false,
    torchObserved: false,
    torchRejected: false,
    fillLightModeRequested: false,
    fillLightModeSupported: false,
    fallbackReason: "",
    lightRequested: true,
  };

  function run() {
    const unavailable = cameraAvailabilityMessage(window);
    if (unavailable) {
      options.onStatus?.(unavailable);
      options.onFallback?.();
      return Promise.resolve(null);
    }
    mountDialog();
    completionPromise = new Promise((resolve) => { resolveResult = resolve; });
    startCamera(generation);
    return completionPromise;
  }

  function mountDialog() {
    root = document.createElement("dialog");
    root.className = "cameraCaptureDialog";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "cameraCaptureTitle");
    root.setAttribute("aria-describedby", "cameraCaptureStatus");
    root.innerHTML = `
      <div class="cameraCapturePanel">
        <div class="cameraCaptureHeader">
          <h2 id="cameraCaptureTitle">Take a sticker photo</h2>
          <button type="button" class="cameraCaptureClose secondary" aria-label="Close camera">Close</button>
        </div>
        <video class="cameraCapturePreview" autoplay playsinline muted></video>
        <p id="cameraCaptureStatus" class="cameraCaptureStatus" role="status" aria-live="polite">Starting rear camera…</p>
        <div class="cameraCaptureActions">
          <button type="button" class="cameraLightButton" aria-pressed="true">Light: requested</button>
          <button type="button" class="cameraTakeButton" disabled>Take photo</button>
          <button type="button" class="cameraFallbackButton secondary">Use Photos</button>
        </div>
      </div>`;
    document.body.append(root);
    if (typeof root.showModal === "function") root.showModal();
    video = root.querySelector("video");
    status = root.querySelector(".cameraCaptureStatus");
    captureButton = root.querySelector(".cameraTakeButton");
    lightButton = root.querySelector(".cameraLightButton");
    root.querySelector(".cameraCaptureClose").addEventListener("click", () => finish(null));
    root.querySelector(".cameraFallbackButton").addEventListener("click", () => {
      fallbackUsed = true;
      stopStream(stream);
      if (video) video.srcObject = null;
      options.onFallback?.();
      finish(null, { restoreFocus: false });
    });
    captureButton.addEventListener("click", capture);
    lightButton.addEventListener("click", toggleLight);
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish(null);
      if (event.key === "Tab") containFocus(event);
    });
    root.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    window.addEventListener("pagehide", closeForNavigation, { once: true });
    document.addEventListener("visibilitychange", closeWhenHidden);
    root.querySelector(".cameraCaptureClose").focus();
  }

  async function startCamera(token) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 4096 },
          height: { ideal: 3072 },
        },
      });
      if (token !== generation || settled) return stopStream(stream);
      track = stream.getVideoTracks()[0];
      await applyMaximumResolution(track);
      if (token !== generation || settled) return;
      video.srcObject = stream;
      await video.play();
      await waitForVideoDimensions(video);
      updateSettings();
      const ImageCaptureClass = window.ImageCapture;
      diagnostics.imageCaptureSupported = typeof ImageCaptureClass === "function";
      if (diagnostics.imageCaptureSupported) {
        try { imageCapture = new ImageCaptureClass(track); } catch { imageCapture = null; }
      }
      await inspectLightCapabilities();
      if (!isCurrent(token)) return;
      if (lightRequested && lightMode === "torch") await requestTorch(true);
      if (!isCurrent(token)) return;
      captureButton.disabled = false;
      updateStatus();
    } catch (error) {
      if (!isCurrent(token)) return;
      diagnostics.fallbackReason = error instanceof Error ? error.message : "Camera could not be opened.";
      showStatus(`Camera unavailable: ${friendlyCameraError(error)} Use Photos instead.`);
      lightButton.disabled = true;
      captureButton.disabled = true;
    }
  }

  async function applyMaximumResolution(videoTrack) {
    const capabilities = safeCapabilities(videoTrack);
    const advanced = {};
    if (Number.isFinite(capabilities.width?.max)) advanced.width = capabilities.width.max;
    if (Number.isFinite(capabilities.height?.max)) advanced.height = capabilities.height.max;
    if (Array.isArray(capabilities.resizeMode) && capabilities.resizeMode.includes("none")) advanced.resizeMode = "none";
    if (!Object.keys(advanced).length) return;
    try {
      await videoTrack.applyConstraints({ advanced: [advanced] });
    } catch {
      delete advanced.resizeMode;
      if (Object.keys(advanced).length) {
        try { await videoTrack.applyConstraints({ advanced: [advanced] }); } catch { /* keep initial stream */ }
      }
    }
  }

  async function inspectLightCapabilities() {
    const capabilities = safeCapabilities(track);
    diagnostics.torchSupported = capabilities.torch === true || (Array.isArray(capabilities.torch) && capabilities.torch.includes(true));
    diagnostics.fillLightModeSupported = Array.isArray(capabilities.fillLightMode) && capabilities.fillLightMode.includes("flash");
    if (imageCapture?.getPhotoCapabilities) {
      try { photoCapabilities = await imageCapture.getPhotoCapabilities(); } catch { photoCapabilities = null; }
      const fillModes = photoCapabilities?.fillLightMode || [];
      diagnostics.fillLightModeSupported ||= Array.isArray(fillModes) && fillModes.includes("flash");
    }
    lightMode = diagnostics.fillLightModeSupported ? "fill-light" : diagnostics.torchSupported ? "torch" : "unsupported";
  }

  async function toggleLight() {
    const token = generation;
    lightRequested = !lightRequested;
    diagnostics.lightRequested = lightRequested;
    lightButton.setAttribute("aria-pressed", String(lightRequested));
    lightButton.textContent = lightRequested ? "Light: requested" : "Light: off";
    if (!lightRequested || lightMode === "torch") await requestTorch(lightRequested);
    if (!isCurrent(token)) return;
    updateStatus();
  }

  async function requestTorch(enabled) {
    diagnostics.torchRequested = enabled;
    diagnostics.torchApplied = false;
    diagnostics.torchObserved = false;
    diagnostics.torchRejected = false;
    if (!track || !diagnostics.torchSupported) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: enabled }] });
      diagnostics.torchApplied = enabled;
      diagnostics.torchObserved = track.getSettings?.().torch === enabled && enabled;
      if (enabled) await delay(300);
    } catch {
      diagnostics.torchRejected = enabled;
    }
  }

  async function capture() {
    const token = generation;
    captureButton.disabled = true;
    showStatus("Taking photo…");
    try {
      let blob;
      if (imageCapture?.takePhoto) {
        try {
          const settings = photoSettings(photoCapabilities, lightRequested && lightMode === "fill-light");
          diagnostics.fillLightModeRequested = settings.fillLightMode === "flash";
          if (diagnostics.fillLightModeRequested) diagnostics.fillLightModeSupported = true;
          blob = await imageCapture.takePhoto(settings);
          if (!isCurrent(token)) return;
          diagnostics.source = "image-capture";
        } catch (error) {
          if (!isCurrent(token)) return;
          diagnostics.fallbackReason = `Requested still settings failed: ${error instanceof Error ? error.message : "unknown error"}`;
          diagnostics.fillLightModeRequested = false;
          try {
            blob = await imageCapture.takePhoto();
            if (!isCurrent(token)) return;
            diagnostics.source = "image-capture";
          } catch (retryError) {
            if (!isCurrent(token)) return;
            diagnostics.fallbackReason = `Full-resolution still failed: ${retryError instanceof Error ? retryError.message : "unknown error"}`;
            blob = await canvasFrame(video);
            if (!isCurrent(token)) return;
            diagnostics.source = "video-frame";
          }
        }
      } else {
        diagnostics.fallbackReason = "ImageCapture is unavailable; used the camera preview frame.";
        blob = await canvasFrame(video);
        if (!isCurrent(token)) return;
        diagnostics.source = "video-frame";
      }
      const dimensions = await imageDimensions(blob);
      if (!isCurrent(token)) return;
      diagnostics.captureWidth = dimensions.width;
      diagnostics.captureHeight = dimensions.height;
      updateSettings();
      const file = new File([blob], `sticker-camera-${Date.now()}.${blob.type === "image/png" ? "png" : "jpg"}`, {
        type: blob.type || "image/jpeg",
        lastModified: Date.now(),
      });
      finish({ file, diagnostics: { ...diagnostics }, summary: formatCameraDiagnostics(diagnostics) });
    } catch (error) {
      if (!isCurrent(token)) return;
      diagnostics.fallbackReason = error instanceof Error ? error.message : "Photo capture failed.";
      showStatus(`Photo capture failed: ${diagnostics.fallbackReason} Try again or use Photos.`);
      captureButton.disabled = false;
    }
  }

  function updateSettings() {
    const settings = track?.getSettings?.() || {};
    diagnostics.streamWidth = Number(video?.videoWidth || settings.width || 0);
    diagnostics.streamHeight = Number(video?.videoHeight || settings.height || 0);
    diagnostics.facingMode = String(settings.facingMode || "");
    diagnostics.torchObserved = diagnostics.torchRequested && settings.torch === true;
  }

  function updateStatus() {
    updateSettings();
    showStatus(formatCameraDiagnostics(diagnostics));
  }

  function showStatus(message) {
    if (settled) return;
    if (status) status.textContent = message;
    options.onStatus?.(message);
  }

  async function cleanup({ restoreFocus = true } = {}) {
    generation += 1;
    window.removeEventListener("pagehide", closeForNavigation);
    document.removeEventListener("visibilitychange", closeWhenHidden);
    let torchReset = null;
    if (track && diagnostics.torchSupported) {
      try { torchReset = track.applyConstraints({ advanced: [{ torch: false }] }); } catch { /* best effort */ }
    }
    stopStream(stream);
    if (video) video.srcObject = null;
    try { await torchReset; } catch { /* best effort */ }
    root?.remove();
    if (restoreFocus && !fallbackUsed) invokingElement?.focus?.();
  }

  function finish(value, finishOptions = {}) {
    if (settled) return;
    settled = true;
    cleanup(finishOptions).finally(() => {
      resolveResult?.(value);
    });
    return completionPromise || Promise.resolve(value);
  }

  function close(reason) {
    diagnostics.fallbackReason = reason;
    return finish(null) || completionPromise || Promise.resolve(null);
  }

  function closeForNavigation() { finish(null); }
  function closeWhenHidden() {
    if (document.visibilityState === "hidden") finish(null);
  }

  function isCurrent(token) {
    return !settled && token === generation;
  }

  function containFocus(event) {
    const controls = [...root.querySelectorAll("button:not([disabled])")];
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return { run, close };
}

function photoSettings(capabilities, lightRequested) {
  const settings = {};
  if (Number.isFinite(capabilities?.imageWidth?.max)) settings.imageWidth = capabilities.imageWidth.max;
  if (Number.isFinite(capabilities?.imageHeight?.max)) settings.imageHeight = capabilities.imageHeight.max;
  if (lightRequested && capabilities?.fillLightMode?.includes?.("flash")) settings.fillLightMode = "flash";
  return settings;
}

function safeCapabilities(track) {
  try { return track?.getCapabilities?.() || {}; } catch { return {}; }
}

function stopStream(stream) {
  for (const mediaTrack of stream?.getTracks?.() || []) mediaTrack.stop();
}

function waitForVideoDimensions(video) {
  if (video.videoWidth && video.videoHeight) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener("loadedmetadata", done); resolve(); };
    video.addEventListener("loadedmetadata", done, { once: true });
    window.setTimeout(done, 1500);
  });
}

function canvasFrame(video) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return Promise.reject(new Error("The camera preview is not ready."));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(video, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("The browser could not encode the camera frame.")),
    "image/jpeg",
    0.97,
  ));
}

async function imageDimensions(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("The captured image could not be decoded."));
      image.src = url;
    });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function friendlyCameraError(error) {
  if (error?.name === "NotAllowedError") return "Camera permission was denied.";
  if (error?.name === "NotFoundError") return "No camera was found.";
  if (error?.name === "NotReadableError") return "The camera is already in use.";
  return error instanceof Error ? error.message : "The camera could not be opened.";
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
