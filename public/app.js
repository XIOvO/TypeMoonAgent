const sessionId = "demo";
const playerId = "player";
const storageKey = `agent-game:playback:${sessionId}:${playerId}:v1`;
const sceneLabel = document.querySelector("#scene-label");
const presenceList = document.querySelector("#presence-list");
const connectionStatus = document.querySelector("#connection-status");
const advanceButton = document.querySelector("#advance-button");
const blockKind = document.querySelector("#block-kind");
const speakerName = document.querySelector("#speaker-name");
const narrativeText = document.querySelector("#narrative-text");
const advanceHint = document.querySelector("#advance-hint");
const actionForm = document.querySelector("#action-form");
const actionInput = document.querySelector("#action-input");
const sendAction = document.querySelector("#send-action");
const actionFeedback = document.querySelector("#action-feedback");
const historyDialog = document.querySelector("#history-dialog");
const historyList = document.querySelector("#history-list");
const historyButton = document.querySelector("#history-button");
const closeHistory = document.querySelector("#close-history");
const textSpeed = document.querySelector("#text-speed");
const autoPlay = document.querySelector("#auto-play");
const autoDelay = document.querySelector("#auto-delay");
const showSystem = document.querySelector("#show-system");

const queue = [];
const seenBeats = new Set();
const recordedBlocks = new Set();
let activeBeat = null;
let activeBlockIndex = 0;
let typedLength = 0;
let typingTimer = null;
let autoTimer = null;
let visibleCharacters = [];
let submitting = false;
let pendingDraft = "";
let history = [];
let settings = { speed: 24, auto: false, autoDelay: 1000, showSystem: true };

restorePlayback();

async function loadState() {
  const response = await fetch(`/sessions/${sessionId}/state?playerId=${playerId}`);
  if (!response.ok) throw new Error("无法读取当前世界状态。");
  renderState(await response.json());
}

function renderState(state) {
  sceneLabel.textContent = state.scene.locationId;
  visibleCharacters = state.characters.filter((character) => character.id !== playerId).map((character) => character.id);
  presenceList.textContent = visibleCharacters.length ? visibleCharacters.join(" · ") : "无人";
}

function enqueueBeat(beat) {
  if (seenBeats.has(beat.id)) return;
  seenBeats.add(beat.id);
  queue.push(beat);
  hideInput();
  persistPlayback();
  if (!activeBeat) beginNextBeat();
}

function beginNextBeat() {
  clearTimeout(autoTimer);
  activeBeat = queue.shift() ?? null;
  activeBlockIndex = 0;
  typedLength = 0;
  persistPlayback();
  if (!activeBeat) return openInput();
  renderActiveBlock();
}

function renderActiveBlock(resume = false) {
  const block = activeBeat?.blocks[activeBlockIndex];
  if (!block) return beginNextBeat();
  if (block.kind === "system" && !settings.showSystem) {
    activeBlockIndex += 1;
    typedLength = 0;
    persistPlayback();
    return renderActiveBlock();
  }
  clearTimeout(typingTimer);
  clearTimeout(autoTimer);
  typingTimer = null;
  const label = { dialogue: "对白", narration: "叙事", thought: "心声", system: "世界提示", scene_transition: "场景转换" }[block.kind] ?? "叙事";
  blockKind.textContent = label;
  speakerName.hidden = block.kind !== "dialogue";
  speakerName.textContent = block.kind === "dialogue" ? block.speakerName : "";
  const fullText = textFor(block);
  const startAt = resume ? Math.min(typedLength, fullText.length) : 0;
  typedLength = startAt;
  narrativeText.textContent = fullText.slice(0, startAt);
  advanceHint.textContent = "播放时点击可补全文字；完整显示后点击进入下一段。";
  advanceHint.classList.remove("error");
  if (startAt >= fullText.length) return completeBlock(block);
  typeText(fullText, startAt);
}

function typeText(text, index) {
  if (index >= text.length) return completeBlock(activeBeat?.blocks[activeBlockIndex]);
  narrativeText.textContent = text.slice(0, index + 1);
  typedLength = index + 1;
  persistPlayback();
  typingTimer = window.setTimeout(() => typeText(text, index + 1), settings.speed);
}

function completeBlock(block) {
  clearTimeout(typingTimer);
  typingTimer = null;
  if (!block) return;
  recordCompletedBlock(block);
  advanceHint.textContent = "点击进入下一段。";
  persistPlayback();
  if (settings.auto && block.kind !== "system" && hasNextBlock()) {
    autoTimer = window.setTimeout(advance, settings.autoDelay);
  }
}

function hasNextBlock() { return Boolean(activeBeat?.blocks[activeBlockIndex + 1] || queue.length); }
function isTyping() { return typingTimer !== null; }
function textFor(block) { return block.kind === "scene_transition" ? block.title : block.text; }

function advance() {
  const block = activeBeat?.blocks[activeBlockIndex];
  if (!block || historyDialog.open) return;
  const fullText = textFor(block);
  if (isTyping()) {
    clearTimeout(typingTimer);
    typingTimer = null;
    typedLength = fullText.length;
    narrativeText.textContent = fullText;
    completeBlock(block);
    return;
  }
  activeBlockIndex += 1;
  typedLength = 0;
  persistPlayback();
  renderActiveBlock();
}

function recordCompletedBlock(block) {
  if (!shouldBacklog(block) || recordedBlocks.has(block.id)) return;
  recordedBlocks.add(block.id);
  history.push({ id: block.id, kind: block.kind, speakerName: block.kind === "dialogue" ? block.speakerName : "", text: textFor(block) });
  renderHistory();
}

