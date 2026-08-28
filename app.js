"use strict";

const STORAGE_KEYS = {
  reminders: "reminders",
  checkins: "checkins",
  settings: "settings",
};

const DEFAULT_REMINDERS = {
  water: { enabled: true, times: ["09:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00"] },
  sleep: { enabled: true, times: ["22:30"] },
  wake: { enabled: true, times: ["07:00"] },
  exercise: { enabled: true, times: ["19:30"] },
  sit: { enabled: true, interval: 45 },
};

const DEFAULT_SETTINGS = {
  notifications: true,
  sound: true,
  goals: {
    water: 8,
    sleep: 8,
    exercise: 30,
    sit: 6,
  },
};

const TYPE_STYLES = {
  water: { color: "var(--water)", soft: "#e2f3f1", icon: "icon-water" },
  sleep: { color: "var(--sleep)", soft: "#eaeefb", icon: "icon-sleep" },
  wake: { color: "var(--sit)", soft: "#fbf2dc", icon: "icon-sun" },
  exercise: { color: "var(--move)", soft: "#fdeeec", icon: "icon-move" },
  sit: { color: "var(--sit)", soft: "#fbf2dc", icon: "icon-sit" },
};

let reminders = loadState(STORAGE_KEYS.reminders, DEFAULT_REMINDERS, mergeReminders);
let settings = loadState(STORAGE_KEYS.settings, DEFAULT_SETTINGS, mergeSettings);
let checkins = loadState(STORAGE_KEYS.checkins, {}, (saved) => saved);
let firedToday = new Set();
let lastCheckMinute = "";
let sitTimer = null;
let audioCtx = null;

const els = {
  todayLabel: document.getElementById("todayLabel"),
  notificationState: document.getElementById("notificationState"),
  bellButton: document.getElementById("bellButton"),
  overviewGrid: document.getElementById("overviewGrid"),
  timelineList: document.getElementById("timelineList"),
  timelineMeta: document.getElementById("timelineMeta"),
  checkinGrid: document.getElementById("checkinGrid"),
  weekChart: document.getElementById("weekChart"),
  settingsGrid: document.getElementById("settingsGrid"),
  resetButton: document.getElementById("resetButton"),
  bannerStack: document.getElementById("bannerStack"),
  sleepDialog: document.getElementById("sleepDialog"),
  sleepForm: document.getElementById("sleepForm"),
  sleepBed: document.getElementById("sleepBed"),
  sleepWake: document.getElementById("sleepWake"),
  sleepPreview: document.getElementById("sleepPreview"),
  sleepClose: document.getElementById("sleepClose"),
  sleepCancel: document.getElementById("sleepCancel"),
};

function loadState(key, fallback, normalize) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(fallback);
    return normalize(JSON.parse(raw));
  } catch (err) {
    return structuredClone(fallback);
  }
}

function mergeReminders(saved) {
  const base = structuredClone(DEFAULT_REMINDERS);
  if (!saved || typeof saved !== "object") return base;
  for (const key of Object.keys(base)) {
    const item = saved[key];
    if (!item || typeof item !== "object") continue;
    if (typeof item.enabled === "boolean") base[key].enabled = item.enabled;
    if (Array.isArray(item.times) && item.times.every((t) => typeof t === "string")) {
      base[key].times = item.times.filter(isValidTime);
    }
    if (key === "sit" && Number.isFinite(Number(item.interval))) {
      base[key].interval = Math.min(180, Math.max(5, Math.round(Number(item.interval))));
    }
  }
  return base;
}

