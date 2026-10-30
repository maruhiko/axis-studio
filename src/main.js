import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const $ = (selector) => document.querySelector(selector);
const host = $('#canvasHost');
const shell = $('#viewportShell');
const DEG = THREE.MathUtils.RAD2DEG;
const RAD = THREE.MathUtils.DEG2RAD;
const SUPPORTED = new Set(['glb', 'gltf', 'obj', 'stl']);
const SAFE_NAME = (name) => name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 80) || 'model';
const DEFAULT_VIEW = new THREE.Vector3(6, 4, 7).normalize();

const scene = new THREE.Scene();
const perspectiveCamera = new THREE.PerspectiveCamera(42, 1, 0.01, 100000);
const orthographicCamera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.01, 100000);
let camera = perspectiveCamera;
let projection = 'perspective';
let orthoHalfHeight = 5;
let lastModelName = 'Orbit Bot';
let modelFormat = 'PROCEDURAL SAMPLE';
let modelSizeBytes = null;
let currentModel = null;
let modelClips = [];
let animationMixer = null;
let animationAction = null;
let animationPlaying = false;
let activeObjectUrls = [];
let grid = null;
let axisLines = null;
let groundY = -1;
let modelExtent = 3;
let mode = 'translate';
let wireframe = false;
let gridVisible = true;
let axesVisible = true;
let cameraTween = null;
let history = [];
let historyCursor = -1;
let currentPointerSnapshot = null;
let loadSequence = 0;
let toastTimeout = null;
let sidebarOpen = false;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
} catch (error) {
  showFatal('WebGL を初期化できませんでした。WebGL に対応するブラウザで開いてください。');
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(1, 1);
renderer.setClearColor(0x1b2530);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.8;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('aria-label', '3D model canvas');
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
host.append(renderer.domElement);

const hemi = new THREE.HemisphereLight(0xe9f8ff, 0x536373, 2.7);
scene.add(hemi);
const keyLight = new THREE.DirectionalLight(0xffffff, 3.3);
keyLight.position.set(5, 11, 8);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x85bed7, 2.3);
rimLight.position.set(-6, 4, -7);
scene.add(rimLight);
const warmLight = new THREE.DirectionalLight(0xffcd93, 1.1);
warmLight.position.set(-4, 2, 7);
scene.add(warmLight);

const modelRoot = new THREE.Group();
modelRoot.name = 'Editable model';
scene.add(modelRoot);
let orbit = createOrbit(camera);
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setMode('translate');
gizmo.setSize(0.83);
gizmo.setColors('#f47f89', '#b4e776', '#83b6ff', '#fff3ad');
scene.add(gizmo.getHelper());
gizmo.attach(modelRoot);
gizmo.addEventListener('dragging-changed', (event) => { orbit.enabled = !event.value && !cameraTween; });
gizmo.addEventListener('mouseDown', () => { currentPointerSnapshot = getTransform(); });
gizmo.addEventListener('mouseUp', () => { pushHistory(); currentPointerSnapshot = null; updateStatistics(); });
gizmo.addEventListener('objectChange', () => { syncTransformInputs(); updateStatistics(); });

function createOrbit(cam) {
  const controls = new OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.rotateSpeed = 0.72;
  controls.zoomSpeed = 1.1;
  controls.panSpeed = 0.8;
  controls.minDistance = 0.01;
  controls.maxDistance = 100000;
  controls.screenSpacePanning = true;
  controls.autoRotateSpeed = 0.6;
  return controls;
}

function showFatal(text) {
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:25px;z-index:20;background:#19242d;color:#ffd4cb;font-size:14px';
  box.textContent = text;
  host.append(box);
}

function toast(message, isError = false) {
  const container = $('#toastContainer');
  container.replaceChildren();
  const el = document.createElement('div');
  el.className = `toast${isError ? ' error' : ''}`;
  el.textContent = message;
  container.append(el);
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.remove(), isError ? 5200 : 3000);
}

