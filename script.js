/* ============================================================
   LINHA 7 — script.js
   Jogo de linha de produção controlado por gestos de mão,
   usando MediaPipe Tasks Vision (HandLandmarker).
   ============================================================ */

import {
  HandLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

/* ------------------------------------------------------------
   1. REFERÊNCIAS DE DOM
   ------------------------------------------------------------ */
const startScreen      = document.getElementById("start-screen");
const gameScreen       = document.getElementById("game-screen");
const gameoverScreen   = document.getElementById("gameover-screen");

const startBtn         = document.getElementById("start-btn");
const restartBtn       = document.getElementById("restart-btn");
const startError       = document.getElementById("start-error");

const statusDotStart   = document.getElementById("status-dot-start");
const cameraCheckText  = document.getElementById("camera-check-text");
const statusDotGame    = document.getElementById("status-dot-game");
const cameraStatusText = document.getElementById("camera-status-text");

const scoreValueEl     = document.getElementById("score-value");
const levelValueEl     = document.getElementById("level-value");
const comboValueEl     = document.getElementById("combo-value");
const livesValueEl     = document.getElementById("lives-value");

const gameArea         = document.getElementById("game-area");
const conveyor         = document.getElementById("conveyor");
const productsLayer    = document.getElementById("products-layer");
const handCursor       = document.getElementById("hand-cursor");
const levelUpToast     = document.getElementById("level-up-toast");
const levelUpNumber    = document.getElementById("level-up-number");

const webcamVideo      = document.getElementById("webcam");
const landmarkCanvas   = document.getElementById("landmark-canvas");
const landmarkCtx      = landmarkCanvas.getContext("2d");

const finalScoreEl     = document.getElementById("final-score");
const finalLevelEl     = document.getElementById("final-level");
const finalComboEl     = document.getElementById("final-combo");

/* ------------------------------------------------------------
   2. ESTADO DO JOGO
   ------------------------------------------------------------ */
const state = {
  running: false,
  score: 0,
  level: 1,
  combo: 0,
  bestCombo: 0,
  lives: 3,

  beltSpeed: 90,
  spawnInterval: 1500,
  damagedChance: 0.35,

  lastSpawn: 0,
  products: [],
  nextProductId: 1,
};

const LEVEL_THRESHOLDS = [0, 80, 200, 380, 620, 920, 1300, 1750, 2300, 3000];

/* ------------------------------------------------------------
   3. ÁUDIO
   ------------------------------------------------------------ */
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function playTone(freq, duration, type = "sine", gainStart = 0.18) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = gainStart;
  osc.connect(gain).connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.start(now);
  osc.stop(now + duration);
}

function sfxCorrect() {
  playTone(660, 0.12, "triangle");
  setTimeout(() => playTone(880, 0.15, "triangle"), 70);
}
function sfxWrong() {
  playTone(160, 0.28, "sawtooth", 0.15);
}
function sfxLevelUp() {
  [523, 659, 784, 1046].forEach((f, i) =>
    setTimeout(() => playTone(f, 0.18, "square", 0.12), i * 90)
  );
}
function sfxMiss() {
  playTone(220, 0.1, "sine", 0.06);
}

/* ------------------------------------------------------------
   4. RASTREAMENTO DE MÃO (MediaPipe)
   ------------------------------------------------------------ */
let handLandmarker = null;
let webcamStream = null;
let lastVideoTime = -1;
let latestHandLandmarks = null;
let framesSinceHandSeen = 0;
const HAND_LOST_TOLERANCE = 15;

let handIsClosed = false;
let grabJustTriggered = false;

// Mão sobre a esteira
let handOnBeltTime = 0;
const HAND_ON_BELT_LIMIT = 10;
let beltWarningEl = null;

async function initHandTracking() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
}

async function startWebcam() {
  webcamStream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" },
    audio: false
  });
  webcamVideo.srcObject = webcamStream;
  await new Promise((resolve) => {
    webcamVideo.onloadedmetadata = () => {
      webcamVideo.play();
      resolve();
    };
  });
}