function shouldBacklog(block) { return block.record === "backlog" || block.kind === "scene_transition"; }

function openInput() {
  if (submitting || historyDialog.open) return;
  actionForm.hidden = false;
  actionInput.disabled = false;
  sendAction.disabled = false;
  persistPlayback();
}

function hideInput() {
  actionForm.hidden = true;
  actionInput.disabled = true;
  sendAction.disabled = true;
}

function showError(error) {
  actionFeedback.textContent = error.message;
  actionFeedback.classList.add("error");
}

function connectEvents() {
  const stream = new EventSource(`/sessions/${sessionId}/events?playerId=${playerId}`);
  stream.addEventListener("ready", () => { connectionStatus.textContent = "已连接"; });
  stream.addEventListener("game_event", () => { loadState().catch(showError); });
  stream.addEventListener("narrative_beat", (message) => enqueueBeat(JSON.parse(message.data)));
  stream.onerror = () => { connectionStatus.textContent = "正在重连"; };
}

function renderHistory() {
  historyList.replaceChildren();
  if (!history.length) return historyList.append(Object.assign(document.createElement("li"), { textContent: "尚未播放任何可回看的文本。" }));
  for (const entry of history) {
    const item = document.createElement("li");
    const meta = document.createElement("small");
    meta.textContent = entry.speakerName || ({ narration: "叙事", scene_transition: "场景转换" }[entry.kind] ?? entry.kind);
    item.append(meta, document.createTextNode(entry.text));
    historyList.append(item);
  }
  historyList.scrollTop = historyList.scrollHeight;
}

function pausePlayback() {
  clearTimeout(typingTimer);
  clearTimeout(autoTimer);
  typingTimer = null;
  autoTimer = null;
  persistPlayback();
}

function resumePlayback() {
  if (!activeBeat) return openInput();
  if (isTyping()) return;
  const block = activeBeat.blocks[activeBlockIndex];
  if (!block) return beginNextBeat();
  if (typedLength < textFor(block).length) return renderActiveBlock(true);
}

function persistPlayback() {
  const snapshot = { activeBeat, activeBlockIndex, typedLength, queue, seenBeatIds: [...seenBeats].slice(-500), history, draft: actionInput.value, settings };
  localStorage.setItem(storageKey, JSON.stringify(snapshot));
}

function restorePlayback() {
  try {
    const snapshot = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (!snapshot) return;
    activeBeat = snapshot.activeBeat ?? null;
    activeBlockIndex = Number.isInteger(snapshot.activeBlockIndex) ? snapshot.activeBlockIndex : 0;
    typedLength = Number.isInteger(snapshot.typedLength) ? snapshot.typedLength : 0;
    queue.push(...(Array.isArray(snapshot.queue) ? snapshot.queue : []));
    for (const id of Array.isArray(snapshot.seenBeatIds) ? snapshot.seenBeatIds : []) seenBeats.add(id);
    history = Array.isArray(snapshot.history) ? snapshot.history : [];
    for (const entry of history) recordedBlocks.add(entry.id);
    if (typeof snapshot.draft === "string") actionInput.value = snapshot.draft;
    settings = { ...settings, ...(snapshot.settings ?? {}) };
  } catch { localStorage.removeItem(storageKey); }
  applySettings();
  renderHistory();
}

function applySettings() {
  textSpeed.value = String(settings.speed);
  autoPlay.checked = settings.auto;
  autoDelay.value = String(settings.autoDelay);
  showSystem.checked = settings.showSystem;
}

advanceButton.addEventListener("click", advance);
historyButton.addEventListener("click", () => { pausePlayback(); renderHistory(); historyDialog.showModal(); });
closeHistory.addEventListener("click", () => historyDialog.close());
historyDialog.addEventListener("close", resumePlayback);
actionInput.addEventListener("input", persistPlayback);
textSpeed.addEventListener("change", () => { settings.speed = Number(textSpeed.value); persistPlayback(); });
autoPlay.addEventListener("change", () => { settings.auto = autoPlay.checked; persistPlayback(); });
autoDelay.addEventListener("change", () => { settings.autoDelay = Number(autoDelay.value); persistPlayback(); });
showSystem.addEventListener("change", () => { settings.showSystem = showSystem.checked; persistPlayback(); });

actionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = actionInput.value.trim();
  if (!content) return;
  const target = visibleCharacters[0];
  if (!target) return showError(new Error("当前场景没有可对话的角色。"));
  submitting = true;
  pendingDraft = actionInput.value;
  hideInput();
  actionFeedback.classList.remove("error");
  actionFeedback.textContent = "正在请求世界裁决……";
  try {
    const response = await fetch(`/sessions/${sessionId}/actions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: crypto.randomUUID(), sessionId, actorId: playerId, type: "dialogue", content, targetIds: [target] }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "行动提交失败。");
    if (result.events?.some((item) => item.type === "action_rejected")) {
      actionInput.value = pendingDraft;
      actionFeedback.textContent = "行动未被世界接受；草稿已保留。";
    } else {
      actionInput.value = "";
      pendingDraft = "";
      actionFeedback.textContent = "行动已确认，等待叙事播放。";
    }
  } catch (error) {
    actionInput.value = pendingDraft;
    showError(error instanceof Error ? error : new Error("行动提交失败。"));
  } finally {
    submitting = false;
    persistPlayback();
    if (!activeBeat && queue.length === 0) openInput();
  }
});

loadState().then(() => {
  if (activeBeat) renderActiveBlock(true);
  else if (queue.length) beginNextBeat();
  else openInput();
  connectEvents();
}).catch(showError);
