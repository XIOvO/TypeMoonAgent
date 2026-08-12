const sheet = new Image();
sheet.src = "/assets/mash-expression-sheet.png";

const sheetLayout = { columns: 4, rows: 7, startY: 784, cellWidth: 256, cellHeight: 240, rowGap: 12 };
const labels = [
  ["未标注", ""], ["默认", "neutral"], ["说话", "speak"], ["强调说话", "emphasized_speak"],
  ["惊讶", "surprised"], ["担忧", "concerned"], ["难过", "sad"], ["含泪", "tearful"],
  ["严肃", "stern"], ["生气", "angry"], ["受伤", "hurt"], ["不安", "uneasy"],
  ["微笑", "smile"], ["闭眼微笑", "eyes_closed_smile"], ["害羞", "blush"], ["沉思", "thinking"],
];
const descriptions = {
  neutral: "沉静、正常的待机表情。", speak: "自然开口，适合一般对白。", emphasized_speak: "语气更强的发言或呼唤。", surprised: "短促的惊讶与错愕。", concerned: "克制的担忧，适合提醒与确认。", sad: "低落、难以言明的失落。", tearful: "情绪外显；只用于确有触发的时刻。", stern: "警戒、决断或认真说明。", angry: "明确的愤怒与反驳。", hurt: "受伤、疲惫或压抑痛感。", uneasy: "不安、犹疑或难以判断。", smile: "放松的轻笑。", eyes_closed_smile: "更完整的安心与喜悦。", blush: "害羞或被戳破心思。", thinking: "沉默思考、暂未作答。"
};
const seedLabels = ["speak", "emphasized_speak", "neutral", "stern", "surprised", "concerned", "thinking", "eyes_closed_smile", "tearful", "hurt", "sad", "uneasy", "neutral", "speak", "concerned", "smile", "neutral", "sad", "smile", "stern", "surprised", "eyes_closed_smile", "eyes_closed_smile", "angry", "concerned", "smile", "eyes_closed_smile", "uneasy"];
const selections = [...seedLabels];
const grid = document.querySelector("#expression-grid");
const template = document.querySelector("#expression-card-template");
const mainCanvas = document.querySelector("#portrait");
const mainContext = mainCanvas.getContext("2d");
let selectedIndex = 0;

sheet.addEventListener("load", () => {
  Array.from({ length: 28 }, (_, index) => createCard(index));
  selectExpression(0);
  updateCount();
});

function cropFor(index) {
  const column = index % sheetLayout.columns;
  const row = Math.floor(index / sheetLayout.columns);
  return { x: column * sheetLayout.cellWidth, y: sheetLayout.startY + row * (sheetLayout.cellHeight + sheetLayout.rowGap), width: sheetLayout.cellWidth, height: sheetLayout.cellHeight };
}

function drawExpression(context, index, width, height) {
  const crop = cropFor(index);
  context.clearRect(0, 0, width, height);
  context.drawImage(sheet, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
}

function createCard(index) {
  const fragment = template.content.cloneNode(true);
  const preview = fragment.querySelector(".expression-preview");
  const canvas = fragment.querySelector("canvas");
  const select = fragment.querySelector("select");
  fragment.querySelector(".cell-index").textContent = `#${String(index + 1).padStart(2, "0")}`;
  labels.forEach(([name, value]) => select.add(new Option(name, value, false, selections[index] === value)));
  drawExpression(canvas.getContext("2d"), index, canvas.width, canvas.height);
  preview.addEventListener("click", () => selectExpression(index));
  select.addEventListener("change", () => { selections[index] = select.value; updateCount(); if (selectedIndex === index) updateStage(index); });
  grid.append(fragment);
}

function selectExpression(index) {
  selectedIndex = index;
  document.querySelectorAll(".expression-preview").forEach((node, current) => node.classList.toggle("is-selected", current === index));
  updateStage(index);
}

function updateStage(index) {
  drawExpression(mainContext, index, mainCanvas.width, mainCanvas.height);
  const key = selections[index] || "unlabeled";
  const name = labels.find(([, value]) => value === key)?.[0] ?? "未标注";
  document.querySelector("#expression-name").textContent = name;
  document.querySelector("#expression-key").textContent = key || "unlabeled";
  document.querySelector("#expression-description").textContent = descriptions[key] ?? "尚未决定这一格的用途；选择标签后即可纳入角色图谱。";
}

function updateCount() { document.querySelector("#tagged-count").textContent = String(selections.filter(Boolean).length); }