function mergeSettings(saved) {
  const base = structuredClone(DEFAULT_SETTINGS);
  if (!saved || typeof saved !== "object") return base;
  if (typeof saved.notifications === "boolean") base.notifications = saved.notifications;
  if (typeof saved.sound === "boolean") base.sound = saved.sound;
  if (saved.goals && typeof saved.goals === "object") {
    for (const key of Object.keys(base.goals)) {
      const value = Number(saved.goals[key]);
      if (Number.isFinite(value)) base.goals[key] = Math.max(1, Math.round(value));
    }
  }
  return base;
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function hhmm(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dateKeyOffset(offset) {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  return todayKey(date);
}

function weekdayLabel(date) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
}

function shortDate(date) {
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function todayCheckin() {
  const key = todayKey();
  if (!checkins[key]) {
    checkins[key] = { water: 0, sleep: null, exercise: 0, sit: 0 };
    save(STORAGE_KEYS.checkins, checkins);
  }
  return checkins[key];
}

function getEvents() {
  const events = [];
  if (reminders.water.enabled) {
    reminders.water.times.forEach((time) => {
      events.push({ id: `water-${time}`, type: "water", time, title: "喝水", message: "来一杯水吧", action: "water" });
    });
  }
  if (reminders.sleep.enabled) {
    reminders.sleep.times.forEach((time) => {
      events.push({ id: `sleep-${time}`, type: "sleep", time, title: "就寝提醒", message: "准备睡觉", action: "sleep" });
    });
  }
  if (reminders.wake.enabled) {
    reminders.wake.times.forEach((time) => {
      events.push({ id: `wake-${time}`, type: "wake", time, title: "起床提醒", message: "起床活动一下", action: "wake" });
    });
  }
  if (reminders.exercise.enabled) {
    reminders.exercise.times.forEach((time) => {
      events.push({ id: `exercise-${time}`, type: "exercise", time, title: "运动提醒", message: "该运动了", action: "exercise" });
    });
  }
  return events.sort((a, b) => a.time.localeCompare(b.time));
}

function eventStyle(type) {
  return TYPE_STYLES[type] || TYPE_STYLES.water;
}

function updateTodayLabel() {
  const now = new Date();
  els.todayLabel.textContent = `${now.getMonth() + 1}月${now.getDate()}日 ${weekdayLabel(now)}`;
}

function renderOverview() {
  const checkin = todayCheckin();
  const goals = settings.goals;
  const waterPct = Math.min(100, Math.round((checkin.water / goals.water) * 100));
  const sleepHours = checkin.sleep ? checkin.sleep.hours : 0;
  const sleepPct = Math.min(100, Math.round((sleepHours / goals.sleep) * 100));
  const exercisePct = checkin.exercise ? 100 : 0;
  const sitPct = Math.min(100, Math.round((checkin.sit / goals.sit) * 100));

  const cards = [
    { key: "water", label: "喝水", value: `${checkin.water} 杯`, detail: `目标 ${goals.water} 杯`, pct: waterPct, type: "water" },
    { key: "sleep", label: "睡眠", value: checkin.sleep ? `${sleepHours.toFixed(1)} 小时` : "未记录", detail: `目标 ${goals.sleep} 小时`, pct: sleepPct, type: "sleep" },
    { key: "exercise", label: "运动", value: checkin.exercise ? "已完成" : "未完成", detail: `目标 ${goals.exercise} 分钟`, pct: exercisePct, type: "exercise" },
    { key: "sit", label: "活动休息", value: `${checkin.sit} 次`, detail: `目标 ${goals.sit} 次`, pct: sitPct, type: "sit" },
  ];

  els.overviewGrid.replaceChildren(
    ...cards.map((card) => {
      const style = eventStyle(card.type);
      const item = document.createElement("article");
      item.className = "overview-card";
      item.style.setProperty("--ring-color", style.color);
      item.style.setProperty("--pct", card.pct);
      item.innerHTML = `
        <div class="ring">
          <div class="ring-inner">${card.pct}%</div>
        </div>
        <div class="overview-copy">
          <strong>${card.label}</strong>
          <span>${card.value}</span>
          <span>${card.detail}</span>
        </div>
      `;
      return item;
    })
  );
}

function renderTimeline() {
  const now = new Date();
  const current = hhmm(now);
  const checkin = todayCheckin();
  const events = getEvents();
  let waterSeen = 0;
  els.timelineMeta.textContent = events.length ? `共 ${events.length} 个提醒` : "";

  const items = events.map((event, index) => {
    const style = eventStyle(event.type);
    const li = document.createElement("li");
    li.className = "timeline-item";
    li.style.setProperty("--type-color", style.color);
    li.style.setProperty("--type-soft", style.soft);

    const isPast = event.time < current;
    const isNext = index === 0 || (index > 0 && events[index - 1].time < current && event.time >= current);
    if (event.type === "water") waterSeen += 1;
    const isDone =
      (event.type === "water" && checkin.water >= waterSeen && isPast) ||
      (event.type === "sleep" && checkin.sleep && isPast) ||
      (event.type === "wake" && checkin.sleep && isPast) ||
      (event.type === "exercise" && checkin.exercise && isPast);
    const wasFired = firedToday.has(event.id);

    if (isNext) li.classList.add("is-next");
    if (isDone || wasFired) li.classList.add("is-done");

    let meta = "即将提醒";
    if (wasFired) meta = "已提醒";
    else if (isDone) meta = "已完成";
    else if (isPast) meta = "已过";

    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = "mini-btn";
    if (event.type === "water" && isDone) {
      actionButton.textContent = "已打卡";
      actionButton.disabled = true;
    } else if (event.type === "sleep" || event.type === "wake") {
      actionButton.textContent = isDone ? "已记录" : "记录";
      actionButton.dataset.action = "sleep";
      if (isDone) actionButton.disabled = true;
    } else if (event.type === "exercise") {
      actionButton.textContent = isDone ? "已完成" : "完成";
      actionButton.dataset.action = "exercise";
      if (isDone) actionButton.classList.add("is-checked");
    } else if (event.type === "water") {
      actionButton.textContent = "打卡";
      actionButton.dataset.action = "water";
    }

    li.innerHTML = `
      <span class="timeline-time">${event.time}</span>
      <span class="timeline-icon"><svg><use href="#${style.icon}"></use></svg></span>
      <span class="timeline-copy"><strong>${event.title}</strong><span>${meta}</span></span>
    `;
    if (actionButton.dataset.action) li.appendChild(actionButton);
    return li;
  });

  if (reminders.sit.enabled) {
    const style = eventStyle("sit");
    const li = document.createElement("li");
    li.className = "timeline-item";
    li.style.setProperty("--type-color", style.color);
    li.style.setProperty("--type-soft", style.soft);
    const nextAt = sitNextAt ? `下一次 ${hhmm(sitNextAt)}` : "页面打开时计时";
    li.innerHTML = `
      <span class="timeline-time">每 ${reminders.sit.interval} 分钟</span>
      <span class="timeline-icon"><svg><use href="#${style.icon}"></use></svg></span>
      <span class="timeline-copy"><strong>久坐活动</strong><span>${nextAt}</span></span>
    `;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mini-btn";
    button.textContent = "活动";
    button.dataset.action = "sit";
    li.appendChild(button);
    items.push(li);
  }

  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "timeline-empty";
    empty.textContent = "没有启用的提醒";
    items.push(empty);
  }
  els.timelineList.replaceChildren(...items);
}

let sitNextAt = null;

function renderCheckin() {
  const checkin = todayCheckin();
  const goals = settings.goals;
  const cards = [
    {
      type: "water",
      title: "喝水",
      value: `${checkin.water} / ${goals.water} 杯`,
      buttons: [
        { label: "减 1", action: "water-minus", icon: "icon-minus" },
        { label: "加 1", action: "water", icon: "icon-plus", primary: true },
      ],
    },
    {
      type: "sleep",
      title: "睡眠",
      value: checkin.sleep ? `${checkin.sleep.hours.toFixed(1)} 小时` : "未记录",
      buttons: [{ label: checkin.sleep ? "修改" : "记录", action: "sleep" }],
    },
    {
      type: "exercise",
      title: "运动",
      value: checkin.exercise ? "已完成" : "未完成",
      buttons: [{ label: checkin.exercise ? "已完成" : "完成运动", action: "exercise", checked: Boolean(checkin.exercise) }],
    },
    {
      type: "sit",
      title: "活动休息",
      value: `${checkin.sit} / ${goals.sit} 次`,
      buttons: [{ label: "活动一次", action: "sit", icon: "icon-plus", primary: true }],
    },
  ];

  els.checkinGrid.replaceChildren(
    ...cards.map((card) => {
      const style = eventStyle(card.type);
      const el = document.createElement("div");
      el.className = "checkin-card";
      el.style.setProperty("--type-color", style.color);
      const buttons = card.buttons
        .map((button) => {
          const icon = button.icon ? `<svg><use href="#${button.icon}"></use></svg>` : "";
          const cls = ["mini-btn"];
          if (button.primary) cls.push("is-primary");
          if (button.checked) cls.push("is-checked");
          return `<button type="button" class="${cls.join(" ")}" data-action="${button.action}">${icon}${button.label}</button>`;
        })
        .join("");
      el.innerHTML = `
        <div class="checkin-head"><svg><use href="#${style.icon}"></use></svg><strong>${card.title}</strong></div>
        <span class="checkin-value">${card.value}</span>
        <div class="checkin-actions">${buttons}</div>
      `;
      return el;
    })
  );
}

function renderWeek() {
  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const key = todayKey(date);
    const checkin = checkins[key];
    const goals = settings.goals;
    let pct = 0;
    if (checkin) {
      const water = Math.min(1, checkin.water / goals.water);
      const sleep = checkin.sleep ? Math.min(1, checkin.sleep.hours / goals.sleep) : 0;
      const exercise = checkin.exercise ? 1 : 0;
      const sit = Math.min(1, checkin.sit / goals.sit);
      pct = Math.round(((water + sleep + exercise + sit) / 4) * 100);
    }
    days.push({ label: offset === 0 ? "今天" : weekdayLabel(date), sub: shortDate(date), pct });
  }

  els.weekChart.replaceChildren(
    ...days.map((day) => {
      const el = document.createElement("div");
      el.className = "week-day";
      el.innerHTML = `
        <span class="week-value">${day.pct}%</span>
        <span class="week-track"><span class="week-bar" style="--bar-height:${day.pct}%"></span></span>
        <span class="week-label">${day.label}</span>
      `;
      return el;
    })
  );
}