function setStatus(message) { $('#statusMessage').textContent = message; }
function setLoading(loading) { $('#loadingOverlay').hidden = !loading; }
function round(n, places = 2) { return Number(Number(n).toFixed(places)); }
function numberText(n) { return Number.isFinite(n) ? round(n, 3).toLocaleString('en-US') : '—'; }
function formatBytes(bytes) { return bytes === null ? 'DEMO' : bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${round(bytes / 1024, 1)} KB` : `${round(bytes / (1024 ** 2), 1)} MB`; }

function getTransform() {
  return {
    position: [modelRoot.position.x, modelRoot.position.y, modelRoot.position.z],
    rotation: [modelRoot.rotation.x * DEG, modelRoot.rotation.y * DEG, modelRoot.rotation.z * DEG],
    scale: [modelRoot.scale.x, modelRoot.scale.y, modelRoot.scale.z],
  };
}
function sameTransform(a, b) {
  if (!a || !b) return false;
  return ['position', 'rotation', 'scale'].every((key) => a[key].every((v, i) => Math.abs(v - b[key][i]) < 1e-6));
}
function applyTransform(value) {
  for (const key of ['position', 'rotation', 'scale']) {
    if (!Array.isArray(value[key]) || value[key].length !== 3 || !value[key].every((n) => typeof n === 'number' && Number.isFinite(n))) throw new Error(`無効な ${key} の値です。`);
  }
  modelRoot.position.fromArray(value.position);
  modelRoot.rotation.set(...value.rotation.map((v) => v * RAD), 'XYZ');
  modelRoot.scale.fromArray(value.scale);
  syncTransformInputs();
  updateStatistics();
}
function pushHistory(reset = false) {
  const snapshot = getTransform();
  if (reset) { history = [snapshot]; historyCursor = 0; }
  else if (!sameTransform(snapshot, history[historyCursor])) {
    history = history.slice(0, historyCursor + 1);
    history.push(snapshot);
    if (history.length > 70) history.shift();
    historyCursor = history.length - 1;
  }
  $('#undoButton').disabled = historyCursor < 1;
  $('#redoButton').disabled = historyCursor >= history.length - 1;
}
function travelHistory(step) {
  const next = historyCursor + step;
  if (next < 0 || next >= history.length) return;
  historyCursor = next;
  applyTransform(history[historyCursor]);
  $('#undoButton').disabled = historyCursor < 1;
  $('#redoButton').disabled = historyCursor >= history.length - 1;
  setStatus('TRANSFORM HISTORY');
}
function syncTransformInputs() {
  const t = getTransform();
  const axes = ['x', 'y', 'z'];
  for (const input of document.querySelectorAll('.vec3-field input')) {
    if (document.activeElement === input) continue;
    const i = axes.indexOf(input.dataset.axis);
    input.value = String(round(t[input.dataset.property][i], 3));
  }
}

function setMode(next) {
  if (next !== 'orbit' && !['translate', 'rotate', 'scale'].includes(next)) return;
  mode = next;
  gizmo.getHelper().visible = mode !== 'orbit';
  gizmo.enabled = mode !== 'orbit';
  if (mode !== 'orbit') gizmo.setMode(mode);
  document.querySelectorAll('.rail-tool[data-mode]').forEach((el) => {
    el.classList.toggle('active', el.dataset.mode === mode);
    el.setAttribute('aria-pressed', String(el.dataset.mode === mode));
  });
  setStatus(({ translate: 'MOVE', rotate: 'ROTATE', scale: 'SCALE', orbit: 'ORBIT' })[mode]);
}

function updateStatistics() {
  if (!currentModel) return;
  let meshes = 0, vertices = 0, triangles = 0;
  currentModel.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    meshes++;
    const pos = obj.geometry.getAttribute('position');
    vertices += pos?.count || 0;
    triangles += Math.floor((obj.geometry.index?.count || pos?.count || 0) / 3);
  });
  $('#meshStat').textContent = numberText(meshes);
  $('#vertexStat').textContent = numberText(vertices);
  $('#triangleStat').textContent = numberText(triangles);
  $('#filesizeStat').textContent = formatBytes(modelSizeBytes);
  const box = new THREE.Box3().setFromObject(modelRoot, true);
  const d = box.getSize(new THREE.Vector3());
  $('#dimensionsStat').textContent = `${round(d.x)} × ${round(d.y)} × ${round(d.z)}`;
}

function updateGrid() {
  if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
  const size = Math.max(12, Math.pow(10, Math.ceil(Math.log10(Math.max(1, modelExtent * 3)))));
  grid = new THREE.GridHelper(size, 40, 0x647986, 0x3c5260);
  grid.position.y = groundY - Math.max(modelExtent * .002, .005);
  grid.material.transparent = true;
  grid.material.opacity = .37;
  grid.visible = gridVisible;
  scene.add(grid);
  if (axisLines) { scene.remove(axisLines); axisLines.geometry.dispose(); axisLines.material.dispose(); }
  axisLines = new THREE.AxesHelper(Math.max(.9, modelExtent * .9));
  axisLines.visible = axesVisible;
  scene.add(axisLines);
}

function fitCamera(direction = null, instant = true) {
  if (!currentModel) return;
  modelRoot.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(modelRoot, true);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, .4);
  const aspect = Math.max(0.25, host.clientWidth / Math.max(1, host.clientHeight));
  const halfVertical = Math.atan(Math.tan((perspectiveCamera.fov * RAD) / 2) * Math.min(aspect, 1));
  const distance = Math.max(radius * 1.28 / Math.sin(halfVertical), radius * 2.2, .4);
  const eye = direction ? direction.clone().normalize() : camera.position.clone().sub(orbit.target).normalize();
  if (eye.lengthSq() < 1e-5) eye.copy(DEFAULT_VIEW);
  orbit.target.copy(center);
  if (projection === 'orthographic') {
    orthoHalfHeight = Math.max(size.y / 1.55, size.x / (1.55 * aspect), size.z / 1.55, radius * 1.2, .4);
    orthographicCamera.zoom = 1;
    updateOrthoFrustum(aspect);
  }
  if (instant) {
    camera.position.copy(center).addScaledVector(eye, distance);
    camera.lookAt(center);
    orbit.update();
  } else {
    tweenCamera(eye, distance, center);
  }
  perspectiveCamera.near = Math.max(.001, distance / 10000);
  perspectiveCamera.far = Math.max(1000, distance * 100);
  perspectiveCamera.updateProjectionMatrix();
  orthographicCamera.near = .001;
  orthographicCamera.far = Math.max(1000, distance * 100);
  orthographicCamera.updateProjectionMatrix();
}
function updateOrthoFrustum(aspect) {
  orthographicCamera.left = -orthoHalfHeight * aspect;
  orthographicCamera.right = orthoHalfHeight * aspect;
  orthographicCamera.top = orthoHalfHeight;
  orthographicCamera.bottom = -orthoHalfHeight;
  orthographicCamera.updateProjectionMatrix();
}
function tweenCamera(direction, distance = null, target = null) {
  const center = target ? target.clone() : orbit.target.clone();
  const d = distance ?? Math.max(camera.position.distanceTo(orbit.target), .01);
  const desired = center.clone().addScaledVector(direction.clone().normalize(), d);
  cameraTween = { start: camera.position.clone(), end: desired, targetStart: orbit.target.clone(), targetEnd: center, elapsed: 0, duration: .48 };
  orbit.enabled = false;
  setStatus('VIEW CHANGED');
}
function viewAxis(axisName) {
  const map = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, .0001], '-y': [0, -1, .0001], '+z': [0, 0, 1], '-z': [0, 0, -1] };
  const direction = new THREE.Vector3(...map[axisName]);
  tweenCamera(direction);
}
function changeProjection() {
  const old = camera;
  const distance = old.position.distanceTo(orbit.target);
  if (projection === 'perspective') {
    projection = 'orthographic';
    const halfHeight = Math.max(.01, distance * Math.tan((perspectiveCamera.fov * RAD) / 2));
    orthoHalfHeight = halfHeight;
    camera = orthographicCamera;
    orthographicCamera.position.copy(old.position);
    orthographicCamera.quaternion.copy(old.quaternion);
    orthographicCamera.zoom = 1;
    updateOrthoFrustum(Math.max(.25, host.clientWidth / Math.max(1, host.clientHeight)));
  } else {
    projection = 'perspective';
    camera = perspectiveCamera;
    const halfHeight = orthoHalfHeight / orthographicCamera.zoom;
    const nextDistance = halfHeight / Math.tan((perspectiveCamera.fov * RAD) / 2);
    perspectiveCamera.position.copy(orbit.target).add(old.position.clone().sub(orbit.target).normalize().multiplyScalar(nextDistance));
    perspectiveCamera.lookAt(orbit.target);
  }
  cameraTween = null;
  const target = orbit.target.clone();
  const rotating = orbit.autoRotate;
  orbit.dispose();
  orbit = createOrbit(camera);
  orbit.target.copy(target);
  orbit.autoRotate = rotating;
  orbit.update();
  gizmo.camera = camera;
  $('#projectionLabel').textContent = projection.toUpperCase();
  $('#projectionToggleText').textContent = projection === 'perspective' ? '透視' : '平行';
  setStatus(projection.toUpperCase());
}

function disposeObject(root) {
  if (!root) return;
  const textures = new Set(), materials = new Set(), geometries = new Set();
  root.traverse((obj) => {
    if (obj.geometry) geometries.add(obj.geometry);
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const mat of mats) {
      materials.add(mat);
      for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value);
    }
  });
  textures.forEach((t) => t.dispose());
  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());
}
function setModel(object, { name, format, bytes = null, animations = [], urls = [] }) {
  // Validate the replacement before removing the currently displayed model.
  const pivot = new THREE.Group();
  pivot.name = 'Centered pivot';
  pivot.add(object);
  const originalBounds = new THREE.Box3().setFromObject(pivot);
  if (originalBounds.isEmpty()) {
    disposeObject(pivot);
    throw new Error('表示できるメッシュが見つかりませんでした。');
  }
  const center = originalBounds.getCenter(new THREE.Vector3());
  // Offset the wrapper, not animated import nodes, to preserve animation tracks.
  pivot.position.sub(center);
  if (animationMixer) { animationMixer.stopAllAction(); animationMixer.uncacheRoot(currentModel); animationMixer = null; }
  if (currentModel) { modelRoot.remove(currentModel); disposeObject(currentModel); }
  activeObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  activeObjectUrls = urls;
  modelRoot.position.set(0, 0, 0);
  modelRoot.rotation.set(0, 0, 0, 'XYZ');
  modelRoot.scale.set(1, 1, 1);
  currentModel = pivot;
  modelRoot.add(currentModel);
  const centeredBounds = new THREE.Box3().setFromObject(modelRoot);
  const size = centeredBounds.getSize(new THREE.Vector3());
  modelExtent = Math.max(size.x, size.y, size.z, .1);
  groundY = centeredBounds.min.y;
  lastModelName = name;
  modelFormat = format;
  modelSizeBytes = bytes;
  modelClips = animations;
  setWireframe(wireframe);
  updateGrid();
  if (mode !== 'orbit') gizmo.attach(modelRoot);
  fitCamera(DEFAULT_VIEW);
  pushHistory(true);
  syncTransformInputs();
  updateStatistics();
  $('#projectName').textContent = name;
  $('#objectName').textContent = name;
  $('#objectFormat').textContent = format;
  $('#statusModel').textContent = name;
  setStatus('READY');
  setupAnimations(object, animations);
}
function setupAnimations(root, animations) {
  const section = $('#animationSection');
  const select = $('#animationSelect');
  select.replaceChildren();
  animationAction = null;
  animationPlaying = false;
  section.hidden = !animations.length;
  if (!animations.length) return;
  animationMixer = new THREE.AnimationMixer(root);
  animations.forEach((clip, i) => {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = clip.name || `Animation ${i + 1}`;
    select.append(option);
  });
  playClip(0);
}
function playClip(index) {
  if (!animationMixer || !modelClips[index]) return;
  animationMixer.stopAllAction();
  animationAction = animationMixer.clipAction(modelClips[index]);
  animationAction.reset().play();
  animationPlaying = true;
  $('#playAnimationButton').innerHTML = '<svg class="icon"><use href="#i-pause"/></svg>';
}
function setWireframe(on) {
  wireframe = on;
  currentModel?.traverse((obj) => {
    if (!obj.isMesh) return;
    for (const mat of (Array.isArray(obj.material) ? obj.material : [obj.material])) {
      if (mat && 'wireframe' in mat) mat.wireframe = on;
    }
  });
  $('#wireframeButton').classList.toggle('active', on);
  $('#wireframeButton').setAttribute('aria-pressed', String(on));
}

function makeDemo() {
  const root = new THREE.Group();
  root.name = 'Orbit Bot';
  const cream = new THREE.MeshStandardMaterial({ color: 0xd6e3dc, metalness: .25, roughness: .38 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x91d2bc, metalness: .35, roughness: .3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x21313b, metalness: .45, roughness: .27 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xf8a878, metalness: .2, roughness: .42 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xa4f6e8, emissive: 0x5be4cc, emissiveIntensity: .95, roughness: .2 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x344149, metalness: .15, roughness: .7 });
  const add = (geom, mat, pos, parent = root) => {
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(...pos);
    parent.add(mesh);
    return mesh;
  };
  const box = (x, y, z, r = .1) => new RoundedBoxGeometry(x, y, z, 4, Math.min(r, x / 3, y / 3, z / 3));
  // Friendly hard-surface robot gives an immediate reference for X/Y/Z rotation.
  add(box(1.68, 1.23, .9, .19), teal, [0, .17, 0]);
  add(box(1.52, .23, .95, .08), dark, [0, -.39, 0]);
  add(box(1.34, 1.03, .16, .11), cream, [0, .19, .49]);
  add(box(1.32, .88, .12, .18), dark, [0, 1.23, .19]);
  add(box(1.47, 1.01, .77, .26), cream, [0, 1.2, 0]);
  add(box(1.26, .72, .18, .19), dark, [0, 1.28, .41]);
  add(box(.39, .14, .13, .06), glow, [-.34, 1.33, .52]);
  add(box(.39, .14, .13, .06), glow, [.34, 1.33, .52]);
  add(new THREE.SphereGeometry(.07, 16, 12), trim, [0, 1.04, .53]);
  add(box(.6, .12, .17, .045), dark, [0, .41, .59]);
  add(box(.58, .29, .09, .045), dark, [0, -.07, .59]);
  add(box(.31, .13, .11, .02), glow, [0, -.07, .65]);
  for (const side of [-1, 1]) {
    add(new THREE.SphereGeometry(.22, 24, 16), trim, [side * .81, 1.23, .03]);
    add(new THREE.CylinderGeometry(.19, .19, .22, 24), dark, [side * .84, 1.23, .03]).rotation.z = Math.PI / 2;
    add(box(.38, .57, .56, .14), cream, [side * 1.08, .15, .03]);
    add(box(.43, .18, .6, .07), dark, [side * 1.1, -.13, .04]);
    add(box(.48, .55, .58, .12), rubber, [side * .46, -.81, .03]);
    add(box(.65, .18, .94, .08), cream, [side * .46, -1.15, .2]);
    add(box(.19, .18, .17, .04), trim, [side * .55, -.63, .36]);
    add(new THREE.SphereGeometry(.085, 12, 8), glow, [side * .53, -.65, .47]);
  }
  add(new THREE.CylinderGeometry(.045, .045, .37, 16), dark, [0, 1.91, 0]);
  add(new THREE.SphereGeometry(.115, 16, 12), trim, [0, 2.14, 0]);
  const panel = add(box(.48, .17, .06, .045), trim, [0, .34, .613]);
  panel.rotation.z = -.06;
  root.rotation.y = -.12;
  return root;
}

function startDemo() {
  try {
    setModel(makeDemo(), { name: 'Orbit Bot', format: 'PROCEDURAL SAMPLE' });
    toast('デモモデルを表示しました');
  } catch (error) { toast(error.message, true); }
}

function extension(name) { return (name.split('.').pop() || '').toLowerCase(); }
function revokeUrls(urls) { urls.forEach((url) => URL.revokeObjectURL(url)); }
async function loadFiles(files) {
  const list = [...files].filter((file) => file && !file.name.startsWith('.'));
  const primaries = list.filter((file) => SUPPORTED.has(extension(file.name)));
  if (!primaries.length) { toast('GLB / GLTF / OBJ / STL ファイルを選択してください。', true); return; }
  // Prefer .gltf when combined with companion resources; otherwise first supported file.
  const primary = primaries.find((file) => extension(file.name) === 'gltf') || primaries[0];
  const type = extension(primary.name);
  const sequence = ++loadSequence;
  setLoading(true);
  setStatus('LOADING');
  const urls = [];
  try {
    let object, animations = [];
    if (type === 'glb' || type === 'gltf') {
      const mappings = new Map();
      for (const file of list) {
        const url = URL.createObjectURL(file);
        urls.push(url);
        const fullName = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
        mappings.set(fullName.toLowerCase(), url);
        mappings.set(file.name.toLowerCase(), url);
      }
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((uri) => {
        const clean = decodeURIComponent(uri.split('?')[0].split('#')[0]).replace(/^\.\//, '').replace(/\\/g, '/');
        const direct = mappings.get(clean.toLowerCase());
        if (direct) return direct;
        const basename = clean.substring(clean.lastIndexOf('/') + 1).toLowerCase();
        if (mappings.has(basename)) return mappings.get(basename);
        return uri;
      });
      const loader = new GLTFLoader(manager);
      const data = type === 'glb' ? await primary.arrayBuffer() : await primary.text();
      const gltf = await new Promise((resolve, reject) => loader.parse(data, '', resolve, reject));
      object = gltf.scene;
      animations = gltf.animations || [];
    } else if (type === 'obj') {
      object = new OBJLoader().parse(await primary.text());
      object.traverse((mesh) => {
        if (mesh.isMesh && !mesh.material) mesh.material = new THREE.MeshStandardMaterial({ color: 0xbccbd0, metalness: .13, roughness: .63 });
      });
    } else {
      const geometry = new STLLoader().parse(await primary.arrayBuffer());
      if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
      object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb9d9c9, metalness: .3, roughness: .5, side: THREE.DoubleSide }));
      object.name = primary.name;
    }
    if (sequence !== loadSequence) { disposeObject(object); revokeUrls(urls); return; }
    setModel(object, { name: primary.name, format: type.toUpperCase(), bytes: list.reduce((s, f) => s + f.size, 0), animations, urls });
    toast(`${primary.name} を読み込みました`);
  } catch (error) {
    revokeUrls(urls);
    console.error(error);
    toast(`読み込み失敗: ${error.message || 'ファイル形式を確認してください。'}`, true);
    setStatus('LOAD FAILED');
  } finally { if (sequence === loadSequence) setLoading(false); }
}

// The view-axis control is drawn separately at device resolution; its hit areas
// stay the same size even as the model's size or viewport aspect ratio changes.
const widget = $('#axisWidget');
const widgetCanvas = document.createElement('canvas');
widget.append(widgetCanvas);
const widgetCtx = widgetCanvas.getContext('2d');
const axisDirections = [
  { id: '+x', v: new THREE.Vector3(1, 0, 0), color: '#f48391', text: 'X' },
  { id: '-x', v: new THREE.Vector3(-1, 0, 0), color: '#95535f', text: '−X' },
  { id: '+y', v: new THREE.Vector3(0, 1, 0), color: '#b7e97b', text: 'Y' },
  { id: '-y', v: new THREE.Vector3(0, -1, 0), color: '#66834e', text: '−Y' },
  { id: '+z', v: new THREE.Vector3(0, 0, 1), color: '#86bbff', text: 'Z' },
  { id: '-z', v: new THREE.Vector3(0, 0, -1), color: '#4d7198', text: '−Z' },
];
let gizmoPoints = [];
function renderAxisWidget() {
  const width = widget.clientWidth || 110;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixels = Math.round(width * dpr);
  if (widgetCanvas.width !== pixels) { widgetCanvas.width = pixels; widgetCanvas.height = pixels; widgetCanvas.style.width = `${width}px`; widgetCanvas.style.height = `${width}px`; }
  const ctx = widgetCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, width);
  const half = width / 2;
  const length = width * .32;
  const inverse = camera.quaternion.clone().invert();
  const axes = axisDirections.map((axis) => {
    const v = axis.v.clone().applyQuaternion(inverse);
    return { ...axis, x: half + v.x * length, y: half - v.y * length, depth: v.z };
  }).sort((a, b) => a.depth - b.depth);
  const lineOrigin = half;
  for (const axis of axes) {
    ctx.beginPath();ctx.moveTo(lineOrigin,lineOrigin);ctx.lineTo(axis.x,axis.y);
    ctx.lineWidth = axis.id[0] === '+' ? 2.6 : 1.2;
    ctx.strokeStyle = axis.color;
    ctx.globalAlpha = axis.id[0] === '+' ? .92 : .52;
    ctx.stroke();ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#d5e0e8';ctx.beginPath();ctx.arc(half,half,3,0,2*Math.PI);ctx.fill();
  for (const axis of axes) {
    const r = axis.id[0] === '+' ? 13 : 9;
    ctx.fillStyle = '#19232b';ctx.beginPath();ctx.arc(axis.x,axis.y,r+2,0,2*Math.PI);ctx.fill();
    ctx.fillStyle = axis.color;ctx.beginPath();ctx.arc(axis.x,axis.y,r,0,2*Math.PI);ctx.fill();
    ctx.fillStyle = axis.id[0] === '+' ? '#132028' : '#f0f6f8';
    ctx.textAlign = 'center';ctx.textBaseline = 'middle';ctx.font = `800 ${axis.id[0] === '+' ? 11 : 8}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.fillText(axis.text,axis.x,axis.y+.5);
  }
  gizmoPoints = axes;
}
widget.addEventListener('click', (event) => {
  const bounds = widgetCanvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * (widgetCanvas.width / bounds.width) / Math.min(window.devicePixelRatio || 1, 2);
  const y = (event.clientY - bounds.top) * (widgetCanvas.height / bounds.height) / Math.min(window.devicePixelRatio || 1, 2);
  const target = gizmoPoints.slice().reverse().find((a) => Math.hypot(x - a.x, y - a.y) < (a.id[0] === '+' ? 16 : 12));
  if (target) viewAxis(target.id);
});

