const BASE_BURN_TIME = 65000; // ms per log
const MAX_VISIBLE_LOGS = 8;
const FUEL_PER_LOG = 24;
const MAX_FUEL = 100;
const FUEL_DECAY = 0.06; // per simulated second
const CHART_WINDOW = 60000; // ms of simulated time
const CHART_SAMPLE_INTERVAL = 200; // ms

const formatSpeed = (value) =>
  Number(value).toFixed(2).replace(/\.?0+$/, "") + "x";

const createCrackleEngine = () => {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const supported = Boolean(AudioContextClass);
  let ctx;
  let gainNode;
  let source;
  let modulationTimer = null;
  let popTimer = null;
  let noiseBuffer;
  let popBuffer;
  let intensity = 0;
  let playing = false;

  const ensureContext = () => {
    if (!supported) return false;
    if (ctx) return true;
    ctx = new AudioContextClass();
    gainNode = ctx.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(ctx.destination);
    const bufferLength = Math.floor(ctx.sampleRate * 1.2);
    noiseBuffer = ctx.createBuffer(1, bufferLength, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferLength; i += 1) {
      data[i] = (Math.random() * 2 - 1) * 0.3;
    }
    const popLength = Math.floor(ctx.sampleRate * 0.08);
    popBuffer = ctx.createBuffer(1, popLength, ctx.sampleRate);
    const popData = popBuffer.getChannelData(0);
    for (let i = 0; i < popLength; i += 1) {
      const attack = Math.min(1, i / (popLength * 0.35));
      const decay = 1 - i / popLength;
      const envelope = Math.pow(attack, 1.5) * Math.pow(decay, 2.4);
      popData[i] = (Math.random() * 2 - 1) * envelope;
    }
    source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    source.connect(gainNode);
    source.start();
    return true;
  };

  const updateGain = () => {
    if (!ctx || !gainNode) return;
    const base = 0.008 + intensity * 0.05;
    const spark =
      Math.random() > 0.75 ? intensity * (0.05 + Math.random() * 0.12) : 0;
    const target = Math.min(0.3, base + spark);
    gainNode.gain.cancelScheduledValues(ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(
      target,
      ctx.currentTime + 0.08
    );
  };

  const triggerPop = () => {
    if (!ctx || !popBuffer) return;
    const popSource = ctx.createBufferSource();
    popSource.buffer = popBuffer;
    const popGain = ctx.createGain();
    const now = ctx.currentTime;
    const burstChance = Math.random();
    const burstBoost =
      burstChance > 0.82 ? 0.2 + intensity * 0.35 : 0;
    const peak = Math.min(1, 0.05 + intensity * 0.3 + burstBoost);
    popGain.gain.setValueAtTime(0, now);
    popGain.gain.linearRampToValueAtTime(peak, now + 0.005);
    popGain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + 0.08
    );
    popSource.connect(popGain);
    popGain.connect(gainNode);
    popSource.start(now);
    popSource.stop(now + 0.09);
  };

  const schedulePop = () => {
    if (!playing) return;
    const interval =
      220 + (1 - intensity) * 550 + Math.random() * 260;
    popTimer = setTimeout(() => {
      triggerPop();
      schedulePop();
    }, interval);
  };

  const refreshModulation = () => {
    if (modulationTimer) {
      clearInterval(modulationTimer);
      modulationTimer = null;
    }
    if (!playing) return;
    modulationTimer = setInterval(updateGain, 120);
  };

  const start = async () => {
    if (!playing && !ensureContext()) {
      return false;
    }
    if (!ctx) return false;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    playing = true;
    refreshModulation();
    if (popTimer) {
      clearTimeout(popTimer);
      popTimer = null;
    }
    schedulePop();
    return true;
  };

  const stop = () => {
    playing = false;
    if (modulationTimer) {
      clearInterval(modulationTimer);
      modulationTimer = null;
    }
    if (popTimer) {
      clearTimeout(popTimer);
      popTimer = null;
    }
    if (ctx && gainNode) {
      gainNode.gain.cancelScheduledValues(ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
    }
    if (ctx && ctx.state === "running") {
      ctx.suspend();
    }
  };

  const setIntensity = (value) => {
    intensity = Math.min(1, Math.max(0, value));
    if (playing) {
      updateGain();
    }
  };

  return {
    start,
    stop,
    setIntensity,
    isPlaying: () => playing,
    supported,
  };
};

const init = () => {
  const logLayer = document.querySelector(".log-layer");
  const addLogButton = document.getElementById("add-log");
  const speedSlider = document.getElementById("time-speed");
  const speedValue = document.getElementById("speed-value");
  const logCountEl = document.getElementById("log-count");
  const emberStatusEl = document.getElementById("ember-status");
  const fuelReadout = document.getElementById("fuel-readout");
  const fuelCanvas = document.getElementById("fuel-chart");
  const audioToggleButton = document.getElementById("toggle-audio");
  const root = document.documentElement;

  if (
    !logLayer ||
    !addLogButton ||
    !speedSlider ||
    !speedValue ||
    !logCountEl ||
    !emberStatusEl ||
    !fuelReadout ||
    !audioToggleButton
  ) {
    return;
  }

  const ctx = fuelCanvas?.getContext("2d");
  const logs = new Map();
  const safeNumber = (value, fallback) =>
    Number.isFinite(value) ? value : fallback;
  const audioEngine = createCrackleEngine();

  let nextLogId = 0;
  let lastFrame = performance.now();
  let timeScale = safeNumber(parseFloat(speedSlider.value), 1);
  let fuelLevel = 0;
  let simTime = 0;
  const fuelHistory = [];
  let chartAccumulator = 0;

  const updateAudioButton = () => {
    const playing = audioEngine.isPlaying();
    audioToggleButton.textContent = playing ? "Stäng av sprak" : "Slå på sprak";
    audioToggleButton.setAttribute("aria-pressed", playing ? "true" : "false");
  };

  if (!audioEngine.supported) {
    audioToggleButton.disabled = true;
    audioToggleButton.textContent = "Ljud stöds ej";
    audioToggleButton.setAttribute("aria-pressed", "false");
  }

  const setTimeScale = (value) => {
    timeScale = value;
    speedValue.textContent = formatSpeed(value);
    root.style.setProperty("--fire-speed", value);
  };

  const updateLogCount = () => {
    logCountEl.textContent = String(logs.size);
  };

  const removeLog = (id) => {
    const log = logs.get(id);
    if (!log) return;
    log.element.remove();
    logs.delete(id);
    updateLogCount();
  };

  const tintLog = (log, ratio) => {
    const warmth = Math.max(0, ratio);
    const startLightness = 18 + warmth * 20;
    const endLightness = 25 + warmth * 25;
    const startColor = `hsl(24, 40%, ${startLightness}%)`;
    const endColor = `hsl(32, 55%, ${endLightness}%)`;
    log.style.background = `linear-gradient(90deg, ${startColor}, ${endColor})`;
  };

  const drawChart = () => {
    if (!ctx || fuelHistory.length < 2) return;
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);

    const windowStart = simTime - CHART_WINDOW;
    const timeRange = CHART_WINDOW;
    const points = fuelHistory
      .filter((point) => point.time >= windowStart)
      .map((point) => {
        const normalized = (point.time - windowStart) / timeRange;
        const clamped = Math.min(1, Math.max(0, normalized));
        return {
          x: clamped * width,
          y: height - (point.value / MAX_FUEL) * height,
        };
      });

    if (points.length === 0) return;

    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "rgba(246, 177, 102, 0.6)");
    gradient.addColorStop(1, "rgba(246, 177, 102, 0)");

    const lastPoint = points[points.length - 1];
    ctx.lineTo(lastPoint.x, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.strokeStyle = "rgba(255, 209, 150, 0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
  };

  const recordFuelSample = () => {
    fuelHistory.push({ time: simTime, value: fuelLevel });
    while (
      fuelHistory.length &&
      fuelHistory[0].time < simTime - CHART_WINDOW
    ) {
      fuelHistory.shift();
    }
    drawChart();
  };

  const syncFuelUI = () => {
    const percent = Math.round((fuelLevel / MAX_FUEL) * 100);
    fuelReadout.textContent = `${Math.max(0, percent)}%`;
    const normalized = Math.min(1, Math.max(0, fuelLevel / MAX_FUEL));
    const widthScale = 0.45 + normalized * 1.2;
    const heightScale = 0.25 + normalized * 1.05;
    const glowScale = 0.5 + normalized * 1.4;
    const emberScale = 0.85 + normalized * 0.9;
    const flameOpacity =
      normalized <= 0.1
        ? normalized * 5 * 0.3
        : Math.min(1, 0.3 + ((normalized - 0.1) / 0.9) * 0.7);
    root.style.setProperty("--flame-scale-x", widthScale.toFixed(2));
    root.style.setProperty("--flame-scale-y", heightScale.toFixed(2));
    root.style.setProperty("--glow-scale", glowScale.toFixed(2));
    root.style.setProperty("--ember-scale", emberScale.toFixed(2));
    root.style.setProperty("--flame-opacity", flameOpacity.toFixed(2));
    audioEngine.setIntensity(normalized);

    let status = "slocknar";
    if (fuelLevel <= 0.5 && logs.size === 0) {
      status = "slocknar";
    } else if (percent < 25) {
      status = "sista glöden";
    } else if (percent < 65) {
      status = "glöder fint";
    } else {
      status = "sprakar varmt";
    }
    emberStatusEl.textContent = status;
  };

  const addFuel = () => {
    fuelLevel = Math.min(MAX_FUEL, fuelLevel + FUEL_PER_LOG);
    syncFuelUI();
    recordFuelSample();
  };

  const updateFuel = (deltaMs) => {
    const deltaSeconds = deltaMs / 1000;
    fuelLevel *= Math.exp(-FUEL_DECAY * deltaSeconds);
    if (fuelLevel < 0.01) {
      fuelLevel = 0;
    }

    chartAccumulator += deltaMs;
    while (chartAccumulator >= CHART_SAMPLE_INTERVAL) {
      chartAccumulator -= CHART_SAMPLE_INTERVAL;
      recordFuelSample();
    }
    syncFuelUI();
  };

  const addLog = () => {
    if (logs.size >= MAX_VISIBLE_LOGS) {
      const [oldestId] = logs.keys();
      removeLog(oldestId);
    }

    const logEl = document.createElement("div");
    logEl.className = "log glowing";
    const offset = (Math.random() - 0.5) * 140;
    const rotation = (Math.random() - 0.5) * 16;
    const baseBottom = 24 + logs.size * 4;
    logEl.style.left = `calc(50% + ${offset}px)`;
    logEl.style.bottom = `${baseBottom}px`;
    logEl.style.transform = `translateX(-50%) rotate(${rotation}deg)`;
    logEl.style.zIndex = String(10 + logs.size);

    const id = ++nextLogId;
    const burnDuration = BASE_BURN_TIME * (0.8 + Math.random() * 0.8);
    logs.set(id, {
      id,
      element: logEl,
      rotation,
      duration: burnDuration,
      remaining: burnDuration,
    });
    logEl.dataset.id = String(id);
    logLayer.appendChild(logEl);
    updateLogCount();
    addFuel();
  };

  const updateLogs = (deltaMs) => {
    logs.forEach((log, id) => {
      log.remaining -= deltaMs;
      const ratio = Math.max(0, log.remaining / log.duration);
      const height = 16 + ratio * 12;
      const width = 70 + ratio * 50;
      log.element.style.width = `${width}px`;
      log.element.style.height = `${height}px`;
      log.element.style.opacity = String(0.4 + ratio * 0.5);
      log.element.style.filter = `drop-shadow(0 0 ${
        10 * ratio
      }px rgba(255, 160, 90, ${0.4 * ratio}))`;
      log.element.classList.toggle("glowing", ratio > 0.35);
      log.element.style.transform = `translateX(-50%) rotate(${
        log.rotation
      }deg) scaleY(${0.85 + ratio * 0.25})`;
      tintLog(log.element, ratio);

      if (log.remaining <= 0) {
        removeLog(id);
      }
    });
  };

  const loop = (now) => {
    const delta = now - lastFrame;
    lastFrame = now;
    const scaledDelta = delta * timeScale;
    simTime += scaledDelta;
    updateLogs(scaledDelta);
    updateFuel(scaledDelta);
    requestAnimationFrame(loop);
  };

  addLogButton.addEventListener("click", addLog);
  audioToggleButton.addEventListener("click", async () => {
    if (!audioEngine.supported) return;
    if (audioEngine.isPlaying()) {
      audioEngine.stop();
      updateAudioButton();
      return;
    }
    const started = await audioEngine.start();
    if (!started) {
      audioToggleButton.disabled = true;
      audioToggleButton.textContent = "Ljud stöds ej";
      audioToggleButton.setAttribute("aria-pressed", "false");
      return;
    }
    updateAudioButton();
  });
  speedSlider.addEventListener("input", (event) => {
    const value = safeNumber(parseFloat(event.target.value), 1);
    setTimeScale(value);
  });

  if (audioEngine.supported) {
    updateAudioButton();
  }
  setTimeScale(timeScale);
  updateLogCount();
  syncFuelUI();
  recordFuelSample();
  addLog();
  addLog();
  recordFuelSample();
  requestAnimationFrame(loop);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