function renderSettings() {
  const permission = "Notification" in window ? Notification.permission : "unsupported";
  const grid = els.settingsGrid;
  grid.replaceChildren();

  const notificationCard = settingShell("icon-bell", "通知与声音", "", "", "accent");
  notificationCard.querySelector(".setting-body").innerHTML = `
    <label class="field">
      <span>浏览器通知</span>
      <button type="button" class="toggle" role="switch" aria-checked="${settings.notifications}" data-setting="notifications" aria-label="浏览器通知"></button>
    </label>
    <label class="field">
      <span>提示音</span>
      <button type="button" class="toggle" role="switch" aria-checked="${settings.sound}" data-setting="sound" aria-label="提示音"></button>
    </label>
    <label class="field">
      <span>通知状态</span>
      <span class="status-pill ${permission === "granted" ? "is-on" : permission === "denied" ? "is-denied" : ""}">${permissionText()}</span>
    </label>
  `;
  grid.appendChild(notificationCard);

  const goalsCard = settingShell("icon-clock", "每日目标", "", "", "accent");
  goalsCard.querySelector(".setting-body").innerHTML = `
    <label class="field"><span>喝水杯数</span><input type="number" min="1" max="20" class="goal-input" data-goal="water" value="${settings.goals.water}"></label>
    <label class="field"><span>睡眠小时</span><input type="number" min="1" max="16" class="goal-input" data-goal="sleep" value="${settings.goals.sleep}"></label>
    <label class="field"><span>运动分钟</span><input type="number" min="5" max="240" class="goal-input" data-goal="exercise" value="${settings.goals.exercise}"></label>
    <label class="field"><span>活动次数</span><input type="number" min="1" max="20" class="goal-input" data-goal="sit" value="${settings.goals.sit}"></label>
  `;
  grid.appendChild(goalsCard);

  const waterCard = settingShell("icon-water", "喝水提醒", reminders.water.enabled, "water", "water");
  const waterBody = waterCard.querySelector(".setting-body");
  waterBody.innerHTML = `
    <div class="time-list" data-times="water"></div>
    <button type="button" class="mini-btn add-time" data-add-time="water"><svg><use href="#icon-plus"></use></svg>添加时间</button>
  `;
  renderTimeRows(waterBody.querySelector(".time-list"), reminders.water.times);
  grid.appendChild(waterCard);

  const sleepCard = settingShell("icon-sleep", "就寝提醒", reminders.sleep.enabled, "sleep", "sleep");
  sleepCard.querySelector(".setting-body").innerHTML = `
    <div class="time-list" data-times="sleep"></div>
  `;
  renderTimeRows(sleepCard.querySelector(".time-list"), reminders.sleep.times);
  grid.appendChild(sleepCard);

  const wakeCard = settingShell("icon-sun", "起床提醒", reminders.wake.enabled, "wake", "sit");
  wakeCard.querySelector(".setting-body").innerHTML = `
    <div class="time-list" data-times="wake"></div>
  `;
  renderTimeRows(wakeCard.querySelector(".time-list"), reminders.wake.times);
  grid.appendChild(wakeCard);

  const exerciseCard = settingShell("icon-move", "运动提醒", reminders.exercise.enabled, "exercise", "move");
  exerciseCard.querySelector(".setting-body").innerHTML = `
    <div class="time-list" data-times="exercise"></div>
  `;
  renderTimeRows(exerciseCard.querySelector(".time-list"), reminders.exercise.times);
  grid.appendChild(exerciseCard);

  const sitCard = settingShell("icon-sit", "久坐活动", reminders.sit.enabled, "sit", "sit");
  sitCard.querySelector(".setting-body").innerHTML = `
    <label class="field">
      <span>间隔分钟</span>
      <input type="number" min="5" max="180" class="interval-input" value="${reminders.sit.interval}">
    </label>
  `;
  grid.appendChild(sitCard);
}

