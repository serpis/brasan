const BASE_BURN_TIME = 65000; // ms per log
const MAX_VISIBLE_LOGS = 8;
const FUEL_PER_LOG = 24;
const MAX_FUEL = 100;
const FUEL_DECAY = 0.06; // per simulated second
const CHART_WINDOW = 60000; // ms of simulated time
const CHART_SAMPLE_INTERVAL = 200; // ms
const BUY_WOOD_COST = 8;
const BUY_WOOD_AMOUNT = 3;
const BUY_WOOD_COOLDOWN = 7000;
const WORK_PAYOUT = 6;
const WORK_COOLDOWN = 8000;
const MAX_WOOD_VISUAL = 18;
const ADD_LOG_COOLDOWN = 900; // ms
const BUY_FOOD_COST = 10;
const BUY_FOOD_COOLDOWN = 6000;
const FOOD_AMOUNT = 2;
const EAT_COOLDOWN = 4000;
const CHOP_PAYOUT = 2;
const CHOP_COOLDOWN = 9000;
const ENERGY_MAX = 100;
const ENERGY_DECAY_PER_SEC = 3;
const ENERGY_EAT_BOOST = 40;
const ENERGY_SLOW_FACTOR = 0.35;
const BASE_ACTION_COST = 0.5;

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
  let highPass;
  let lowPass;
  let intensity = 0;
  let playing = false;

  const ensureContext = () => {
    if (!supported) return false;
    if (ctx) return true;
    ctx = new AudioContextClass();
    gainNode = ctx.createGain();
    gainNode.gain.value = 0;
    highPass = ctx.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = 450;
    lowPass = ctx.createBiquadFilter();
    lowPass.type = "lowpass";
    lowPass.frequency.value = 4200;
    highPass.connect(lowPass);
    lowPass.connect(gainNode);
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
    source.connect(highPass);
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
    popGain.connect(highPass);
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
  const woodCountEl = document.getElementById("wood-count");
  const coinCountEl = document.getElementById("coin-count");
  const foodCountEl = document.getElementById("food-count");
  const coinIconsEl = document.getElementById("coin-icons");
  const foodIconsEl = document.getElementById("food-icons");
  const woodIconsEl = document.getElementById("wood-icons");
  const energyFillEl = document.getElementById("energy-fill");
  const energyTextEl = document.getElementById("energy-text");
  const buyButton = document.getElementById("buy-wood");
  const buyFoodButton = document.getElementById("buy-food");
  const workButton = document.getElementById("work");
  const eatButton = document.getElementById("eat");
  const chopButton = document.getElementById("chop");
  const metaBuyWood = document.getElementById("meta-buy-wood");
  const metaBuyFood = document.getElementById("meta-buy-food");
  const metaWork = document.getElementById("meta-work");
  const metaEat = document.getElementById("meta-eat");
  const metaChop = document.getElementById("meta-chop");
  const workerEl = document.getElementById("worker");
  const workerStatusEl = document.getElementById("worker-status");
  const woodPileEl = document.getElementById("woodpile-visual");
  const root = document.documentElement;

  if (
    !logLayer ||
    !addLogButton ||
    !speedSlider ||
    !speedValue ||
    !logCountEl ||
    !emberStatusEl ||
    !fuelReadout ||
    !audioToggleButton ||
    !woodCountEl ||
    !coinCountEl ||
    !foodCountEl ||
    !coinIconsEl ||
    !foodIconsEl ||
    !woodIconsEl ||
    !energyFillEl ||
    !energyTextEl ||
    !buyButton ||
    !buyFoodButton ||
    !workButton ||
    !eatButton ||
    !chopButton ||
    !workerEl ||
    !workerStatusEl ||
    !woodPileEl
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
  let woodStock = 6;
  let coins = 20;
  let foodStock = 3;
  let energy = 80;
  let buyCooldown = 0;
  let buyFoodCooldown = 0;
  let workCooldown = 0;
  let eatCooldown = 0;
  let chopCooldown = 0;
  let workActive = false;
  let chopActive = false;
  let buyPending = false;
  let buyFoodPending = false;
  let eatPending = false;
  let chopPending = false;
  let addLogCooldown = 0;

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

  const renderWoodPile = () => {
    // Woodpile visual now lives in the resource card, not in the fireplace box.
    woodIconsEl.innerHTML = "";
    const visible = Math.min(MAX_WOOD_VISUAL, woodStock);
    for (let i = 0; i < visible; i += 1) {
      const piece = document.createElement("div");
      piece.className = "wood-icon";
      woodIconsEl.appendChild(piece);
    }
  };

const setTimeScale = (value) => {
  timeScale = value;
  speedValue.textContent = formatSpeed(value);
  root.style.setProperty("--fire-speed", value);
  updateMeta();
};

  const updateMoneyUI = () => {
    coinCountEl.textContent = String(coins);
    coinIconsEl.innerHTML = "";
    const coinsVisible = Math.min(12, coins);
    for (let i = 0; i < coinsVisible; i += 1) {
      const coin = document.createElement("div");
      coin.className = "coin";
      coinIconsEl.appendChild(coin);
    }
  };

  const updateWoodUI = () => {
    woodCountEl.textContent = String(woodStock);
    addLogButton.disabled = woodStock <= 0 || addLogCooldown > 0;
    renderWoodPile();
  };

  const updateFoodUI = () => {
    foodCountEl.textContent = String(foodStock);
    foodIconsEl.innerHTML = "";
    const steaksVisible = Math.min(10, foodStock);
    for (let i = 0; i < steaksVisible; i += 1) {
      const steak = document.createElement("div");
      steak.className = "steak";
      foodIconsEl.appendChild(steak);
    }
  };

  const updateEnergyUI = () => {
    const pct = Math.max(0, Math.min(100, Math.round(energy)));
    energyTextEl.textContent = `${pct}%`;
    energyFillEl.style.width = `${pct}%`;
    if (pct < 25) {
      energyFillEl.style.background = "linear-gradient(90deg, #ff9b7a, #ffcc7a)";
    } else {
      energyFillEl.style.background = "linear-gradient(90deg, #8af48f, #d6ffa8)";
    }
    updateMeta();
  };

  const getEnergyFactor = () =>
    Math.max(ENERGY_SLOW_FACTOR, Math.min(1, energy / ENERGY_MAX));

  const spendEnergy = (amount) => {
    energy = Math.max(0, energy - (amount + BASE_ACTION_COST));
    updateEnergyUI();
  };

  const gainEnergy = (amount) => {
    energy = Math.min(ENERGY_MAX, energy + amount);
    updateEnergyUI();
  };

  const formatSeconds = (ms) => `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}s`;

  const effectiveDuration = (baseMs) =>
    baseMs / (timeScale * getEnergyFactor());

  const updateMeta = () => {
    if (metaBuyWood) {
      metaBuyWood.textContent = `-8 kr · +3 ved · ${formatSeconds(
        effectiveDuration(BUY_WOOD_COOLDOWN)
      )}`;
    }
    if (metaBuyFood) {
      metaBuyFood.textContent = `-10 kr · +2 mat · ${formatSeconds(
        effectiveDuration(BUY_FOOD_COOLDOWN)
      )}`;
    }
    if (metaWork) {
      metaWork.textContent = `-energi · +6 kr · ${formatSeconds(
        effectiveDuration(WORK_COOLDOWN)
      )}`;
    }
    if (metaEat) {
      metaEat.textContent = `-1 mat · +energi · ${formatSeconds(
        effectiveDuration(EAT_COOLDOWN)
      )}`;
    }
    if (metaChop) {
      metaChop.textContent = `-energi · +${CHOP_PAYOUT} ved · ${formatSeconds(
        effectiveDuration(CHOP_COOLDOWN)
      )}`;
    }
  };

  const applyCooldownVisual = (button, remaining, total, factor = 1) => {
    const scaledTotal = total / factor;
    const scaledRemaining = remaining / factor;
    const fraction =
      scaledRemaining > 0 && scaledTotal > 0
        ? scaledRemaining / scaledTotal
        : 0;
    button.classList.toggle("cooling", remaining > 0);
    button.style.setProperty("--cooldown", fraction.toFixed(3));
    const textEl = button.querySelector(".cooldown-text");
    if (textEl) {
      textEl.textContent =
        scaledRemaining > 0 ? `${(scaledRemaining / 1000).toFixed(1)}s` : "";
    }
  };

  const updateActionStates = () => {
    const factorGeneral = timeScale * getEnergyFactor();
    const factorEat = timeScale; // äta ska inte gå långsammare vid låg energi
    applyCooldownVisual(
      buyButton,
      buyCooldown,
      BUY_WOOD_COOLDOWN,
      factorGeneral
    );
    applyCooldownVisual(
      buyFoodButton,
      buyFoodCooldown,
      BUY_FOOD_COOLDOWN,
      factorGeneral
    );
    applyCooldownVisual(
      workButton,
      workCooldown,
      WORK_COOLDOWN,
      factorGeneral
    );
    applyCooldownVisual(eatButton, eatCooldown, EAT_COOLDOWN, factorEat);
    applyCooldownVisual(
      chopButton,
      chopCooldown,
      CHOP_COOLDOWN,
      factorGeneral
    );
    applyCooldownVisual(
      addLogButton,
      addLogCooldown,
      ADD_LOG_COOLDOWN,
      factorGeneral
    );
    buyButton.disabled = coins < BUY_WOOD_COST || buyCooldown > 0;
    buyFoodButton.disabled = coins < BUY_FOOD_COST || buyFoodCooldown > 0;
    workButton.disabled = workCooldown > 0 || energy <= 5;
    eatButton.disabled = eatCooldown > 0 || foodStock <= 0;
    chopButton.disabled = chopCooldown > 0 || energy <= 8;
    addLogButton.disabled = woodStock <= 0 || addLogCooldown > 0;
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

  const setWorkerMode = (mode) => {
    workerEl.classList.toggle("working", mode === "work");
    workerEl.classList.toggle("chopping", mode === "chop");
    if (mode === "work") {
      workerStatusEl.textContent = "jobbar...";
    } else if (mode === "chop") {
      workerStatusEl.textContent = "hugger ved...";
    } else {
      workerStatusEl.textContent = "redo";
    }
  };

  const finishWork = () => {
    if (!workActive) return;
    workActive = false;
    coins += WORK_PAYOUT;
    updateMoneyUI();
    updateActionStates();
    setWorkerMode("idle");
  };

  const buyFood = () => {
    if (buyFoodCooldown > 0 || coins < BUY_FOOD_COST) return;
    buyFoodCooldown = BUY_FOOD_COOLDOWN;
    coins -= BUY_FOOD_COST;
    updateMoneyUI();
    spendEnergy(3);
    updateActionStates();
    buyFoodPending = true;
  };

  const eatFood = () => {
    if (eatCooldown > 0 || foodStock <= 0) return;
    eatCooldown = EAT_COOLDOWN;
    foodStock -= 1;
    updateFoodUI();
    updateActionStates();
    eatPending = true;
  };

  const tickCooldowns = (deltaReal) => {
    const factorGeneral = timeScale * getEnergyFactor();
    const factorEat = timeScale;
    const applyTick = (value, factor) =>
      Math.max(0, value - deltaReal * factor);

    const prevBuy = buyCooldown;
    const prevBuyFood = buyFoodCooldown;
    const prevWork = workCooldown;
    const prevEat = eatCooldown;
    const prevChop = chopCooldown;

    buyCooldown = applyTick(buyCooldown, factorGeneral);
    buyFoodCooldown = applyTick(buyFoodCooldown, factorGeneral);
    workCooldown = applyTick(workCooldown, factorGeneral);
    eatCooldown = applyTick(eatCooldown, factorEat);
    chopCooldown = applyTick(chopCooldown, factorGeneral);
    addLogCooldown = applyTick(addLogCooldown, factorGeneral);

    if (buyPending && buyCooldown === 0 && prevBuy > 0) {
      buyPending = false;
      woodStock += BUY_WOOD_AMOUNT;
      updateWoodUI();
      woodPileEl.classList.add("restock");
      setTimeout(() => woodPileEl.classList.remove("restock"), 420);
    }
    if (buyFoodPending && buyFoodCooldown === 0 && prevBuyFood > 0) {
      buyFoodPending = false;
      foodStock += FOOD_AMOUNT;
      updateFoodUI();
    }
    if (workActive && workCooldown === 0 && prevWork > 0) {
      finishWork();
    }
    if (eatPending && eatCooldown === 0 && prevEat > 0) {
      eatPending = false;
      gainEnergy(ENERGY_EAT_BOOST);
    }
    if (chopPending && chopCooldown === 0 && prevChop > 0) {
      chopPending = false;
      chopActive = false;
      woodStock += CHOP_PAYOUT;
      updateWoodUI();
      setWorkerMode("idle");
    }

    updateActionStates();
  };

  const addLog = () => {
    if (woodStock <= 0 || addLogCooldown > 0) {
      return;
    }
    addLogCooldown = ADD_LOG_COOLDOWN;
    updateActionStates();
    spendEnergy(2);
    woodStock -= 1;
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
    updateWoodUI();
    updateActionStates();
    addFuel();
  };

  const buyWood = () => {
    if (buyCooldown > 0 || coins < BUY_WOOD_COST) return;
    buyCooldown = BUY_WOOD_COOLDOWN;
    coins -= BUY_WOOD_COST;
    updateMoneyUI();
    updateActionStates();
    spendEnergy(4);
    buyPending = true;
  };

  const startWork = () => {
    if (workCooldown > 0) return;
    workCooldown = WORK_COOLDOWN;
    workActive = true;
    setWorkerMode("work");
    updateActionStates();
    spendEnergy(12);
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
    const deltaReal = now - lastFrame;
    lastFrame = now;
    const scaledDelta = deltaReal * timeScale * getEnergyFactor();
    simTime += scaledDelta;
    updateLogs(scaledDelta);
    updateFuel(scaledDelta);
    tickCooldowns(deltaReal);

    if (energy > 0) {
      energy = Math.max(
        0,
        energy - (ENERGY_DECAY_PER_SEC * scaledDelta) / 1000
      );
      updateEnergyUI();
      updateActionStates();
    }
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
  buyButton.addEventListener("click", buyWood);
  buyFoodButton.addEventListener("click", buyFood);
  workButton.addEventListener("click", startWork);
  eatButton.addEventListener("click", eatFood);
  chopButton.addEventListener("click", () => {
    if (chopCooldown > 0) return;
    chopCooldown = CHOP_COOLDOWN;
    chopPending = true;
    chopActive = true;
    setWorkerMode("chop");
    spendEnergy(9);
    updateActionStates();
  });
  speedSlider.addEventListener("input", (event) => {
    const value = safeNumber(parseFloat(event.target.value), 1);
    setTimeScale(value);
    updateMeta();
  });

  if (audioEngine.supported) {
    updateAudioButton();
  }
  setTimeScale(timeScale);
  updateMeta();
  updateLogCount();
  updateWoodUI();
  updateFoodUI();
  updateMoneyUI();
  updateEnergyUI();
  updateActionStates();
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
