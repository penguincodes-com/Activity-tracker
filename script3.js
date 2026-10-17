/* DAYFLOW — Activity Tracker (Optimized Senior Dev Edition)
   Vanilla JavaScript + LocalStorage + Event Delegation + PWA Support
*/

"use strict";

const STORAGE_KEY = "dayflow.activities.v1";
const THEME_KEY = "dayflow.theme.v1";
const CODE_PREFIX = "DF1";

const $ = (selector) => document.querySelector(selector);

const elements = {
  todayLabel: $("#todayLabel"),
  headerDate: $("#headerDate"),
  footerYear: $("#footerYear"),
  themeColorMeta: $("#themeColorMeta"),
  installBtn: $("#installBtn"),

  selectedDate: $("#selectedDate"),
  taskForm: $("#taskForm"),
  taskInput: $("#taskInput"),
  taskList: $("#taskList"),
  emptyState: $("#emptyState"),
  taskCount: $("#taskCount"),
  completedToday: $("#completedToday"),
  currentStreak: $("#currentStreak"),
  longestStreak: $("#longestStreak"),
  todayProgress: $("#todayProgress"),
  todayProgressBar: $("#todayProgressBar"),
  todayProgressTrack: $("#todayProgressTrack"),
  listDateLabel: $("#listDateLabel"),
  remainingLabel: $("#remainingLabel"),
  formMessage: $("#formMessage"),
  saveStatusText: $("#saveStatusText"),
  themeToggle: $("#themeToggle"),
  todayButton: $("#todayButton"),
  clearCompleted: $("#clearCompleted"),

  chartWrap: $("#chartWrap"),
  weeklyTotal: $("#weeklyTotal"),
  chartFallback: $("#chartFallback"),

  toast: $("#toast"),
  editDialog: $("#editDialog"),
  editForm: $("#editForm"),
  editTaskInput: $("#editTaskInput"),
  cancelEdit: $("#cancelEdit"),

  exportCodeOutput: $("#exportCodeOutput"),
  generateCodeBtn: $("#generateCodeBtn"),
  copyCodeBtn: $("#copyCodeBtn"),
  importForm: $("#importForm"),
  importCodeInput: $("#importCodeInput"),
  importMode: $("#importMode"),
  syncMessage: $("#syncMessage")
};

let tasks = loadTasks();
let editingTaskId = null;
let chart = null;
let toastTimer = null;
let messageTimer = null;
let syncMessageTimer = null;
let cachedTransferCode = null; // Lazy cache for expensive Base64 transfer code

/* ---------- Dates ---------- */

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function shiftDate(key, amount) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}

function formatDate(key, options = {}) {
  return dateFromKey(key).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...options
  });
}

function isValidDateKey(key) {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const date = dateFromKey(key);
  return !Number.isNaN(date.getTime()) && localDateKey(date) === key;
}

function selectedDay() {
  return elements.selectedDate.value;
}

/* ---------- Storage ---------- */

function sanitizeTask(task) {
  if (
    !task ||
    typeof task.id !== "string" ||
    typeof task.title !== "string" ||
    !isValidDateKey(task.date) ||
    typeof task.completed !== "boolean"
  ) {
    return null;
  }

  const cleanTitle = task.title.trim().slice(0, 120);
  if (!cleanTitle) return null;

  return {
    id: task.id.slice(0, 64),
    title: cleanTitle,
    date: task.date,
    completed: task.completed,
    createdAt: Number.isFinite(task.createdAt) ? task.createdAt : Date.now()
  };
}

function loadTasks() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const data = JSON.parse(stored);
    return Array.isArray(data) ? data.map(sanitizeTask).filter(Boolean) : [];
  } catch (error) {
    console.error("Could not read Dayflow data:", error);
    return [];
  }
}

