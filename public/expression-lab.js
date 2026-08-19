const portrait = document.querySelector("#portrait");
const context = portrait.getContext("2d");
const expressionGrid = document.querySelector("#expression-grid");
const template = document.querySelector("#expression-card-template");

const atlasCanvas = { width: 1024, bodyHeight: 768, defaultFaceSize: 256 };
const expressionNames = ["默认", ...Array.from({ length: 28 }, (_, index) => `表情 ${String(index + 1).padStart(2, "0")}`)];

let sheet;
let script;
let selectedFace = 0;

Promise.all([
  loadImage("/assets/mash-expression-sheet.png"),
  fetch("/assets/atlas/98001000.svtScript.json").then((response) => {
    if (!response.ok) throw new Error("无法读取玛修的定位数据");
    return response.json();
  }),
]).then(([image, metadata]) => {
  sheet = image;
  script = metadata;
  renderExpressionPicker();
  selectFace(0);
}).catch((error) => {
  document.querySelector("#expression-description").textContent = error.message;
});

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法读取玛修图集"));
    image.src = src;
  });
}

function faceSize() {
  const value = script.extendData?.faceSize;
  return Number.isFinite(value) ? value : atlasCanvas.defaultFaceSize;
}

function faceCount() {
  const size = faceSize();
  return Math.floor((sheet.height - atlasCanvas.bodyHeight) / size) * Math.floor(atlasCanvas.width / size);
}

function faceSource(index) {
  const size = faceSize();
  const columns = Math.floor(atlasCanvas.width / size);
  return {
    x: (index % columns) * size,
    y: atlasCanvas.bodyHeight + Math.floor(index / columns) * size,
    width: size,
    height: size,
  };
}

function targetFaceRect() {
  const size = faceSize();
  return {
    x: script.faceX - script.offsetX,
    y: script.faceY - script.offsetY,
    width: size,
    height: size,
  };
}

function renderPortrait(index) {
  context.clearRect(0, 0, portrait.width, portrait.height);
  context.drawImage(
    sheet,
    0, 0, atlasCanvas.width, atlasCanvas.bodyHeight,
    -script.offsetX, -script.offsetY, atlasCanvas.width, atlasCanvas.bodyHeight,
  );
  if (index === 0) return;

  const source = faceSource(index - 1);
  const target = targetFaceRect();
  // 保留边缘两像素，避免清除抗锯齿过渡层产生接缝。
  context.clearRect(target.x + 2, target.y + 2, target.width - 4, target.height - 4);
  context.drawImage(sheet, source.x, source.y, source.width, source.height, target.x, target.y, target.width, target.height);
}

function renderExpressionPicker() {
  const count = faceCount();
  document.querySelector("#expression-count").textContent = String(count + 1);
  for (let index = 0; index <= count; index += 1) {
    const fragment = template.content.cloneNode(true);
    const button = fragment.querySelector("button");
    const canvas = fragment.querySelector("canvas");
    const label = fragment.querySelector(".expression-label");
    label.textContent = expressionNames[index] ?? `表情 ${index}`;
    if (index === 0) {
      canvas.getContext("2d").drawImage(sheet, 0, 0, atlasCanvas.width, atlasCanvas.bodyHeight, 0, 0, canvas.width, canvas.height);
    } else {
      const source = faceSource(index - 1);
      canvas.getContext("2d").drawImage(sheet, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
    }
    button.addEventListener("click", () => selectFace(index));
    expressionGrid.append(fragment);
  }
}

function selectFace(index) {
  selectedFace = index;
  renderPortrait(index);
  document.querySelector("#expression-name").textContent = expressionNames[index] ?? `表情 ${index}`;
  document.querySelector("#expression-key").textContent = index === 0 ? "base portrait" : `face ${String(index).padStart(2, "0")}`;
  document.querySelector("#expression-description").textContent = index === 0
    ? "原始全身立绘，不叠加表情格。"
    : "使用 Atlas svtScript 的 faceX、faceY 与 offset 坐标贴合到原脸位置。";
  document.querySelectorAll(".expression-preview").forEach((button, buttonIndex) => {
    button.classList.toggle("is-selected", buttonIndex === selectedFace);
  });
}
