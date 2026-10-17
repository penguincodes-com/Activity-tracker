/* DAYFLOW — Activity Tracker
   Vanilla JavaScript + LocalStorage + Portable Transfer Codes
*/

"use strict";

const STORAGE_KEY = "dayflow.activities.v1";
const THEME_KEY = "dayflow.theme.v1";
const CODE_PREFIX = "DF1";

const $ = (selector) => document.querySelector(selector);

const elements = {
  // Header & Footer (Fixed missing references that caused startup crash)
  todayLabel: $("#todayLabel"),
  headerDate: $("#headerDate"),
  footerYear: $("#footerYear"),
  themeColorMeta: $("#themeColorMeta"),

  //install button
  installBtn: $("#installBtn"),

  // Main Tasks & Stats
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
  listDateLabel: $("#listDateLabel"),
  remainingLabel: $("#remainingLabel"),
  formMessage: $("#formMessage"),
  saveStatus: $("#saveStatus"),
  themeToggle: $("#themeToggle"),
  todayButton: $("#todayButton"),
  clearCompleted: $("#clearCompleted"),

  // Chart
  chartWrap: $("#chartWrap"),
  weeklyTotal: $("#weeklyTotal"),
  chartFallback: $("#chartFallback"),

  // Dialog & Toast
  toast: $("#toast"),
  editDialog: $("#editDialog"),
  editForm: $("#editForm"),
  editTaskInput: $("#editTaskInput"),

  // Import / Export Sync
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
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return false;
  }

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
    if (!Array.isArray(data)) return [];

    return data.map(sanitizeTask).filter(Boolean);
  } catch (error) {
    console.error("Could not read Dayflow data:", error);
    return [];
  }
}

function saveTasks() {
  elements.saveStatus.innerHTML =
    '<span class="status-dot"></span> Saving...';

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));

    elements.saveStatus.innerHTML =
      '<span class="status-dot"></span> Saved locally';

    return true;
  } catch (error) {
    console.error("Could not save Dayflow data:", error);

    elements.saveStatus.textContent = "Save failed";
    showToast("Unable to save. Check your browser storage settings.");
    return false;
  }
}

/* ---------- Portable Transfer Code (Export / Import) ---------- */

// 32-bit FNV-1a checksum to detect typos or truncated transfer codes.
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
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function createTransferCode() {
  if (tasks.length === 0) return "";

  // Pack tasks as compact tuples: [id, title, date, completed(0|1), createdAt]
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

  return `${CODE_PREFIX}-${checksum}-${encodedPayload}`;
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

  const importedTasks = parsed.t
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

  return importedTasks;
}

function refreshExportCodeField() {
  if (!elements.exportCodeOutput) return;

  if (tasks.length === 0) {
    elements.exportCodeOutput.value = "";
    elements.exportCodeOutput.placeholder = "Add an activity to generate a code";
    elements.copyCodeBtn.disabled = true;
  } else {
    elements.exportCodeOutput.value = createTransferCode();
    elements.copyCodeBtn.disabled = false;
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
  refreshExportCodeField();
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
      // Merge mode: update matching IDs or deduplicate identical (title + date)
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

/* ---------- Task management ---------- */

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getTasksForDay(date) {
  return tasks
    .filter((task) => task.date === date)
    .sort((a, b) => a.createdAt - b.createdAt);
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
  const completed = tasks.filter(
    (task) => task.date === date && task.completed
  );

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

/* ---------- Streak calculations ---------- */

function activeDays() {
  const days = new Set();

  tasks.forEach((task) => {
    if (task.completed) days.add(task.date);
  });

  return days;
}

function calculateStreaks() {
  const days = activeDays();
  const today = localDateKey();
  let current = 0;
  let longest = 0;

  const sorted = [...days].sort();

  let run = 0;
  let previous = null;

  for (const day of sorted) {
    if (previous && shiftDate(previous, 1) === day) {
      run++;
    } else {
      run = 1;
    }

    longest = Math.max(longest, run);
    previous = day;
  }

  let cursor = days.has(today) ? today : shiftDate(today, -1);

  while (days.has(cursor)) {
    current++;
    cursor = shiftDate(cursor, -1);
  }

  return { current, longest };
}

/* ---------- Rendering ---------- */

function makeActionButton(label, symbol, className, callback) {
  const button = document.createElement("button");

  button.type = "button";
  button.className = `task-action ${className || ""}`.trim();
  button.setAttribute("aria-label", label);
  button.title = label;
  button.textContent = symbol;
  button.addEventListener("click", callback);

  return button;
}

function renderTasks() {
  const date = selectedDay();
  const dayTasks = getTasksForDay(date);

  elements.taskList.replaceChildren();

  dayTasks.forEach((task) => {
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

    checkbox.addEventListener("change", () => {
      toggleTask(task.id, checkbox.checked);
    });

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

    const editButton = makeActionButton(
      `Edit ${task.title}`,
      "✎",
      "",
      () => openEditDialog(task.id)
    );

    const deleteButton = makeActionButton(
      `Delete ${task.title}`,
      "×",
      "delete",
      () => deleteTask(task.id, item)
    );

    actions.append(editButton, deleteButton);
    item.append(checkbox, content, actions);
    elements.taskList.append(item);
  });

  elements.emptyState.hidden = dayTasks.length > 0;
  elements.taskCount.textContent =
    `${dayTasks.length} ${dayTasks.length === 1 ? "task" : "tasks"}`;

  const done = dayTasks.filter((task) => task.completed).length;
  const pending = dayTasks.length - done;

  elements.remainingLabel.textContent = pending
    ? `${pending} remaining`
    : dayTasks.length
      ? "All done ✓"
      : "Nothing pending";

  const today = localDateKey();

  if (date === today) {
    elements.listDateLabel.textContent = "Today's list";
  } else {
    elements.listDateLabel.textContent =
      dateFromKey(date).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric"
      });
  }

  const todaysTasks = getTasksForDay(today);
  const todaysDone = todaysTasks.filter((task) => task.completed).length;
  const todayPercentage = todaysTasks.length
    ? Math.round((todaysDone / todaysTasks.length) * 100)
    : 0;

  elements.completedToday.textContent = todaysDone;
  elements.todayProgress.textContent = `${todayPercentage}%`;
  elements.todayProgressBar.style.width = `${todayPercentage}%`;

  elements.todayProgressBar.parentElement.setAttribute(
    "aria-label",
    `${todayPercentage}% of today's tasks completed`
  );
}

function renderStreaks() {
  const streaks = calculateStreaks();

  elements.currentStreak.textContent = streaks.current;
  elements.longestStreak.textContent = streaks.longest;
}

function renderHeader() {
  const today = new Date();

  elements.headerDate.textContent = today.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });

  elements.todayLabel.textContent = today.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).toUpperCase();

  elements.footerYear.textContent = today.getFullYear();
}

