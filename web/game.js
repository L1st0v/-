// Аркадный автомат "Комендант": развозим толстовки по городу.
//
// Как всё устроено:
//   - город это сетка клеток, чётные ряды и столбцы - дороги, нечётные - дома;
//   - машиной управляют крестовиной внизу (или стрелками на клавиатуре);
//   - въехали в склад - забрали толстовки, въехали в типографию - отдали
//     в печать и забрали готовые, въехали в жилой дом - отдали жильцу;
//   - успели до конца таймера - экран ломается и показывает слово.
//
// Все числа, которые стоит крутить при настройке сложности, собраны
// в разделе НАСТРОЙКИ сразу под этим комментарием.

(function () {
  "use strict";

  // ---------------------------------------------------------------- НАСТРОЙКИ

  const TIME_LIMIT = 150;      // сколько секунд даётся на всё
  const GOAL = 4;              // сколько толстовок надо развезти
  const CAR_SPEED = 108;       // скорость машины, точек в секунду
  const CAR_CAPACITY = 3;      // сколько толстовок влезает в машину
  const PRINT_SECONDS = 8;     // сколько печатается одна толстовка
  const SPAWN_SECONDS = 6;     // как часто на складе появляется новая
  const SPAWN_MAX = 4;         // сколько толстовок максимум ждёт на складе
  const START_READY = 1;       // сколько лежит на складе в самом начале

  // Что говорят жильцы. Берутся по очереди.
  const HOUSE_LINES = [
    "Спасибо!",
    "Хммм, раньше мерч был лучше...",
  ];

  const REWARD_LINE = "+0 к балансу. Зато Вы комендант";

  // ------------------------------------------------------------------- ГОРОД

  const CELL = 48;             // размер одной клетки
  const COLS = 7;
  const ROWS = 9;
  const W = COLS * CELL;       // 336
  const H = ROWS * CELL;       // 432
  const PAD = 3;               // отступ дома от края клетки
  const CAR = 16;              // размер машины

  // col, row, роль. Дома стоят только на нечётных клетках.
  const PLAN = [
    [1, 1, "warehouse"],
    [3, 1, "decor"],
    [5, 1, "house"],
    [1, 3, "decor"],
    [3, 3, "decor"],
    [5, 3, "house"],
    [1, 5, "house"],
    [3, 5, "decor"],
    [5, 5, "decor"],
    [1, 7, "house"],
    [3, 7, "house"],
    [5, 7, "print"],
  ];

  const COLORS = {
    road: "#232733",
    ground: "#161922",
    mark: "#4a5163",
    warehouse: "#e0a33a",
    print: "#4fa3ff",
    house: "#7d8598",
    houseWaiting: "#5ad18a",
    decor: "#39404f",
    car: "#ff5f4d",
    text: "#0d0f16",
  };

  function makeBuildings() {
    return PLAN.map(function (item, index) {
      return {
        id: index,
        role: item[2],
        x: item[0] * CELL + PAD,
        y: item[1] * CELL + PAD,
        w: CELL - PAD * 2,
        h: CELL - PAD * 2,
        waiting: item[2] === "house",   // дом ещё ждёт толстовку
        flash: 0,                        // подсветка после взаимодействия
      };
    });
  }

  // ------------------------------------------------------------ ВСПОМОГАТЕЛЬНОЕ

  function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ---------------------------------------------------------------- САМА ИГРА

  function DeliveryGame(root, options) {
    const word = (options && options.word) || "";
    const onWin = (options && options.onWin) || function () {};

    let raf = null;
    let last = 0;
    let phase = "intro";        // intro | play | lost | broken | won
    let state = null;
    let glitchUntil = 0;

    // ------------------------------------------------------------- разметка

    root.replaceChildren();

    const cabinet = el("div", "cab");
    const marquee = el("div", "cab-marquee", "К О М Е Н Д А Н Т");
    const screenBox = el("div", "cab-screen");
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvas.className = "cab-canvas";
    const scan = el("div", "cab-scan");
    const overlay = el("div", "cab-overlay");
    screenBox.append(canvas, scan, overlay);

    const pad = el("div", "cab-pad");
    const padButtons = {};
    [
      ["up", "▲", "up"],
      ["left", "◀", "left"],
      ["down", "▼", "down"],
      ["right", "▶", "right"],
    ].forEach(function (item) {
      const button = el("button", "pad-key pad-" + item[0], item[1]);
      button.type = "button";
      button.dataset.dir = item[2];
      padButtons[item[2]] = button;
      pad.append(button);
    });

    cabinet.append(marquee, screenBox, pad);
    root.append(cabinet);

    const ctx = canvas.getContext("2d");

    // ------------------------------------------------------------ управление

    const held = { up: false, down: false, left: false, right: false };

    function press(dir, on) {
      if (!(dir in held)) return;
      held[dir] = on;
      const button = padButtons[dir];
      if (button) button.classList.toggle("is-down", on);
    }

    function releaseAll() {
      Object.keys(held).forEach(function (dir) { press(dir, false); });
    }

    pad.addEventListener("pointerdown", function (event) {
      const dir = event.target && event.target.dataset && event.target.dataset.dir;
      if (!dir) return;
      event.preventDefault();
      if (event.target.setPointerCapture) {
        try { event.target.setPointerCapture(event.pointerId); } catch (e) {}
      }
      press(dir, true);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (name) {
      pad.addEventListener(name, function (event) {
        const dir = event.target && event.target.dataset && event.target.dataset.dir;
        if (dir) press(dir, false);
      });
    });
    // Палец мог уехать с кнопки - тогда отпускаем всё, чтобы машина не залипла.
    window.addEventListener("pointerup", releaseAll);

    const KEYS = {
      ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
      KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right",
    };
    function onKey(event) {
      const dir = KEYS[event.code];
      if (!dir) return;
      event.preventDefault();
      press(dir, event.type === "keydown");
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);

    // ------------------------------------------------------------- состояние

    function reset() {
      state = {
        buildings: makeBuildings(),
        car: { x: CELL * 0.5 - CAR / 2, y: CELL * 0.5 - CAR / 2, dir: "down" },
        raw: 0,               // сырые толстовки в машине
        printed: 0,           // готовые толстовки в машине
        atPrint: [],          // сроки готовности печати, в секундах
        readyAtWarehouse: START_READY,
        spawnIn: SPAWN_SECONDS,
        delivered: 0,
        left: TIME_LIMIT,
        clock: 0,
        lineIndex: 0,
        toast: null,          // { text, sub, until }
        bubble: null,         // { x, y, text, until }
        cooldown: 0,          // чтобы одно касание дома не срабатывало сто раз
        lastBuilding: -1,
      };
    }

    function carried() {
      return state.raw + state.printed;
    }

    function toast(text, sub) {
      state.toast = { text: text, sub: sub || "", until: state.clock + 2.2 };
    }

    function bubbleOver(building, text) {
      state.bubble = {
        x: building.x + building.w / 2,
        y: building.y,
        text: text,
        until: state.clock + 2.2,
      };
    }

    function buzz(kind) {
      const app = window.Telegram && window.Telegram.WebApp;
      if (!app || !app.HapticFeedback) return;
      try {
        if (kind === "win") app.HapticFeedback.notificationOccurred("success");
        else app.HapticFeedback.impactOccurred("light");
      } catch (e) {}
    }

    // ------------------------------------------------------------ шаг игры

    function moveCar(dt) {
      let dx = 0;
      let dy = 0;
      if (held.up) dy -= 1;
      if (held.down) dy += 1;
      if (held.left) dx -= 1;
      if (held.right) dx += 1;
      // Только по одной оси за раз: так проще попадать в проезды.
      if (dx !== 0 && dy !== 0) dy = 0;
      if (dx === 0 && dy === 0) return;

      state.car.dir = dx < 0 ? "left" : dx > 0 ? "right" : dy < 0 ? "up" : "down";
      const step = CAR_SPEED * dt;

      const tryX = Math.min(Math.max(state.car.x + dx * step, 0), W - CAR);
      if (!blocked(tryX, state.car.y)) state.car.x = tryX;

      const tryY = Math.min(Math.max(state.car.y + dy * step, 0), H - CAR);
      if (!blocked(state.car.x, tryY)) state.car.y = tryY;
    }

    function blocked(x, y) {
      return state.buildings.some(function (b) {
        return overlap(x, y, CAR, CAR, b.x, b.y, b.w, b.h);
      });
    }

    function touching() {
      // Дом считается "под колёсами", если машина коснулась его края.
      const reach = 5;
      return state.buildings.find(function (b) {
        return overlap(
          state.car.x, state.car.y, CAR, CAR,
          b.x - reach, b.y - reach, b.w + reach * 2, b.h + reach * 2
        );
      }) || null;
    }

    function interact(building) {
      if (building.role === "warehouse") {
        let taken = 0;
        while (state.readyAtWarehouse > 0 && carried() < CAR_CAPACITY) {
          state.readyAtWarehouse -= 1;
          state.raw += 1;
          taken += 1;
        }
        if (taken > 0) {
          building.flash = 0.6;
          toast("Забрали " + taken + " шт.", "Теперь на печать");
          buzz();
        } else if (carried() >= CAR_CAPACITY) {
          toast("Машина полная", "Сначала развезите");
        }
        return;
      }

      if (building.role === "print") {
        let given = 0;
        while (state.raw > 0) {
          state.raw -= 1;
          state.atPrint.push(state.clock + PRINT_SECONDS);
          given += 1;
        }
        let took = 0;
        while (
          state.atPrint.length > 0 &&
          state.atPrint[0] <= state.clock &&
          carried() < CAR_CAPACITY
        ) {
          state.atPrint.shift();
          state.printed += 1;
          took += 1;
        }
        if (given > 0 || took > 0) {
          building.flash = 0.6;
          buzz();
          const parts = [];
          if (given > 0) parts.push("сдали " + given);
          if (took > 0) parts.push("забрали " + took);
          toast("Типография: " + parts.join(", "), took > 0 ? "Развозите по домам" : "Печать идёт");
        } else if (state.atPrint.length > 0) {
          const wait = Math.ceil(state.atPrint[0] - state.clock);
          toast("Ещё печатается", "Готово через " + wait + " с");
        }
        return;
      }

      if (building.role === "house") {
        if (!building.waiting) return;
        if (state.printed <= 0) {
          toast("Тут ждут толстовку", "А у Вас нет готовых");
          return;
        }
        state.printed -= 1;
        building.waiting = false;
        building.flash = 0.9;
        state.delivered += 1;
        const line = HOUSE_LINES[state.lineIndex % HOUSE_LINES.length];
        state.lineIndex += 1;
        bubbleOver(building, line);
        toast(REWARD_LINE, "Развезено " + state.delivered + " из " + GOAL);
        buzz();
        if (state.delivered >= GOAL) win();
      }
    }

    function step(dt) {
      state.clock += dt;
      state.left -= dt;

      moveCar(dt);

      // Новые толстовки на складе.
      state.spawnIn -= dt;
      if (state.spawnIn <= 0) {
        state.spawnIn = SPAWN_SECONDS;
        if (state.readyAtWarehouse < SPAWN_MAX) state.readyAtWarehouse += 1;
      }

      // Взаимодействие с домом, в который въехали.
      state.cooldown = Math.max(0, state.cooldown - dt);
      const near = touching();
      if (!near) {
        state.lastBuilding = -1;
      } else if (near.id !== state.lastBuilding || state.cooldown === 0) {
        state.lastBuilding = near.id;
        state.cooldown = 1.2;
        interact(near);
      }

      state.buildings.forEach(function (b) {
        b.flash = Math.max(0, b.flash - dt);
      });
      if (state.toast && state.clock > state.toast.until) state.toast = null;
      if (state.bubble && state.clock > state.bubble.until) state.bubble = null;

      if (state.left <= 0 && phase === "play") lose();
    }

    // ------------------------------------------------------------- рисование

    function drawCity() {
      ctx.fillStyle = COLORS.road;
      ctx.fillRect(0, 0, W, H);

      // Пунктир по центру дорог.
      ctx.fillStyle = COLORS.mark;
      for (let c = 0; c < COLS; c += 2) {
        for (let y = 4; y < H; y += 16) ctx.fillRect(c * CELL + CELL / 2 - 1, y, 2, 8);
      }
      for (let r = 0; r < ROWS; r += 2) {
        for (let x = 4; x < W; x += 16) ctx.fillRect(x, r * CELL + CELL / 2 - 1, 8, 2);
      }

      state.buildings.forEach(function (b) {
        let fill = COLORS.decor;
        let label = "";
        if (b.role === "warehouse") { fill = COLORS.warehouse; label = "СКЛАД"; }
        if (b.role === "print") { fill = COLORS.print; label = "ПЕЧАТЬ"; }
        if (b.role === "house") {
          fill = b.waiting ? COLORS.houseWaiting : COLORS.house;
          label = b.waiting ? "ЖДЁТ" : "ОК";
        }
        if (b.flash > 0) fill = "#ffffff";

        ctx.fillStyle = fill;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        ctx.fillRect(b.x, b.y + b.h - 7, b.w, 7);

        if (b.role === "decor") {
          // Окошки, чтобы город не выглядел пустым.
          ctx.fillStyle = "rgba(255,255,255,0.10)";
          for (let wy = b.y + 6; wy < b.y + b.h - 12; wy += 10) {
            for (let wx = b.x + 6; wx < b.x + b.w - 6; wx += 10) {
              ctx.fillRect(wx, wy, 5, 5);
            }
          }
        } else {
          ctx.fillStyle = COLORS.text;
          ctx.font = "bold 8px ui-monospace, Menlo, Consolas, monospace";
          ctx.textAlign = "center";
          ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 3);
        }
      });

      // Сколько толстовок ждёт на складе.
      const store = state.buildings.find(function (b) { return b.role === "warehouse"; });
      for (let i = 0; i < state.readyAtWarehouse; i++) {
        ctx.fillStyle = "#fff2cf";
        ctx.fillRect(store.x + 4 + i * 9, store.y - 8, 7, 6);
      }

      // Сколько печатается прямо сейчас.
      const printer = state.buildings.find(function (b) { return b.role === "print"; });
      state.atPrint.forEach(function (readyAt, i) {
        const done = readyAt <= state.clock;
        ctx.fillStyle = done ? "#9ef5c0" : "#cfe4ff";
        ctx.fillRect(printer.x + 4 + i * 9, printer.y - 8, 7, 6);
      });
    }

    function drawCar() {
      const c = state.car;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(c.x + 2, c.y + 3, CAR, CAR);
      ctx.fillStyle = COLORS.car;
      ctx.fillRect(c.x, c.y, CAR, CAR);
      ctx.fillStyle = "#ffe9b0";
      const lamp = 3;
      if (c.dir === "up") ctx.fillRect(c.x + 2, c.y, CAR - 4, lamp);
      if (c.dir === "down") ctx.fillRect(c.x + 2, c.y + CAR - lamp, CAR - 4, lamp);
      if (c.dir === "left") ctx.fillRect(c.x, c.y + 2, lamp, CAR - 4);
      if (c.dir === "right") ctx.fillRect(c.x + CAR - lamp, c.y + 2, lamp, CAR - 4);

      // Груз на крыше.
      for (let i = 0; i < carried(); i++) {
        ctx.fillStyle = i < state.raw ? "#fff2cf" : "#9ef5c0";
        ctx.fillRect(c.x + 1 + i * 5, c.y + 6, 4, 4);
      }
    }

    function drawHud() {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, W, 22);
      ctx.fillStyle = "#e9edf5";
      ctx.font = "bold 11px ui-monospace, Menlo, Consolas, monospace";
      ctx.textAlign = "left";
      ctx.fillText("РАЗВЕЗЕНО " + state.delivered + "/" + GOAL, 8, 15);
      ctx.textAlign = "center";
      ctx.fillText("БАЛАНС 0", W / 2, 15);
      ctx.textAlign = "right";
      const left = Math.max(0, Math.ceil(state.left));
      ctx.fillStyle = left <= 20 ? "#ff7a68" : "#e9edf5";
      ctx.fillText(left + " С", W - 8, 15);

      // Полоска времени.
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(0, 22, W, 3);
      ctx.fillStyle = left <= 20 ? "#ff7a68" : "#5ad18a";
      ctx.fillRect(0, 22, W * Math.max(0, state.left) / TIME_LIMIT, 3);

      if (state.bubble) {
        const b = state.bubble;
        ctx.font = "bold 9px ui-monospace, Menlo, Consolas, monospace";
        ctx.textAlign = "center";
        const width = ctx.measureText(b.text).width + 12;
        const x = Math.min(Math.max(b.x - width / 2, 2), W - width - 2);
        const y = Math.max(b.y - 20, 28);
        ctx.fillStyle = "#f2f5fb";
        ctx.fillRect(x, y, width, 14);
        ctx.fillStyle = COLORS.text;
        ctx.fillText(b.text, x + width / 2, y + 10);
      }

      if (state.toast) {
        ctx.fillStyle = "rgba(0,0,0,0.72)";
        ctx.fillRect(0, H - 34, W, 34);
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffd76e";
        ctx.font = "bold 11px ui-monospace, Menlo, Consolas, monospace";
        ctx.fillText(state.toast.text, W / 2, H - 20);
        ctx.fillStyle = "#aeb6c6";
        ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
        ctx.fillText(state.toast.sub, W / 2, H - 7);
      }
    }

    function draw() {
      drawCity();
      drawCar();
      drawHud();
    }

    // Ломаем картинку: режем кадр на полосы и разъезжаемся ими в стороны.
    function drawGlitch() {
      const frame = ctx.getImageData(0, 0, W, H);
      const buffer = document.createElement("canvas");
      buffer.width = W;
      buffer.height = H;
      buffer.getContext("2d").putImageData(frame, 0, 0);

      ctx.fillStyle = "#05060a";
      ctx.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += 6) {
        const shift = Math.round((Math.random() - 0.5) * 60);
        const h = 6;
        ctx.globalAlpha = 0.6 + Math.random() * 0.4;
        ctx.drawImage(buffer, 0, y, W, h, shift, y + Math.round((Math.random() - 0.5) * 4), W, h);
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? "#ff3b30" : "#31d0ff";
        ctx.fillRect(
          Math.random() * W, Math.random() * H,
          10 + Math.random() * 90, 2 + Math.random() * 6
        );
      }
    }

    // ------------------------------------------------------------- экраны

    function showOverlay(nodes) {
      overlay.replaceChildren.apply(overlay, nodes);
      overlay.hidden = false;
    }

    function hideOverlay() {
      overlay.hidden = true;
      overlay.replaceChildren();
    }

    function intro() {
      phase = "intro";
      reset();
      draw();
      const button = el("button", "cab-button", "СТАРТ");
      button.type = "button";
      button.onclick = play;
      showOverlay([
        el("p", "cab-kicker", "ВСТАВЬТЕ ЖЕТОН"),
        el("h2", "cab-head", "Развезите " + GOAL + " толстовки"),
        el("p", "cab-note",
          "Склад - типография - жильцы. Печать идёт " + PRINT_SECONDS +
          " секунд, за это время успевайте забрать следующую партию. " +
          "У Вас " + TIME_LIMIT + " секунд."),
        button,
      ]);
    }

    function play() {
      hideOverlay();
      reset();
      phase = "play";
      last = performance.now();
      loop(last);
    }

    function lose() {
      phase = "lost";
      releaseAll();
      const button = el("button", "cab-button", "ЕЩЁ РАЗ");
      button.type = "button";
      button.onclick = play;
      showOverlay([
        el("p", "cab-kicker", "ВРЕМЯ ВЫШЛО"),
        el("h2", "cab-head", "Развезено " + state.delivered + " из " + GOAL),
        el("p", "cab-note", "Комендант бы успел. Попробуйте ещё раз."),
        button,
      ]);
    }

    function win() {
      phase = "broken";
      releaseAll();
      buzz("win");
      cabinet.classList.add("is-broken");
      glitchUntil = performance.now() + 1700;
    }

    function showWord() {
      phase = "won";
      cabinet.classList.remove("is-broken");
      cabinet.classList.add("is-dead");
      try { localStorage.setItem("komendant.stage4.word", word); } catch (e) {}
      showOverlay([
        el("p", "cab-kicker", "СИСТЕМА ПОВРЕЖДЕНА"),
        el("p", "cab-note", "Из автомата выпало Ваше слово:"),
        el("p", "cab-word", word || "???"),
        el("p", "cab-note",
          "У остальных слова другие. Соберите фразу вместе и напишите её боту."),
      ]);
      onWin(word);
    }

    // Если игру уже прошли, сразу показываем слово, а не гоняем заново.
    function alreadyWon() {
      try { return localStorage.getItem("komendant.stage4.word") === word && !!word; }
      catch (e) { return false; }
    }

    // -------------------------------------------------------------- цикл

    function loop(now) {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      if (phase === "play") {
        step(dt);
        draw();
        return;
      }
      if (phase === "broken") {
        drawGlitch();
        if (now >= glitchUntil) {
          cancelAnimationFrame(raf);
          raf = null;
          showWord();
        }
        return;
      }
      cancelAnimationFrame(raf);
      raf = null;
    }

    // ------------------------------------------------------------- старт

    if (alreadyWon()) {
      reset();
      draw();
      cabinet.classList.add("is-dead");
      showWord();
    } else {
      intro();
    }

    return {
      destroy: function () {
        if (raf !== null) cancelAnimationFrame(raf);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("keyup", onKey);
        window.removeEventListener("pointerup", releaseAll);
        root.replaceChildren();
      },
    };
  }

  window.DeliveryGame = DeliveryGame;
})();