function stopWebcam() {
  if (webcamStream) {
    webcamStream.getTracks().forEach((t) => t.stop());
    webcamStream = null;
  }
}

function isHandClosed(landmarks) {
  const wrist = landmarks[0];
  const palmRef = landmarks[9];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const palmSize = dist(wrist, palmRef) || 0.0001;

  const fingerTips = [4, 8, 12, 16, 20];
  const avgTipDist =
    fingerTips.reduce((sum, i) => sum + dist(landmarks[i], wrist), 0) /
    fingerTips.length;

  return avgTipDist / palmSize < 1.55;
}

function palmCenter(landmarks) {
  const idxs = [0, 5, 9, 13, 17];
  let x = 0, y = 0;
  idxs.forEach((i) => { x += landmarks[i].x; y += landmarks[i].y; });
  return { x: x / idxs.length, y: y / idxs.length };
}

function detectionLoop() {
  if (!state.running && webcamStream === null) return;

  if (handLandmarker && webcamVideo.readyState >= 2) {
    if (webcamVideo.currentTime !== lastVideoTime) {
      lastVideoTime = webcamVideo.currentTime;
      const result = handLandmarker.detectForVideo(webcamVideo, performance.now());

      if (result.landmarks && result.landmarks.length > 0) {
        latestHandLandmarks = result.landmarks[0];
        framesSinceHandSeen = 0;
        setCameraStatus("ok", "Mão detectada");

        const closedNow = isHandClosed(latestHandLandmarks);
        grabJustTriggered = closedNow && !handIsClosed;
        handIsClosed = closedNow;
      } else {
        framesSinceHandSeen++;
        if (framesSinceHandSeen > HAND_LOST_TOLERANCE) {
          latestHandLandmarks = null;
          setCameraStatus("bad", "Procurando mão…");
        }
        grabJustTriggered = false;
      }

      drawLandmarks(result.landmarks && result.landmarks[0]);
    }
  }

  requestAnimationFrame(detectionLoop);
}

function drawLandmarks(landmarks) {
  const w = landmarkCanvas.width, h = landmarkCanvas.height;
  landmarkCtx.clearRect(0, 0, w, h);
  if (!landmarks) return;

  landmarkCtx.fillStyle = handIsClosed ? "#3ddc84" : "#ffc233";
  landmarks.forEach((lm) => {
    landmarkCtx.beginPath();
    landmarkCtx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2);
    landmarkCtx.fill();
  });
}

function setCameraStatus(kind, text) {
  [statusDotStart, statusDotGame].forEach((dot) => {
    dot.classList.remove("ok", "bad", "pending");
    dot.classList.add(kind);
  });
  cameraCheckText.textContent = text;
  cameraStatusText.textContent = text;
}

/* ------------------------------------------------------------
   5. CURSOR DA MÃO
   ------------------------------------------------------------ */
function updateHandCursor() {
  if (!latestHandLandmarks) {
    handCursor.classList.add("hidden");
    return null;
  }
  handCursor.classList.remove("hidden");

  const rect = gameArea.getBoundingClientRect();
  const center = palmCenter(latestHandLandmarks);

  const x = (1 - center.x) * rect.width;
  const y = center.y * rect.height;

  handCursor.style.transform = `translate(${x}px, ${y}px)`;
  handCursor.classList.toggle("grabbing", handIsClosed);

  return { x, y };
}

/* ------------------------------------------------------------
   6. MÃO SOBRE A ESTEIRA
   ------------------------------------------------------------ */
function showBeltWarning() {
  if (beltWarningEl) return;

  beltWarningEl = document.createElement("div");
  beltWarningEl.textContent = "⚠ RETIRE A MÃO DA ESTEIRA!";
  beltWarningEl.style.cssText = `
    position: absolute;
    left: 50%;
    top: 12%;
    transform: translateX(-50%);
    font-family: var(--font-display);
    font-size: 20px;
    letter-spacing: 2px;
    color: var(--safety-yellow);
    background: rgba(0, 0, 0, 0.65);
    padding: 8px 18px;
    border-radius: 6px;
    border: 2px solid var(--safety-yellow);
    text-shadow: 0 0 10px rgba(255, 194, 51, 0.6);
    pointer-events: none;
    z-index: 40;
    animation: pulse 0.8s infinite ease-in-out;
  `;
  gameArea.appendChild(beltWarningEl);
}