/* ---------- Chart ---------- */

function renderChart() {
  if (typeof window.Chart === "undefined") {
    elements.chartFallback.hidden = false;
    elements.chartWrap.hidden = true;
    return;
  }

  elements.chartFallback.hidden = true;
  elements.chartWrap.hidden = false;

  const today = localDateKey();
  const labels = [];
  const values = [];

  for (let offset = 6; offset >= 0; offset--) {
    const date = shiftDate(today, -offset);
    const completed = tasks.filter(
      (task) => task.date === date && task.completed
    ).length;

    labels.push(
      dateFromKey(date).toLocaleDateString(undefined, {
        weekday: "short"
      })
    );

    values.push(completed);
  }

  elements.weeklyTotal.textContent =
    `${values.reduce((sum, value) => sum + value, 0)} total`;

  const styles = getComputedStyle(document.body);
  const textColor = styles.getPropertyValue("--muted").trim();
  const gridColor = styles.getPropertyValue("--border").trim();
  const accentColor = styles.getPropertyValue("--accent").trim();

  const config = {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Completed tasks",
        data: values,
        backgroundColor: accentColor,
        hoverBackgroundColor: accentColor,
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 25
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 350
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: styles.getPropertyValue("--surface-3").trim(),
          titleColor: styles.getPropertyValue("--text").trim(),
          bodyColor: styles.getPropertyValue("--text").trim(),
          borderColor: gridColor,
          borderWidth: 1,
          displayColors: false,
          callbacks: {
            label: (context) =>
              `${context.parsed.y} completed task${context.parsed.y === 1 ? "" : "s"}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: textColor,
            font: { size: 10 }
          }
        },
        y: {
          beginAtZero: true,
          suggestedMax: Math.max(3, ...values),
          ticks: {
            color: textColor,
            precision: 0,
            stepSize: 1,
            font: { size: 10 }
          },
          grid: { color: gridColor },
          border: { display: false }
        }
      }
    }
  };

  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;

    chart.options.scales.x.ticks.color = textColor;
    chart.options.scales.y.ticks.color = textColor;
    chart.options.scales.y.grid.color = gridColor;
    chart.options.plugins.tooltip.backgroundColor =
      styles.getPropertyValue("--surface-3").trim();
    chart.options.plugins.tooltip.titleColor =
      styles.getPropertyValue("--text").trim();
    chart.options.plugins.tooltip.bodyColor =
      styles.getPropertyValue("--text").trim();
    chart.options.plugins.tooltip.borderColor = gridColor;
    chart.data.datasets[0].backgroundColor = accentColor;
    chart.data.datasets[0].hoverBackgroundColor = accentColor;
    chart.options.scales.y.suggestedMax = Math.max(3, ...values);

    chart.update();
  } else {
    chart = new window.Chart($("#activityChart"), config);
  }
}

function renderAll() {
  renderHeader();
  renderTasks();
  renderStreaks();
  renderChart();
  refreshExportCodeField();
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
    elements.themeColorMeta.setAttribute("content", light ? "#f3f3f8" : "#101114");
  }

  try {
    localStorage.setItem(THEME_KEY, light ? "light" : "dark");
  } catch (error) {
    console.warn("Theme preference could not be saved.", error);
  }

  if (chart) renderChart();
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
  }, 2400);
}

/* ---------- Event listeners ---------- */

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
  const nextTheme = document.body.classList.contains("light-theme")
    ? "dark"
    : "light";

  applyTheme(nextTheme);
});

elements.editForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveEditedTask(elements.editTaskInput.value);
});

$("#cancelEdit").addEventListener("click", () => {
  editingTaskId = null;
  elements.editDialog.close();
});

elements.editDialog.addEventListener("close", () => {
  editingTaskId = null;
});

// Sync / Import & Export listeners
elements.generateCodeBtn.addEventListener("click", () => {
  refreshExportCodeField();
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

/* ---------- Initialize ---------- */

function initializeApp() {
  elements.selectedDate.value = localDateKey();
  loadTheme();
  renderAll();
}

initializeApp();

/* ---------- PWA Installation ---------- */
let deferredPrompt;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW failed', err));
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  elements.installBtn.style.display = 'inline-flex'; // Show the install button
});

elements.installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') {
    elements.installBtn.style.display = 'none';
  }
  deferredPrompt = null;
});

window.addEventListener('appinstalled', () => {
  elements.installBtn.style.display = 'none';
  deferredPrompt = null;
});