function saveTasks() {
  cachedTransferCode = null; // Invalidate transfer code cache on data change
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    if (elements.saveStatusText) elements.saveStatusText.textContent = "Saved locally";
    return true;
  } catch (error) {
    console.error("Could not save Dayflow data:", error);
    if (elements.saveStatusText) elements.saveStatusText.textContent = "Save failed";
    showToast("Unable to save. Check your browser storage settings.");
    return false;
  }
}

/* ---------- Portable Transfer Code (Export / Import) ---------- */

function computeChecksum(bytes) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function bytesToBase64Url(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function createTransferCode() {
  if (tasks.length === 0) return "";
  if (cachedTransferCode !== null) return cachedTransferCode;

  const payload = {
    v: 1,
    t: tasks.map((task) => [
      task.id,
      task.title,
      task.date,
      task.completed ? 1 : 0,
      task.createdAt
    ])
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));
  const checksum = computeChecksum(jsonBytes);
  const encodedPayload = bytesToBase64Url(jsonBytes);

  cachedTransferCode = `${CODE_PREFIX}-${checksum}-${encodedPayload}`;
  return cachedTransferCode;
}

function parseTransferCode(rawCode) {
  const cleaned = rawCode.trim();
  const parts = cleaned.split("-");

  if (parts.length !== 3 || parts[0] !== CODE_PREFIX) {
    throw new Error("Invalid code format. Code must start with 'DF1-'.");
  }

  const [, expectedChecksum, encodedPayload] = parts;

  if (!/^[0-9a-f]{8}$/i.test(expectedChecksum) || !encodedPayload) {
    throw new Error("Transfer code appears incomplete or corrupted.");
  }

  let bytes;
  try {
    bytes = base64UrlToBytes(encodedPayload);
  } catch {
    throw new Error("Could not decode transfer code. Check for missing characters.");
  }

  const actualChecksum = computeChecksum(bytes);
  if (actualChecksum.toLowerCase() !== expectedChecksum.toLowerCase()) {
    throw new Error("Code checksum mismatch. Please copy the entire code again.");
  }

  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Transfer code payload is corrupted.");
  }

  if (!parsed || !Array.isArray(parsed.t)) {
    throw new Error("Transfer code does not contain valid activity data.");
  }

  return parsed.t
    .map((tuple) => {
      if (!Array.isArray(tuple) || tuple.length < 4) return null;
      return sanitizeTask({
        id: String(tuple[0]),
        title: String(tuple[1]),
        date: String(tuple[2]),
        completed: Boolean(tuple[3]),
        createdAt: Number(tuple[4]) || Date.now()
      });
    })
    .filter(Boolean);
}

function refreshExportCodeField(forceGenerate = false) {
  if (!elements.exportCodeOutput) return;

  if (tasks.length === 0) {
    elements.exportCodeOutput.value = "";
    elements.exportCodeOutput.placeholder = "Add an activity to generate a code";
    elements.copyCodeBtn.disabled = true;
  } else {
    elements.copyCodeBtn.disabled = false;
    if (forceGenerate || tasks.length <= 250) {
      elements.exportCodeOutput.value = createTransferCode();
    } else {
      elements.exportCodeOutput.value = "";
      elements.exportCodeOutput.placeholder = "Click Copy or Refresh to generate code";
    }
  }
}

function showSyncMessage(text, isError = false) {
  elements.syncMessage.textContent = text;
  elements.syncMessage.classList.toggle("error", isError);

  window.clearTimeout(syncMessageTimer);
  syncMessageTimer = window.setTimeout(() => {
    elements.syncMessage.textContent = "";
    elements.syncMessage.classList.remove("error");
  }, 4000);
}

async function handleCopyTransferCode() {
  refreshExportCodeField(true);
  const code = elements.exportCodeOutput.value;

  if (!code) {
    showToast("No activities to export yet.");
    return;
  }

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(code);
    } else {
      elements.exportCodeOutput.focus();
      elements.exportCodeOutput.select();
      document.execCommand("copy");
    }
    showToast("Transfer code copied to clipboard!");
  } catch {
    elements.exportCodeOutput.focus();
    elements.exportCodeOutput.select();
    showToast("Code selected — press Ctrl+C / Cmd+C to copy.");
  }
}