async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;a.download = filename;document.body.append(a);a.click();a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function screenshot() {
  // Take the capture without the editing gizmo, leaving grid and model visible.
  const helper = gizmo.getHelper();
  const wasVisible = helper.visible;
  helper.visible = false;
  renderer.render(scene, camera);
  try {
    const blob = await new Promise((resolve) => renderer.domElement.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('画像を生成できませんでした。');
    downloadBlob(blob, `${SAFE_NAME(lastModelName)}_view.png`);
    toast('PNG画像を書き出しました');
  } catch (err) { toast(err.message, true); }
  finally { helper.visible = wasVisible; }
}
async function exportGlb() {
  if (!currentModel) return;
  $('#exportGlbButton').disabled = true;
  setStatus('EXPORTING');
  try {
    // Export only the model hierarchy — exclude lights, grids and gizmos.
    const bytes = await new GLTFExporter().parseAsync(modelRoot, { binary: true, onlyVisible: true, maxTextureSize: 4096 });
    downloadBlob(new Blob([bytes], { type: 'model/gltf-binary' }), `${SAFE_NAME(lastModelName)}_edited.glb`);
    toast('GLBを書き出しました');
    setStatus('READY');
  } catch (error) { console.error(error); toast(`GLB書き出し失敗: ${error.message}`, true); setStatus('EXPORT FAILED'); }
  finally { $('#exportGlbButton').disabled = false; }
}

function attachUI() {
  $('#openButton').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => { if (e.target.files.length) loadFiles(e.target.files); e.target.value = ''; });
  $('#demoButton').addEventListener('click', () => { ++loadSequence; setLoading(false); startDemo(); closeSidebar(); });
  $('#screenshotButton').addEventListener('click', screenshot);
  $('#exportGlbButton').addEventListener('click', exportGlb);
  document.querySelectorAll('.rail-tool[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $('#frameButton').addEventListener('click', () => fitCamera(null, false));
  $('#bottomFrameButton').addEventListener('click', () => fitCamera(null, false));
  $('#viewResetButton').addEventListener('click', () => tweenCamera(DEFAULT_VIEW));
  $('#projectionButton').addEventListener('click', changeProjection);
  $('#undoButton').addEventListener('click', () => travelHistory(-1));
  $('#redoButton').addEventListener('click', () => travelHistory(1));
  $('#resetTransformButton').addEventListener('click', () => {
    applyTransform({ position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] });
    pushHistory();
    toast('Transform を初期化しました');
  });
  for (const input of document.querySelectorAll('.vec3-field input')) {
    // Change is committed once when the field loses focus; input gives live preview.
    input.addEventListener('input', () => {
      const value = Number(input.value);
      if (!Number.isFinite(value) || input.value.trim() === '') return;
      modelRoot[input.dataset.property][input.dataset.axis] = input.dataset.property === 'rotation' ? value * RAD : value;
      if (input.dataset.property === 'rotation') modelRoot.rotation.order = 'XYZ';
      updateStatistics();
    });
    input.addEventListener('change', () => { if (input.value.trim() !== '' && Number.isFinite(Number(input.value))) pushHistory(); syncTransformInputs(); });
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') input.blur(); });
  }
  $('#copyTransformButton').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(getTransform(), null, 2)); toast('Transform JSON をコピーしました'); }
    catch { toast('クリップボードにアクセスできませんでした。', true); }
  });
  $('#pasteTransformButton').addEventListener('click', async () => {
    try { applyTransform(JSON.parse(await navigator.clipboard.readText())); pushHistory(); toast('Transform を適用しました'); }
    catch (error) { toast(`貼り付けできません: ${error.message}`, true); }
  });
  document.querySelectorAll('[data-space]').forEach((button) => button.addEventListener('click', () => {
    gizmo.setSpace(button.dataset.space);
    document.querySelectorAll('[data-space]').forEach((el) => el.classList.toggle('active', el === button));
  }));
  $('#snapCheck').addEventListener('change', (event) => {
    const on = event.target.checked;
    gizmo.setTranslationSnap(on ? .25 : null);
    gizmo.setRotationSnap(on ? Math.PI / 12 : null);
    gizmo.setScaleSnap(on ? .1 : null);
  });
  $('#gridButton').addEventListener('click', () => { gridVisible = !gridVisible; grid.visible = gridVisible; toggleButton('gridButton', gridVisible); });
  $('#axesButton').addEventListener('click', () => { axesVisible = !axesVisible; axisLines.visible = axesVisible; toggleButton('axesButton', axesVisible); });
  $('#wireframeButton').addEventListener('click', () => setWireframe(!wireframe));
  $('#autoRotateCheck').addEventListener('change', (event) => { orbit.autoRotate = event.target.checked; });
  $('#backgroundSelect').addEventListener('change', (event) => {
    const colors = { dark: 0x1b2530, slate: 0x35434b, light: 0x9caeb7 };
    scene.background = new THREE.Color(colors[event.target.value]);
    renderer.setClearColor(colors[event.target.value]);
  });
  $('#animationSelect').addEventListener('change', (event) => playClip(Number(event.target.value)));
  $('#playAnimationButton').addEventListener('click', () => {
    if (!animationAction) return;
    animationPlaying = !animationPlaying;
    animationAction.paused = !animationPlaying;
    $('#playAnimationButton').innerHTML = `<svg class="icon"><use href="#i-${animationPlaying ? 'pause' : 'play'}"/></svg>`;
  });
  const help = $('#helpDialog');
  const openHelp = () => { if (!help.open) help.showModal(); };
  $('#helpButton').addEventListener('click', openHelp);
  $('#railHelpButton').addEventListener('click', openHelp);
  $('#helpCloseButton').addEventListener('click', () => help.close());
  help.addEventListener('click', (event) => { if (event.target === help) help.close(); });
  $('#mobileInspectorButton').addEventListener('click', openSidebar);
  $('#mobileInspectorClose').addEventListener('click', closeSidebar);
  $('#mobileShade').addEventListener('click', closeSidebar);
  window.addEventListener('keydown', (event) => {
    const tag = document.activeElement?.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || help.open || event.altKey) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();travelHistory(event.shiftKey ? 1 : -1);return;
    }
    if (event.ctrlKey || event.metaKey) return;
    switch (event.key.toLowerCase()) {
      case 'q': setMode('orbit'); break;
      case 'w': setMode('translate'); break;
      case 'e': setMode('rotate'); break;
      case 'r': setMode('scale'); break;
      case 'f': fitCamera(null, false); break;
      case 'g': $('#gridButton').click(); break;
      case '?': openHelp(); break;
      case 'escape': closeSidebar(); break;
    }
  });
  setupDropZone();
}
function toggleButton(id, on) {
  const element = $(`#${id}`);
  element.classList.toggle('active', on);
  element.setAttribute('aria-pressed', String(on));
}
function openSidebar() { sidebarOpen = true; $('#inspector').classList.add('open'); $('#mobileShade').classList.add('open'); }
function closeSidebar() { sidebarOpen = false; $('#inspector').classList.remove('open'); $('#mobileShade').classList.remove('open'); }
function setupDropZone() {
  let dragDepth = 0;
  function supportsFiles(event) { return Array.from(event.dataTransfer?.types || []).includes('Files'); }
  document.addEventListener('dragenter', (event) => {
    if (!supportsFiles(event)) return;
    event.preventDefault();dragDepth++;$('#dropOverlay').classList.add('visible');
  });
  document.addEventListener('dragover', (event) => { if (!supportsFiles(event)) return; event.preventDefault();event.dataTransfer.dropEffect = 'copy'; });
  document.addEventListener('dragleave', (event) => { if (!supportsFiles(event)) return; event.preventDefault();if (--dragDepth <= 0) { dragDepth = 0;$('#dropOverlay').classList.remove('visible'); } });
  document.addEventListener('drop', (event) => {
    event.preventDefault();dragDepth = 0;$('#dropOverlay').classList.remove('visible');
    if (event.dataTransfer?.files.length) loadFiles(event.dataTransfer.files);
  });
}

