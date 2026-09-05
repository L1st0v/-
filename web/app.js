// Мини-приложение мероприятия.
// Показывает текущий этап и сам обновляется, когда этап меняется у всех.

const POLL_MS = 3000;
const READY_TRIES = 20;   // сколько раз ждём, пока Telegram передаст данные
const READY_STEP_MS = 100;

const loaderEl = document.getElementById("loader");
const stageEl = document.getElementById("stage");
const pillEl = document.getElementById("pill");
const titleEl = document.getElementById("title");
const textEl = document.getElementById("text");
const gameEl = document.getElementById("game");
const footerEl = document.getElementById("footer");
const actionEl = document.getElementById("action");

let shownStage = null;
let timer = null;
let game = null;   // запущенная мини-игра, если этап с игрой

// Библиотека Telegram заполняет свои данные не мгновенно, поэтому берём их
// заново при каждом обращении, а не запоминаем один раз при загрузке.
function webapp() {
  return (window.Telegram && window.Telegram.WebApp) || null;
}

function initData() {
  const app = webapp();
  return (app && app.initData) || "";
}

function haptic(kind) {
  const app = webapp();
  if (!app || !app.HapticFeedback) return;
  if (kind === "success") app.HapticFeedback.notificationOccurred("success");
  else app.HapticFeedback.impactOccurred("light");
}

function showError(message) {
  loaderEl.textContent = message;
  loaderEl.classList.add("error");
  loaderEl.hidden = false;
  stageEl.hidden = true;
  footerEl.hidden = true;
}

function openLink(url) {
  const app = webapp();
  if (app && app.openLink) app.openLink(url);
  else window.open(url, "_blank");
}

function render(stage, word) {
  loaderEl.hidden = true;
  stageEl.hidden = false;

  // Уходя с этапа с игрой, гасим её, чтобы не крутилась в фоне.
  if (game) {
    game.destroy();
    game = null;
  }

  pillEl.textContent = "Этап " + stage.number;
  titleEl.textContent = stage.title;

  textEl.replaceChildren();
  const paragraphs = stage.paragraphs || [];
  paragraphs.forEach(function (line, index) {
    const p = document.createElement("p");
    p.textContent = line;
    if (index === paragraphs.length - 1 && line.length < 40) {
      p.classList.add("final");
    }
    textEl.append(p);
  });

  // Этап с мини-игрой: вместо кнопки внизу показываем аркадный автомат.
  if (stage.game === "delivery" && window.DeliveryGame) {
    gameEl.hidden = false;
    game = window.DeliveryGame(gameEl, { word: word });
  } else {
    gameEl.hidden = true;
  }
  document.body.classList.toggle("has-game", !gameEl.hidden);

  if (stage.button && stage.button.url) {
    actionEl.textContent = stage.button.label;
    actionEl.onclick = function () {
      haptic("light");
      openLink(stage.button.url);
    };
    footerEl.hidden = false;
  } else {
    actionEl.onclick = null;
    footerEl.hidden = true;
  }

  // Перерисовываем с анимацией, чтобы смена этапа была заметна.
  stageEl.style.animation = "none";
  void stageEl.offsetWidth;
  stageEl.style.animation = "";
}

async function refresh() {
  const signed = initData();
  if (!signed) return;

  let response;
  try {
    response = await fetch("/api/state", {
      method: "POST",
      headers: { "X-Init-Data": signed },
    });
  } catch (error) {
    if (shownStage === null) showError("Нет связи с сервером. Проверьте интернет.");
    return;
  }

  if (!response.ok) {
    const details = await response.json().catch(function () { return {}; });
    showError(details.detail || "Сервер не принял данные Telegram.");
    return;
  }

  const state = await response.json();
  if (state.stage.number !== shownStage) {
    if (shownStage !== null) haptic("success");
    shownStage = state.stage.number;
    render(state.stage, state.word);
  }
}

function startPolling() {
  if (timer === null) timer = setInterval(refresh, POLL_MS);
}

function stopPolling() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

document.addEventListener("visibilitychange", function () {
  // Пока приложение свёрнуто, не дёргаем сервер и не тратим батарею.
  if (document.hidden) {
    stopPolling();
  } else {
    refresh();
    startPolling();
  }
});

async function waitForTelegram() {
  for (let i = 0; i < READY_TRIES; i++) {
    if (initData()) return true;
    await new Promise(function (done) { setTimeout(done, READY_STEP_MS); });
  }
  return false;
}

async function start() {
  const app = webapp();
  if (app) {
    app.ready();
    app.expand();
  }

  if (!(await waitForTelegram())) {
    showError("Откройте эту страницу кнопкой в боте, а не по прямой ссылке.");
    return;
  }

  await refresh();
  startPolling();
}

start();