function settingShell(icon, title, enabled, toggleKey, typeKey) {
  const style = eventStyle(typeKey);
  const card = document.createElement("section");
  card.className = "setting-card";
  card.style.setProperty("--type-color", style.color);
  const head = document.createElement("div");
  head.className = "setting-head";
  const titleWrap = document.createElement("span");
  titleWrap.className = "setting-title";
  titleWrap.innerHTML = `<svg><use href="#${icon}"></use></svg><strong>${title}</strong>`;
  head.appendChild(titleWrap);
  if (toggleKey) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "toggle";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(enabled));
    toggle.dataset.setting = toggleKey;
    toggle.setAttribute("aria-label", title);
    head.appendChild(toggle);
  }
  const body = document.createElement("div");
  body.className = "setting-body";
  if (!enabled && toggleKey) body.classList.add("is-off");
  card.appendChild(head);
  card.appendChild(body);
  return card;
}

function renderTimeRows(container, times) {
  container.replaceChildren(
    ...times.map((time, index) => {
      const row = document.createElement("div");
      row.className = "time-row";
      row.innerHTML = `
        <input type="time" class="time-input" data-time-index="${index}" value="${time}" aria-label="提醒时间">
        <button type="button" class="icon-btn remove-time" data-remove-index="${index}" aria-label="删除时间"><svg><use href="#icon-trash"></use></svg></button>
      `;
      return row;
    })
  );
}