let prevTime = performance.now();
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min((now - prevTime) / 1000, .07);
  prevTime = now;
  if (cameraTween) {
    cameraTween.elapsed += dt;
    const t = Math.min(1, cameraTween.elapsed / cameraTween.duration);
    const ease = 1 - (1 - t) ** 3;
    camera.position.copy(cameraTween.start).lerp(cameraTween.end, ease);
    orbit.target.copy(cameraTween.targetStart).lerp(cameraTween.targetEnd, ease);
    camera.lookAt(orbit.target);
    if (t >= 1) { cameraTween = null; orbit.enabled = !gizmo.dragging; orbit.update(); }
  } else orbit.update(dt);
  if (animationPlaying && animationMixer) animationMixer.update(dt);
  renderer.render(scene, camera);
  renderAxisWidget();
}
function resize() {
  const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
  renderer.setSize(width, height, false);
  perspectiveCamera.aspect = width / height;
  perspectiveCamera.updateProjectionMatrix();
  updateOrthoFrustum(width / height);
}

// Initialize after DOM is ready (the module script is at the end of body).
attachUI();
resize();
new ResizeObserver(resize).observe(host);
const gl = renderer.getContext();
$('#rendererInfo').textContent = gl.getParameter(gl.VERSION)?.includes('WebGL 2') ? '2.0' : '1.0';
startDemo();
setMode('translate');
requestAnimationFrame(tick);