function handleImportTransferCode(event) {
  event.preventDefault();

  const rawCode = elements.importCodeInput.value.trim();
  if (!rawCode) {
    showSyncMessage("Please paste a transfer code first.", true);
    elements.importCodeInput.focus();
    return;
  }

  try {
    const incomingTasks = parseTransferCode(rawCode);

    if (incomingTasks.length === 0) {
      showSyncMessage("That code contains 0 valid tasks.", true);
      return;
    }

    const mode = elements.importMode.value;

    if (mode === "replace") {
      if (tasks.length > 0) {
        const confirmed = window.confirm(
          `Replace your ${tasks.length} current task(s) with ${incomingTasks.length} imported task(s)?`
        );
        if (!confirmed) return;
      }
      tasks = incomingTasks.slice(0, 10000);
    } else {
      const byId = new Map(tasks.map((task) => [task.id, task]));
      const signatureSet = new Set(
        tasks.map((task) => `${task.date}::${task.title.toLowerCase()}`)
      );

      for (const item of incomingTasks) {
        const sig = `${item.date}::${item.title.toLowerCase()}`;
        if (byId.has(item.id)) {
          const existing = byId.get(item.id);
          existing.title = item.title;
          existing.completed = existing.completed || item.completed;
        } else if (!signatureSet.has(sig)) {
          byId.set(item.id, item);
          signatureSet.add(sig);
        }
      }

      tasks = [...byId.values()].slice(0, 10000);
    }

    saveTasks();
    renderAll();
    elements.importCodeInput.value = "";
    showSyncMessage(`Successfully imported ${incomingTasks.length} task(s)!`, false);
    showToast(`Progress synced (${incomingTasks.length} activities).`);
  } catch (error) {
    showSyncMessage(error.message || "Invalid transfer code.", true);
  }
}

/* ---------- Task Management ---------- */

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function addTask(title, date) {
  const cleanTitle = title.trim();
  if (!cleanTitle || !isValidDateKey(date)) return false;

  if (tasks.length >= 10000) {
    showToast("You've reached the task limit for this browser.");
    return false;
  }

  tasks.push({
    id: createId(),
    title: cleanTitle.slice(0, 120),
    date,
    completed: false,
    createdAt: Date.now()
  });

  saveTasks();
  renderAll();
  showToast("Activity added successfully.");
  return true;
}

function toggleTask(id, completed) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return;

  task.completed = completed;
  saveTasks();
  renderAll();
}

function deleteTask(id, listItem) {
  if (!tasks.some((task) => task.id === id)) return;

  if (listItem) {
    if (listItem.dataset.removing === "true") return;
    listItem.dataset.removing = "true";
    listItem.classList.add("removing");

    window.setTimeout(() => {
      tasks = tasks.filter((task) => task.id !== id);
      saveTasks();
      renderAll();
      showToast("Activity deleted.");
    }, 190);
  } else {
    tasks = tasks.filter((task) => task.id !== id);
    saveTasks();
    renderAll();
  }
}

function openEditDialog(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return;

  editingTaskId = id;
  elements.editTaskInput.value = task.title;
  elements.editDialog.showModal();
  elements.editTaskInput.focus();
}

function saveEditedTask(title) {
  const cleanTitle = title.trim();
  if (!cleanTitle) {
    elements.editTaskInput.focus();
    return;
  }

  const task = tasks.find((item) => item.id === editingTaskId);
  if (task) {
    task.title = cleanTitle.slice(0, 120);
    saveTasks();
    renderAll();
    showToast("Changes saved.");
  }

  editingTaskId = null;
  elements.editDialog.close();
}