function hideBeltWarning() {
  if (beltWarningEl) {
    beltWarningEl.remove();
    beltWarningEl = null;
  }
}

function checkHandOnBelt(cursorPos, dt) {
  if (!cursorPos || !state.running) {
    handOnBeltTime = 0;
    hideBeltWarning();
    return;
  }

  const beltRect = conveyor.getBoundingClientRect();
  const gameRect = gameArea.getBoundingClientRect();

  const beltTop = beltRect.top - gameRect.top;
  const beltBottom = beltRect.bottom - gameRect.top;

  const onBelt = cursorPos.y >= beltTop - 15 && cursorPos.y <= beltBottom + 15;

  if (onBelt) {
    handOnBeltTime += dt;

    // Aviso aparece a partir de 5 segundos
    if (handOnBeltTime >= 5) {
      showBeltWarning();
    }

    // Perde vida aos 10 segundos
    if (handOnBeltTime >= HAND_ON_BELT_LIMIT) {
      state.lives -= 1;
      state.combo = 0;
      updateLivesDisplay();
      updateComboDisplay();
      sfxWrong();
      handOnBeltTime = 0;
      hideBeltWarning();

      const msg = document.createElement("div");
      msg.textContent = "MÃO NA ESTEIRA! -1 VIDA";
      msg.style.cssText = `
        position: absolute;
        left: 50%;
        top: 30%;
        transform: translateX(-50%);
        font-family: var(--font-display);
        font-size: 22px;
        letter-spacing: 2px;
        color: var(--danger-red);
        text-shadow: 0 0 12px rgba(255, 82, 87, 0.7);
        pointer-events: none;
        z-index: 45;
        animation: fade-out 1.2s ease forwards;
      `;
      gameArea.appendChild(msg);
      setTimeout(() => msg.remove(), 1200);

      if (state.lives <= 0) {
        endGame();
      }
    }
  } else {
    handOnBeltTime = 0;
    hideBeltWarning();
  }
}

/* ------------------------------------------------------------
   7. PRODUTOS / ESTEIRA
   ------------------------------------------------------------ */
const PRODUCT_ICONS = ["📦", "🧴", "🥫", "🧃"];

function spawnProduct() {
  const damaged = Math.random() < state.damagedChance;
  const el = document.createElement("div");
  el.className = "product" + (damaged ? " damaged" : "");

  const icon = PRODUCT_ICONS[Math.floor(Math.random() * PRODUCT_ICONS.length)];
  el.textContent = icon;

  const crack = document.createElement("div");
  crack.className = "crack";
  el.appendChild(crack);

  productsLayer.appendChild(el);

  const width = 84;
  const startX = conveyor.clientWidth + width;

  const product = {
    id: state.nextProductId++,
    el,
    x: startX,
    width,
    damaged,
    caught: false
  };
  el.style.transform = `translate(${startX}px, -50%)`;

  state.products.push(product);
}

function getCurrentBeltSpeed() {
  return state.beltSpeed + state.combo * 7;
}

function updateProducts(dt) {
  const moveBy = getCurrentBeltSpeed() * dt;

  for (let i = state.products.length - 1; i >= 0; i--) {
    const p = state.products[i];
    if (p.caught) continue;

    p.x -= moveBy;
    p.el.style.transform = `translate(${p.x}px, -50%)`;

    if (p.x < -p.width) {
      if (p.damaged) {
        state.combo = 0;
        state.lives -= 1;
        updateComboDisplay();
        updateLivesDisplay();
        sfxWrong();
        showMissedDamagedMessage();

        if (state.lives <= 0) {
          endGame();
          return;
        }
      }
      p.el.remove();
      state.products.splice(i, 1);
    }
  }
}