function permissionText() {
  if (!("Notification" in window)) return "浏览器不支持";
  if (Notification.permission === "granted") return "已开启";
  if (Notification.permission === "denied") return "已被拒绝";
  return "待允许";
}

function updateNotificationUI() {
  const granted = "Notification" in window && Notification.permission === "granted";
  els.notificationState.textContent = granted ? "通知已开启" : "通知未开启";
  els.notificationState.classList.toggle("is-on", granted);
  els.notificationState.classList.toggle("is-denied", "Notification" in window && Notification.permission === "denied");
}

function renderAll() {
  updateTodayLabel();
  renderOverview();
  renderTimeline();
  renderCheckin();
  renderWeek();
  renderSettings();
  updateNotificationUI();
}

function persistReminders() {
  save(STORAGE_KEYS.reminders, reminders);
}

function persistSettings() {
  save(STORAGE_KEYS.settings, settings);
}

function setSetting(key, value) {
  settings[key] = value;
  persistSettings();
  renderOverview();
  renderTimeline();
  renderCheckin();
  renderWeek();
  updateNotificationUI();
  scheduleSit();
}

function setGoal(key, value) {
  settings.goals[key] = Math.max(1, Math.round(value));
  persistSettings();
  renderOverview();
  renderCheckin();
  renderWeek();
}

function setEnabled(key, value) {
  reminders[key].enabled = value;
  persistReminders();
  renderAll();
  scheduleSit();
}

function setTime(key, index, value) {
  if (!isValidTime(value)) return;
  reminders[key].times[index] = value;
  persistReminders();
  renderOverview();
  renderTimeline();
}

function addTime(key) {
  const used = reminders[key].times;
  const candidate = used.length ? nextQuarterHour(used[used.length - 1]) : "09:00";
  reminders[key].times.push(candidate);
  persistReminders();
  renderSettings();
  renderTimeline();
}

function nextQuarterHour(time) {
  const [hour, minute] = time.split(":").map(Number);
  const total = hour * 60 + minute + 30;
  const nextHour = Math.floor(total / 60) % 24;
  const nextMinute = total % 60;
  return `${pad(nextHour)}:${pad(nextMinute)}`;
}

function removeTime(key, index) {
  if (reminders[key].times.length <= 1) return;
  reminders[key].times.splice(index, 1);
  persistReminders();
  renderSettings();
  renderTimeline();
}