function clearCompletedTasks() {
  const date = selectedDay();
  const completed = tasks.filter((task) => task.date === date && task.completed);

  if (completed.length === 0) {
    showToast("No completed tasks to clear.");
    return;
  }

  const confirmed = window.confirm(
    `Delete ${completed.length} completed task(s) for ${formatDate(date)}?`
  );
  if (!confirmed) return;

  const completedIds = new Set(completed.map((task) => task.id));
  tasks = tasks.filter((task) => !completedIds.has(task.id));

  saveTasks();
  renderAll();
  showToast("Completed tasks cleared.");
}

/* ---------- Single-Pass Indexing & Rendering ---------- */

function buildTaskMetrics(selectedDate, todayDate) {
  const dayTasks = [];
  let todaysTotal = 0;
  let todaysDone = 0;
  const completedCountByDate = new Map();

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    if (task.date === selectedDate) {
      dayTasks.push(task);
    }
    if (task.date === todayDate) {
      todaysTotal++;
      if (task.completed) todaysDone++;
    }
    if (task.completed) {
      completedCountByDate.set(
        task.date,
        (completedCountByDate.get(task.date) || 0) + 1
      );
    }
  }

  dayTasks.sort((a, b) => a.createdAt - b.createdAt);

  // Calculate streaks from completedCountByDate keys
  const sortedActiveDays = [...completedCountByDate.keys()].sort();
  let currentStreak = 0;
  let longestStreak = 0;
  let run = 0;
  let previous = null;

  for (const day of sortedActiveDays) {
    if (previous && shiftDate(previous, 1) === day) {
      run++;
    } else {
      run = 1;
    }
    longestStreak = Math.max(longestStreak, run);
    previous = day;
  }

  let cursor = completedCountByDate.has(todayDate)
    ? todayDate
    : shiftDate(todayDate, -1);

  while (completedCountByDate.has(cursor)) {
    currentStreak++;
    cursor = shiftDate(cursor, -1);
  }

  return {
    dayTasks,
    todaysTotal,
    todaysDone,
    completedCountByDate,
    currentStreak,
    longestStreak
  };
}

function createTaskListItem(task) {
  const item = document.createElement("li");
  item.className = `task-item${task.completed ? " completed" : ""}`;
  item.dataset.id = task.id;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "task-check";
  checkbox.checked = task.completed;
  checkbox.setAttribute(
    "aria-label",
    `${task.completed ? "Mark incomplete" : "Mark complete"}: ${task.title}`
  );

  const content = document.createElement("div");
  content.className = "task-content";

  const name = document.createElement("span");
  name.className = "task-name";
  name.textContent = task.title;

  const time = document.createElement("span");
  time.className = "task-time";
  time.textContent = task.completed ? "Completed ✓" : "On your list";

  content.append(name, time);

  const actions = document.createElement("div");
  actions.className = "task-actions";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "task-action";
  editButton.dataset.action = "edit";
  editButton.setAttribute("aria-label", `Edit ${task.title}`);
  editButton.title = `Edit ${task.title}`;
  editButton.textContent = "✎";

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "task-action delete";
  deleteButton.dataset.action = "delete";
  deleteButton.setAttribute("aria-label", `Delete ${task.title}`);
  deleteButton.title = `Delete ${task.title}`;
  deleteButton.textContent = "×";

  actions.append(editButton, deleteButton);
  item.append(checkbox, content, actions);
  return item;
}

function renderHeader() {
  const today = new Date();

  elements.headerDate.textContent = today.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });

  elements.todayLabel.textContent = today
    .toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric"
    })
    .toUpperCase();

  elements.footerYear.textContent = today.getFullYear();
}