function showMissedDamagedMessage() {
  const msg = document.createElement("div");
  msg.textContent = "⚠ DEFEITO PASSOU!";
  msg.style.cssText = `
    position: absolute;
    left: 50%;
    top: 28%;
    transform: translateX(-50%);
    font-family: var(--font-display);
    font-size: 22px;
    letter-spacing: 2px;
    color: var(--danger-red);
    text-shadow: 0 0 12px rgba(255, 82, 87, 0.7);
    pointer-events: none;
    z-index: 35;
    animation: fade-out 1.2s ease forwards;
  `;
  gameArea.appendChild(msg);
  setTimeout(() => msg.remove(), 1200);
}

function checkHandProductCollision(cursorPos) {
  if (!cursorPos || !grabJustTriggered) return;

  const cursorRadius = 32;

  for (const p of state.products) {
    if (p.caught) continue;

    const rect = p.el.getBoundingClientRect();
    const gameRect = gameArea.getBoundingClientRect();
    const px = rect.left - gameRect.left + rect.width / 2;
    const py = rect.top - gameRect.top + rect.height / 2;

    const dist = Math.hypot(px - cursorPos.x, py - cursorPos.y);
    if (dist < cursorRadius + rect.width / 2) {
      collectProduct(p);
      break;
    }
  }
}

function collectProduct(p) {
  p.caught = true;

  if (p.damaged) {
    const gained = 10 + state.combo * 2;
    state.score += gained;
    state.combo += 1;
    state.bestCombo = Math.max(state.bestCombo, state.combo);
    p.el.classList.add("collect-good");
    sfxCorrect();
    spawnFloatingText(p.el, `+${gained}`, "var(--ok-green)");
  } else {
    state.score = Math.max(0, state.score - 15);
    state.combo = 0;
    state.lives -= 1;
    p.el.classList.add("collect-bad");
    sfxWrong();
    spawnFloatingText(p.el, "-15", "var(--danger-red)");
  }

  updateScoreDisplay();
  updateComboDisplay();
  updateLivesDisplay();
  checkLevelUp();

  setTimeout(() => {
    p.el.remove();
    state.products = state.products.filter((x) => x.id !== p.id);
  }, 380);

  if (state.lives <= 0) {
    endGame();
  }
}

function spawnFloatingText(anchorEl, text, color) {
  const span = document.createElement("span");
  span.textContent = text;
  span.style.position = "absolute";
  span.style.left = "50%";
  span.style.top = "0";
  span.style.transform = "translate(-50%, 0)";
  span.style.fontFamily = "var(--font-display)";
  span.style.fontSize = "18px";
  span.style.color = color;
  span.style.pointerEvents = "none";
  span.style.animation = "fade-out 0.6s ease forwards";
  span.style.zIndex = "40";
  anchorEl.appendChild(span);
  setTimeout(() => span.remove(), 600);
}

/* ------------------------------------------------------------
   8. NÍVEL / DIFICULDADE
   ------------------------------------------------------------ */
function checkLevelUp() {
  const nextLevel = LEVEL_THRESHOLDS.filter((t) => state.score >= t).length;
  if (nextLevel > state.level) {
    state.level = nextLevel;
    applyLevelDifficulty();
    showLevelUpToast();
    sfxLevelUp();
    updateLevelDisplay();
  }
}

function applyLevelDifficulty() {
  state.beltSpeed = 90 + (state.level - 1) * 16;
  state.spawnInterval = Math.max(650, 1500 - (state.level - 1) * 90);
  state.damagedChance = Math.min(0.70, 0.35 + (state.level - 1) * 0.045);
}

function showLevelUpToast() {
  levelUpNumber.textContent = state.level;
  levelUpToast.classList.remove("hidden");
  levelUpToast.style.animation = "none";
  void levelUpToast.offsetWidth;
  levelUpToast.style.animation = "";
  setTimeout(() => levelUpToast.classList.add("hidden"), 1400);
}