function setSitInterval(value) {
  reminders.sit.interval = Math.min(180, Math.max(5, Math.round(value)));
  persistReminders();
  renderTimeline();
  scheduleSit();
}

function addWater() {
  const checkin = todayCheckin();
  checkin.water += 1;
  save(STORAGE_KEYS.checkins, checkins);
  renderAll();
}

function minusWater() {
  const checkin = todayCheckin();
  checkin.water = Math.max(0, checkin.water - 1);
  save(STORAGE_KEYS.checkins, checkins);
  renderAll();
}

function toggleExercise() {
  const checkin = todayCheckin();
  checkin.exercise = checkin.exercise ? 0 : 1;
  save(STORAGE_KEYS.checkins, checkins);
  renderAll();
}

function addSit() {
  const checkin = todayCheckin();
  checkin.sit += 1;
  save(STORAGE_KEYS.checkins, checkins);
  renderAll();
}

function sleepHours(bed, wake) {
  const [bh, bm] = bed.split(":").map(Number);
  const [wh, wm] = wake.split(":").map(Number);
  let minutes = wh * 60 + wm - (bh * 60 + bm);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 10) / 10;
}

function openSleepDialog() {
  const checkin = todayCheckin();
  els.sleepBed.value = checkin.sleep ? checkin.sleep.bed : reminders.sleep.times[0] || "22:30";
  els.sleepWake.value = checkin.sleep ? checkin.sleep.wake : reminders.wake.times[0] || "07:00";
  updateSleepPreview();
  els.sleepDialog.showModal();
}

function updateSleepPreview() {
  const hours = sleepHours(els.sleepBed.value || "00:00", els.sleepWake.value || "00:00");
  els.sleepPreview.textContent = `约 ${hours.toFixed(1)} 小时`;
}

function saveSleep(event) {
  event.preventDefault();
  const checkin = todayCheckin();
  const bed = els.sleepBed.value;
  const wake = els.sleepWake.value;
  if (!bed || !wake) return;
  checkin.sleep = { bed, wake, hours: sleepHours(bed, wake) };
  save(STORAGE_KEYS.checkins, checkins);
  els.sleepDialog.close();
  renderAll();
}

function performAction(action) {
  if (action === "water") addWater();
  else if (action === "water-minus") minusWater();
  else if (action === "sleep" || action === "wake") openSleepDialog();
  else if (action === "exercise") toggleExercise();
  else if (action === "sit") addSit();
}

function showBanner({ title, message, action }) {
  const banner = document.createElement("div");
  banner.className = "banner";
  const copy = document.createElement("div");
  copy.className = "banner-copy";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const span = document.createElement("span");
  span.textContent = message;
  copy.append(strong, span);

  const actions = document.createElement("div");
  actions.className = "banner-actions";
  if (action) {
    const checkinBtn = document.createElement("button");
    checkinBtn.type = "button";
    checkinBtn.className = "mini-btn is-primary";
    checkinBtn.textContent = "打卡";
    checkinBtn.addEventListener("click", () => {
      performAction(action);
      banner.remove();
    });
    actions.appendChild(checkinBtn);
  }
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "mini-btn";
  closeBtn.textContent = "关闭";
  closeBtn.addEventListener("click", () => banner.remove());
  actions.appendChild(closeBtn);

  banner.append(copy, actions);
  els.bannerStack.appendChild(banner);
  window.setTimeout(() => banner.remove(), 12000);
}

function notify(title, body) {
  if (!settings.notifications || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const notification = new Notification(title, { body });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch (err) {
    // Fallback banner already handles the reminder.
  }
}

function playChime() {
  if (!settings.sound) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    audioCtx = audioCtx || new AudioCtx();
    const now = audioCtx.currentTime;
    [0, 0.18].forEach((offset, index) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = index === 0 ? 523 : 659;
      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.2, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.5);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.55);
    });
  } catch (err) {
    // Sound is optional.
  }
}

function fireEvent(event) {
  playChime();
  showBanner(event);
  notify(event.title, event.message);
}

function checkReminders() {
  const now = new Date();
  const current = hhmm(now);
  if (current === lastCheckMinute) return;
  lastCheckMinute = current;
  getEvents().forEach((event) => {
    if (event.time === current && !firedToday.has(event.id)) {
      firedToday.add(event.id);
      fireEvent(event);
    }
  });
}