function renderChart(completedCountByDate, today) {
  if (typeof window.Chart === "undefined") {
    elements.chartFallback.hidden = false;
    elements.chartWrap.hidden = true;
    return;
  }

  elements.chartFallback.hidden = true;
  elements.chartWrap.hidden = false;

  const labels = [];
  const values = [];

  for (let offset = 6; offset >= 0; offset--) {
    const date = shiftDate(today, -offset);
    labels.push(
      dateFromKey(date).toLocaleDateString(undefined, { weekday: "short" })
    );
    values.push(completedCountByDate.get(date) || 0);
  }

  elements.weeklyTotal.textContent = `${values.reduce((sum, v) => sum + v, 0)} total`;

  const styles = getComputedStyle(document.body);
  const textColor = styles.getPropertyValue("--muted").trim();
  const gridColor = styles.getPropertyValue("--border").trim();
  const accentColor = styles.getPropertyValue("--accent").trim();
  const tooltipBg = styles.getPropertyValue("--surface-3").trim();
  const titleColor = styles.getPropertyValue("--text").trim();

  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.data.datasets[0].backgroundColor = accentColor;
    chart.data.datasets[0].hoverBackgroundColor = accentColor;
    chart.options.scales.x.ticks.color = textColor;
    chart.options.scales.y.ticks.color = textColor;
    chart.options.scales.y.grid.color = gridColor;
    chart.options.scales.y.suggestedMax = Math.max(3, ...values);
    chart.options.plugins.tooltip.backgroundColor = tooltipBg;
    chart.options.plugins.tooltip.titleColor = titleColor;
    chart.options.plugins.tooltip.bodyColor = titleColor;
    chart.options.plugins.tooltip.borderColor = gridColor;
    chart.update();
    return;
  }

  chart = new window.Chart($("#activityChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Completed tasks",
          data: values,
          backgroundColor: accentColor,
          hoverBackgroundColor: accentColor,
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 25
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: tooltipBg,
          titleColor,
          bodyColor: titleColor,
          borderColor: gridColor,
          borderWidth: 1,
          displayColors: false,
          callbacks: {
            label: (ctx) =>
              `${ctx.parsed.y} completed task${ctx.parsed.y === 1 ? "" : "s"}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: textColor, font: { size: 10 } }
        },
        y: {
          beginAtZero: true,
          suggestedMax: Math.max(3, ...values),
          ticks: { color: textColor, precision: 0, stepSize: 1, font: { size: 10 } },
          grid: { color: gridColor },
          border: { display: false }
        }
      }
    }
  });
}

function renderAll() {
  const date = selectedDay();
  const today = localDateKey();
  const metrics = buildTaskMetrics(date, today);

  renderHeader();

  // Batch DOM updates with DocumentFragment
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < metrics.dayTasks.length; i++) {
    fragment.appendChild(createTaskListItem(metrics.dayTasks[i]));
  }
  elements.taskList.replaceChildren(fragment);

  const count = metrics.dayTasks.length;
  elements.emptyState.hidden = count > 0;
  elements.taskCount.textContent = `${count} ${count === 1 ? "task" : "tasks"}`;

  const done = metrics.dayTasks.filter((t) => t.completed).length;
  const pending = count - done;

  elements.remainingLabel.textContent = pending
    ? `${pending} remaining`
    : count
      ? "All done ✓"
      : "Nothing pending";

  elements.listDateLabel.textContent =
    date === today
      ? "Today's list"
      : dateFromKey(date).toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric"
        });

  const todayPercentage = metrics.todaysTotal
    ? Math.round((metrics.todaysDone / metrics.todaysTotal) * 100)
    : 0;

  elements.completedToday.textContent = metrics.todaysDone;
  elements.todayProgress.textContent = `${todayPercentage}%`;
  elements.todayProgressBar.style.width = `${todayPercentage}%`;
  elements.todayProgressTrack.setAttribute(
    "aria-label",
    `${todayPercentage}% of today's tasks completed`
  );

  elements.currentStreak.textContent = metrics.currentStreak;
  elements.longestStreak.textContent = metrics.longestStreak;

  renderChart(metrics.completedCountByDate, today);
  refreshExportCodeField(false);
}

/* ---------- Theme ---------- */

function applyTheme(theme) {
  const light = theme === "light";

  document.body.classList.toggle("light-theme", light);
  elements.themeToggle.textContent = light ? "☾" : "☼";
  elements.themeToggle.setAttribute(
    "aria-label",
    light ? "Switch to dark theme" : "Switch to light theme"
  );
  elements.themeToggle.title = light
    ? "Switch to dark theme"
    : "Switch to light theme";

  if (elements.themeColorMeta) {
    elements.themeColorMeta.setAttribute("content", light ? "#ebeaf4" : "#101114");
  }

  try {
    localStorage.setItem(THEME_KEY, light ? "light" : "dark");
  } catch (error) {
    console.warn("Theme preference could not be saved.", error);
  }

  if (chart) {
    const today = localDateKey();
    const metrics = buildTaskMetrics(selectedDay(), today);
    renderChart(metrics.completedCountByDate, today);
  }
}

function loadTheme() {
  try {
    const savedTheme = localStorage.getItem(THEME_KEY);
    applyTheme(savedTheme === "light" ? "light" : "dark");
  } catch {
    applyTheme("dark");
  }
}

/* ---------- Feedback ---------- */

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");

  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 3000);
}