function updateScoreDisplay() { scoreValueEl.textContent = state.score; }
function updateLevelDisplay() { levelValueEl.textContent = state.level; }
function updateComboDisplay() { comboValueEl.textContent = `x${state.combo}`; }
function updateLivesDisplay() {
  livesValueEl.textContent =
    "❤".repeat(Math.max(0, state.lives)) +
    "🖤".repeat(Math.max(0, 3 - state.lives));
}

/* ------------------------------------------------------------
   9. LOOP PRINCIPAL
   ------------------------------------------------------------ */
let lastFrameTime = 0;

function gameLoop(timestamp) {
  if (!state.running) return;

  if (!lastFrameTime) lastFrameTime = timestamp;
  const dt = Math.min(0.05, (timestamp - lastFrameTime) / 1000);
  lastFrameTime = timestamp;

  if (timestamp - state.lastSpawn > state.spawnInterval) {
    spawnProduct();
    state.lastSpawn = timestamp;
  }

  updateProducts(dt);
  const cursorPos = updateHandCursor();
  checkHandProductCollision(cursorPos);
  checkHandOnBelt(cursorPos, dt);

  requestAnimationFrame(gameLoop);
}

/* ------------------------------------------------------------
   10. CONTROLE DE TELAS / ESTADO
   ------------------------------------------------------------ */
function resetState() {
  state.running = false;
  state.score = 0;
  state.level = 1;
  state.combo = 0;
  state.bestCombo = 0;
  state.lives = 3;
  state.beltSpeed = 90;
  state.spawnInterval = 1500;
  state.damagedChance = 0.35;
  state.lastSpawn = 0;
  state.products.forEach((p) => p.el.remove());
  state.products = [];
  lastFrameTime = 0;
  handOnBeltTime = 0;
  hideBeltWarning();

  updateScoreDisplay();
  updateLevelDisplay();
  updateComboDisplay();
  updateLivesDisplay();
}

function showScreen(screen) {
  [startScreen, gameScreen, gameoverScreen].forEach((s) => s.classList.add("hidden"));
  screen.classList.remove("hidden");
}

async function handleStart() {
  startBtn.disabled = true;
  startError.textContent = "";
  ensureAudio();

  try {
    setCameraStatus("pending", "Ativando câmera…");
    await startWebcam();

    landmarkCanvas.width = webcamVideo.videoWidth || 640;
    landmarkCanvas.height = webcamVideo.videoHeight || 480;

    if (!handLandmarker) {
      setCameraStatus("pending", "Carregando modelo de detecção…");
      await initHandTracking();
    }

    setCameraStatus("pending", "Procurando mão…");
    detectionLoop();

    resetState();
    showScreen(gameScreen);
    state.running = true;
    requestAnimationFrame(gameLoop);
  } catch (err) {
    console.error(err);
    startError.textContent =
      "Não foi possível acessar a câmera. Verifique as permissões do navegador e se a página está em HTTPS ou localhost.";
    setCameraStatus("bad", "Câmera indisponível");
  } finally {
    startBtn.disabled = false;
  }
}

function endGame() {
  state.running = false;
  hideBeltWarning();
  finalScoreEl.textContent = state.score;
  finalLevelEl.textContent = state.level;
  finalComboEl.textContent = state.bestCombo;
  showScreen(gameoverScreen);
}

function handleRestart() {
  resetState();
  showScreen(gameScreen);
  state.running = true;
  requestAnimationFrame(gameLoop);
}

/* ------------------------------------------------------------
   11. EVENTOS
   ------------------------------------------------------------ */
startBtn.addEventListener("click", handleStart);
restartBtn.addEventListener("click", handleRestart);

window.addEventListener("resize", () => {
  landmarkCanvas.width = webcamVideo.videoWidth || landmarkCanvas.width;
  landmarkCanvas.height = webcamVideo.videoHeight || landmarkCanvas.height;
});

(async function precheckCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setCameraStatus("bad", "Navegador sem suporte a câmera");
    return;
  }
  setCameraStatus("pending", "Clique em iniciar para ativar a câmera");
})();