function scheduleSit() {
  if (sitTimer) window.clearTimeout(sitTimer);
  sitTimer = null;
  sitNextAt = null;
  if (!reminders.sit.enabled) {
    renderTimeline();
    return;
  }
  sitNextAt = new Date(Date.now() + reminders.sit.interval * 60 * 1000);
  sitTimer = window.setTimeout(() => {
    fireEvent({
      id: `sit-${Date.now()}`,
      type: "sit",
      time: hhmm(new Date()),
      title: "活动身体",
      message: `已连续久坐 ${reminders.sit.interval} 分钟`,
      action: "sit",
    });
    scheduleSit();
  }, reminders.sit.interval * 60 * 1000);
  renderTimeline();
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    updateNotificationUI();
    renderSettings();
    return;
  }
  const result = await Notification.requestPermission();
  if (result === "granted" && settings.notifications) {
    notify("提醒已开启", "浏览器通知已经可用");
  }
  updateNotificationUI();
  renderSettings();
}

function resetAll() {
  reminders = structuredClone(DEFAULT_REMINDERS);
  settings = structuredClone(DEFAULT_SETTINGS);
  persistReminders();
  persistSettings();
  firedToday.clear();
  renderAll();
  scheduleSit();
}

els.bellButton.addEventListener("click", () => requestNotificationPermission());
els.resetButton.addEventListener("click", () => {
  if (window.confirm("恢复默认提醒计划和设置？")) resetAll();
});

els.checkinGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) performAction(button.dataset.action);
});

els.timelineList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) performAction(button.dataset.action);
});

els.settingsGrid.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-setting]");
  if (toggle) {
    const key = toggle.dataset.setting;
    const next = toggle.getAttribute("aria-checked") !== "true";
    setSetting(key, next);
    if (key === "notifications" && next) requestNotificationPermission();
    renderSettings();
    return;
  }

  const addButton = event.target.closest("[data-add-time]");
  if (addButton) {
    addTime(addButton.dataset.addTime);
    return;
  }

  const removeButton = event.target.closest("[data-remove-index]");
  if (removeButton) {
    const list = removeButton.closest("[data-times]");
    if (list) removeTime(list.dataset.times, Number(removeButton.dataset.removeIndex));
  }
});

els.settingsGrid.addEventListener("input", (event) => {
  const timeInput = event.target.closest(".time-input");
  if (timeInput) {
    const list = timeInput.closest("[data-times]");
    if (list) setTime(list.dataset.times, Number(timeInput.dataset.timeIndex), timeInput.value);
    return;
  }

  const goalInput = event.target.closest(".goal-input");
  if (goalInput && goalInput.value) {
    setGoal(goalInput.dataset.goal, Number(goalInput.value));
    return;
  }

  const intervalInput = event.target.closest(".interval-input");
  if (intervalInput && intervalInput.value) {
    setSitInterval(Number(intervalInput.value));
  }
});

els.settingsGrid.addEventListener("change", (event) => {
  const toggle = event.target.closest("[data-setting]");
  if (toggle) {
    const key = toggle.dataset.setting;
    const next = toggle.getAttribute("aria-checked") !== "true";
    setSetting(key, next);
    if (key === "notifications" && next) requestNotificationPermission();
    renderSettings();
  }
});

els.sleepClose.addEventListener("click", () => els.sleepDialog.close());
els.sleepCancel.addEventListener("click", () => els.sleepDialog.close());
els.sleepBed.addEventListener("input", updateSleepPreview);
els.sleepWake.addEventListener("input", updateSleepPreview);
els.sleepForm.addEventListener("submit", saveSleep);

window.addEventListener("storage", (event) => {
  if (!event.key) return;
  const key = event.key;
  if (key === STORAGE_KEYS.reminders) reminders = loadState(STORAGE_KEYS.reminders, DEFAULT_REMINDERS, mergeReminders);
  if (key === STORAGE_KEYS.settings) settings = loadState(STORAGE_KEYS.settings, DEFAULT_SETTINGS, mergeSettings);
  if (key === STORAGE_KEYS.checkins) checkins = loadState(STORAGE_KEYS.checkins, {}, (saved) => saved);
  renderAll();
  scheduleSit();
});

renderAll();
scheduleSit();
window.setInterval(checkReminders, 20000);
window.addEventListener("focus", () => {
  lastCheckMinute = "";
  checkReminders();
});