/* ---------- Event Listeners ---------- */

// Delegated listener for all task list items (checkbox, edit, delete)
elements.taskList.addEventListener("change", (event) => {
  if (!event.target.classList.contains("task-check")) return;
  const item = event.target.closest(".task-item");
  if (item) toggleTask(item.dataset.id, event.target.checked);
});

elements.taskList.addEventListener("click", (event) => {
  const actionBtn = event.target.closest("[data-action]");
  if (!actionBtn) return;

  const item = actionBtn.closest(".task-item");
  if (!item) return;

  const { id } = item.dataset;
  if (actionBtn.dataset.action === "edit") {
    openEditDialog(id);
  } else if (actionBtn.dataset.action === "delete") {
    deleteTask(id, item);
  }
});

elements.taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const date = selectedDay();
  const title = elements.taskInput.value;

  if (!title.trim()) {
    elements.formMessage.textContent = "Please enter an activity name.";
    window.clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => {
      elements.formMessage.textContent = "";
    }, 2500);
    elements.taskInput.focus();
    return;
  }

  if (addTask(title, date)) {
    elements.taskInput.value = "";
    elements.formMessage.textContent = "";
    elements.taskInput.focus();
  }
});

elements.selectedDate.addEventListener("change", () => {
  if (!isValidDateKey(selectedDay())) {
    elements.selectedDate.value = localDateKey();
  }
  renderAll();
});

elements.todayButton.addEventListener("click", () => {
  elements.selectedDate.value = localDateKey();
  renderAll();
});

elements.clearCompleted.addEventListener("click", clearCompletedTasks);

elements.themeToggle.addEventListener("click", () => {
  const nextTheme = document.body.classList.contains("light-theme") ? "dark" : "light";
  applyTheme(nextTheme);
});

elements.editForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveEditedTask(elements.editTaskInput.value);
});

elements.cancelEdit.addEventListener("click", () => {
  editingTaskId = null;
  elements.editDialog.close();
});

elements.editDialog.addEventListener("close", () => {
  editingTaskId = null;
});

elements.generateCodeBtn.addEventListener("click", () => {
  refreshExportCodeField(true);
  if (elements.exportCodeOutput.value) {
    elements.exportCodeOutput.focus();
    elements.exportCodeOutput.select();
    showToast("Transfer code refreshed.");
  } else {
    showToast("Add at least one activity to generate a code.");
  }
});

elements.copyCodeBtn.addEventListener("click", handleCopyTransferCode);
elements.importForm.addEventListener("submit", handleImportTransferCode);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) renderAll();
});

/* ---------- Android APK Button Logic ---------- */
const isInsideAndroidApk = /; wv\)/i.test(navigator.userAgent) || window.Capacitor !== undefined;

if (isInsideAndroidApk && elements.installBtn) {
  // Hide the download button when the user is already inside the installed Android APK
  elements.installBtn.hidden = true;
}