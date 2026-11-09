// Brands page: list, create, duplicate, delete, and a full editor with live checks and previews.
import { api, el, debounce, formatBytes, showErrors, announce } from "/static/common.js";

const $ = (id) => document.getElementById(id);
const S = { brands: [], meta: null, id: null, detail: null, draft: null, saved: "", check: null, files: null, icons: { client: [], library: 0 }, previewSeq: 0, suggestions: null };

const ROLES = [
  { key: "primary", label: "Primary", hint: "The main brand colour. Usually the background for openings and endings.", required: true },
  { key: "text", label: "Text", hint: "The main text colour, near black.", required: true },
  { key: "background", label: "Background", hint: "Usually white.", required: true },
  { key: "accent", label: "Accent", hint: "For highlighted words, where it passes contrast.", required: true },
  { key: "tint", label: "Tint", hint: "A pale colour for softer backgrounds.", required: true },
  { key: "accent2", label: "Second accent", hint: "Optional.", required: false },
  { key: "line", label: "Line", hint: "Optional. A mid neutral for rules and borders.", required: false },
];
const SURFACES = [
  { key: "dark", label: "Dark surface", hint: "Title and end card" },
  { key: "light", label: "Light surface", hint: "Messages" },
  { key: "tint", label: "Tint surface", hint: "Softer scenes" },
];
const GROUPS = ["colours", "fonts", "logo", "icons", "voice", "tone of voice", "guidelines", "rules"];
const ICON_WEIGHTS = ["thin", "light", "regular", "bold", "fill", "duotone"];
const SCENE_LABELS = { title: "Title", statement: "Statement", end: "End card" };
const FORMAT_LABELS = { "16x9": "16:9", "9x16": "9:16", "1x1": "1:1" };

// ---------- small helpers ----------

const clone = (x) => JSON.parse(JSON.stringify(x));
function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== "object") o[k] = {};
    o = o[k];
  }
  if (value === undefined) delete o[keys[keys.length - 1]];
  else o[keys[keys.length - 1]] = value;
}
const colourName = (key) => S.draft?.colours?.[key]?.name || key;

/**
 * Re-render part of the page without losing keyboard focus. If the focused control was replaced, focus goes to
 * the new control with the same id, or else to the fallback (an id), so keyboard and screen reader users keep
 * their place on this long page.
 */
function keepFocus(fn, fallback) {
  const active = document.activeElement;
  const id = active && active !== document.body ? active.id : "";
  fn();
  const now = document.activeElement;
  if (now && now !== document.body && document.contains(now)) return;
  const target = (id && document.getElementById(id)) || (fallback && (typeof fallback === "string" ? document.getElementById(fallback) : fallback));
  if (target) {
    if (!target.hasAttribute("tabindex") && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: false });
  }
}

/** Put focus on a status or report box after an action rebuilt the controls, so it is read out. */
function focusReport(node) {
  if (!node) return;
  node.setAttribute("tabindex", "-1");
  node.focus();
}
const isHex = (v) => /^#[0-9A-Fa-f]{6}$/.test(v);

function field(id, label, control, hint, extra) {
  // Link the visible hint to its control, so screen readers read it too.
  if (hint && control instanceof Element) {
    const target = control.id === id ? control : control.querySelector?.(`#${CSS.escape(id)}`);
    if (target) {
      const ids = (target.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
      if (!ids.includes(`${id}-hint`)) target.setAttribute("aria-describedby", [`${id}-hint`, ...ids].join(" "));
    }
  }
  return el(
    "div",
    { class: "field" },
    el("label", { for: id }, label),
    hint ? el("p", { class: "hint", id: `${id}-hint` }, hint) : null,
    control,
    extra || null,
  );
}

/** A text, number or select control bound to a path in the draft. */
function bound(tag, path, attrs = {}, opts = {}) {
  const id = attrs.id || `f-${path.replace(/\./g, "-")}`;
  const n = el(tag, { ...attrs, id });
  if (tag === "select") for (const o of opts.options || []) n.append(el("option", { value: o.value }, o.label));
  const cur = getPath(S.draft, path);
  if (attrs.type === "checkbox") n.checked = Boolean(cur);
  else n.value = cur == null ? "" : opts.toText ? opts.toText(cur) : String(cur);
  if (opts.hintId) n.setAttribute("aria-describedby", opts.hintId);
  n.addEventListener(tag === "select" || attrs.type === "checkbox" ? "change" : "input", () => {
    let v = attrs.type === "checkbox" ? n.checked : n.value;
    if (opts.fromText) v = opts.fromText(v);
    else if (attrs.type === "number") v = v === "" ? undefined : Number(v);
    setPath(S.draft, path, v);
    edited(opts.after);
  });
  return n;
}

function counterFor(input, max) {
  const out = el("p", { class: "char-count", "aria-live": "polite" });
  const up = () => {
    const n = input.value.length;
    out.textContent = n > max ? `${n - max} characters too many` : `${max - n} characters left`;
    out.classList.toggle("over", n > max);
  };
  input.addEventListener("input", up);
  up();
  return out;
}

// ---------- confirmation dialog ----------

function confirmDialog(title, body, yesText) {
  return new Promise((resolve) => {
    const d = $("confirm-dialog");
    $("confirm-title").textContent = title;
    $("confirm-body").replaceChildren(...(Array.isArray(body) ? body : [body]).map((b) => (typeof b === "string" ? el("p", {}, b) : b)));
    $("confirm-yes").textContent = yesText;
    const done = (v) => {
      d.close();
      $("confirm-yes").onclick = null;
      $("confirm-no").onclick = null;
      resolve(v);
    };
    $("confirm-yes").onclick = () => done(true);
    $("confirm-no").onclick = () => done(false);
    d.addEventListener("cancel", () => resolve(false), { once: true });
    d.showModal();
    $("confirm-no").focus();
  });
}

// ---------- start ----------

async function init() {
  try {
    [S.meta, S.brands] = await Promise.all([api("GET", "/api/meta"), api("GET", "/api/brands")]);
  } catch (e) {
    $("page").replaceChildren(el("div", { class: "error-summary", role: "alert" }, el("h2", {}, "There is a problem"), el("p", {}, e.message)));
    return;
  }
  const id = new URLSearchParams(location.search).get("brand");
  if (id) openEditor(id);
  else renderList();
  window.addEventListener("beforeunload", (e) => {
    if (dirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  $("preview-dialog-close").onclick = () => $("preview-dialog").close();
  $("side-dialog-close").onclick = closeSidePanel;
  $("side-dialog").addEventListener("close", () => {
    const side = $("side");
    const editor = document.querySelector(".editor");
    if (side && editor && side.parentElement?.id === "side-dialog-body") editor.append(side);
    $("show-preview-button")?.focus();
  });
}

// ---------- list ----------

async function renderList(message) {
  S.id = null;
  document.title = "Brands - Video maker";
  history.replaceState(null, "", "/brands");
  try {
    S.brands = await api("GET", "/api/brands");
  } catch (e) {
    /* keep the old list */
  }
  const errors = el("div", { id: "list-errors", hidden: true });
  const nameInput = el("input", { type: "text", id: "new-name", maxlength: "80", autocomplete: "off", "aria-describedby": "new-name-hint" });
  const nameError = el("p", { class: "error-text", id: "new-name-error", hidden: true });
  const from = el(
    "select",
    { id: "new-from", "aria-describedby": "new-from-hint" },
    el("option", { value: "blank" }, "A blank brand"),
    S.brands.map((b) => el("option", { value: b.id }, `A copy of ${b.name}'s settings`)),
  );
  from.value = "blank";
  const createForm = el(
    "form",
    { novalidate: true, class: "panel narrow" },
    el("h2", {}, "Add a brand"),
    el(
      "div",
      { class: "field" },
      el("label", { for: "new-name" }, "Name of the organisation or brand"),
      el("p", { class: "hint", id: "new-name-hint" }, "For example: Riverside District Council."),
      nameError,
      nameInput,
    ),
    field("new-from", "Start from", from, "A blank brand has plain colours, the Atkinson Hyperlegible Next font and no writing guidance, ready for your own. A copy takes another brand's fonts, sizes and settings, but not its colour names, logo or icons. Either way the logo is a plain placeholder made from the name until you upload the real one."),
    el("div", { class: "button-row" }, el("button", { type: "submit", class: "button" }, "Create brand")),
  );
  createForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    nameError.hidden = true;
    nameInput.removeAttribute("aria-invalid");
    nameInput.setAttribute("aria-describedby", "new-name-hint");
    if (!nameInput.value.trim()) {
      nameError.hidden = false;
      nameError.textContent = "Error: Enter a name for the brand";
      nameInput.setAttribute("aria-invalid", "true");
      nameInput.setAttribute("aria-describedby", "new-name-error new-name-hint");
      errors.hidden = false;
      errors.replaceChildren(
        el("div", { class: "error-summary", role: "alert", tabindex: "-1" }, el("h2", {}, "There is a problem"), el("ul", {}, el("li", {}, el("a", { href: "#new-name" }, "Enter a name for the brand")))),
      );
      errors.firstChild.focus();
      return;
    }
    try {
      const r = await api("POST", "/api/brands", { name: nameInput.value.trim(), from: from.value });
      openEditor(r.id, r.notes);
    } catch (err) {
      showErrors(errors, "There is a problem", [err.message]);
    }
  });

  const cards = S.brands.map((b) => {
    const dupBox = el("div");
    const card = el(
      "li",
      { class: "brand-card" },
      el("div", { class: "logo" }, b.logo ? el("img", { src: b.logo, alt: "" }) : null),
      el("h3", {}, b.name),
      el(
        "p",
        { class: "small" },
        b.fictional ? el("span", { class: "tag" }, "Sample") : null,
        " ",
        b.ok ? el("span", { class: "tag good" }, "Ready to use") : el("span", { class: "tag bad" }, "Has problems"),
      ),
      b.provisional?.length ? el("p", { class: "small" }, `Not yet checked against the brand guidelines: ${b.provisional.join(", ")}.`) : el("p", { class: "small" }, "Everything checked against the brand guidelines."),
      !b.ok && b.errors?.length ? el("ul", { class: "list small" }, b.errors.slice(0, 3).map((x) => el("li", {}, x))) : null,
      dupBox,
      el(
        "div",
        { class: "button-row" },
        el("a", { class: "button small", href: `/brands?brand=${encodeURIComponent(b.id)}`, onclick: (e) => { e.preventDefault(); openEditor(b.id); } }, el("span", {}, "Edit"), el("span", { class: "visually-hidden" }, ` ${b.name}`)),
        el("button", { type: "button", class: "button secondary small", onclick: () => showDuplicate(b, dupBox) }, "Duplicate", el("span", { class: "visually-hidden" }, ` ${b.name}`)),
        b.protected ? null : el("button", { type: "button", class: "button warning small", onclick: () => removeBrand(b) }, "Delete", el("span", { class: "visually-hidden" }, ` ${b.name}`)),
      ),
    );
    return card;
  });

  $("page").replaceChildren(
    el("h1", {}, "Brands"),
    el("p", { class: "lede" }, "A brand sets the colours, fonts, logo, icons, voice and tone of every video. Pick the brand when you make a video."),
    message ? el("div", { class: "success", role: "status" }, el("p", {}, message)) : null,
    errors,
    el("h2", {}, "Your brands"),
    el("ul", { class: "brand-list" }, cards),
    createForm,
  );
}

function showDuplicate(b, box) {
  const id = `dup-${b.id}`;
  const input = el("input", { type: "text", id, value: `${b.name} copy`, maxlength: "80" });
  const err = el("p", { class: "error-text", hidden: true });
  box.replaceChildren(
    el(
      "form",
      { novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        try {
          const r = await api("POST", "/api/brands", { duplicate: true, from: b.id, name: input.value.trim() });
          openEditor(r.id);
        } catch (er) {
          err.hidden = false;
          err.textContent = `Error: ${er.message}`;
        }
      } },
      field(id, "Name for the copy", input, "Everything is copied: colours, fonts, logo, icons and writing guidance."),
      err,
      el("div", { class: "button-row" }, el("button", { type: "submit", class: "button small" }, "Make the copy"), el("button", { type: "button", class: "button secondary small", onclick: () => box.replaceChildren() }, "Cancel")),
    ),
  );
  input.focus();
  input.select();
}

async function removeBrand(b) {
  const ok = await confirmDialog(
    `Delete ${b.name}?`,
    [`This deletes the brand and its fonts, logos, icons, graphics and guidelines files. It cannot be undone.`, `Videos already made with it are kept, but they cannot be made again with this brand.`],
    "Delete brand",
  );
  if (!ok) return;
  try {
    await api("DELETE", `/api/brands/${encodeURIComponent(b.id)}`, { confirm: b.id });
    S.draft = null;
    S.saved = "";
    renderList(`${b.name} has been deleted.`);
  } catch (e) {
    renderList();
    setTimeout(() => showErrors($("list-errors"), "There is a problem", [e.message]), 50);
  }
}

// ---------- editor ----------

const dirty = () => S.draft && JSON.stringify(S.draft) !== S.saved;

async function openEditor(id, notes) {
  let d;
  try {
    d = await api("GET", `/api/brands/${encodeURIComponent(id)}`);
  } catch (e) {
    renderList();
    setTimeout(() => showErrors($("list-errors"), "There is a problem", [e.message]), 50);
    return;
  }
  S.id = id;
  S.detail = d;
  S.draft = clone(d.raw);
  S.saved = JSON.stringify(S.draft);
  S.check = d.check;
  S.files = d.files;
  S.icons = d.icons;
  S.suggestions = null;
  history.replaceState(null, "", `/brands?brand=${encodeURIComponent(id)}`);
  document.title = `Edit ${d.raw.name} - Brands - Video maker`;
  renderEditor(notes);
  runCheck();
  runPreview();
  $("editor-title").focus();
}

const SECTIONS = [
  ["sec-about", "Name and status"],
  ["sec-guidelines", "Read your brand guidelines"],
  ["sec-colours", "Colours and contrast"],
  ["sec-fonts", "Fonts"],
  ["sec-type", "Type sizes and spacing"],
  ["sec-logo", "Logo"],
  ["sec-icons", "Icons and graphics"],
  ["sec-voice", "Voice"],
  ["sec-writing", "Tone of voice and guidelines"],
];

function renderEditor(notes) {
  const sections = SECTIONS.map(([id, title]) => el("section", { id, "aria-labelledby": `${id}-h` }, el("h2", { id: `${id}-h`, tabindex: "-1" }, title), el("div", { id: `${id}-body` })));
  $("page").replaceChildren(
    el("p", {}, el("a", { href: "/brands", onclick: async (e) => {
      e.preventDefault();
      if (dirty() && !(await confirmDialog("Leave without saving?", "You have changes that are not saved.", "Leave without saving"))) return;
      S.draft = null;
      renderList();
    } }, "Back to all brands")),
    el("h1", { id: "editor-title", tabindex: "-1" }, `Edit ${S.draft.name}`),
    S.detail.protected ? el("div", { class: "notice" }, el("p", {}, "This is the sample brand for a fictional council. You can change it, but you cannot delete it. To make a brand for a real organisation, go back and add a brand or duplicate this one.")) : null,
    notes?.length ? el("div", { class: "notice warn" }, el("h2", {}, "Things to do next"), el("ul", { class: "list" }, notes.map((n) => el("li", {}, n)))) : null,
    el("div", { id: "top-errors" }),
    el(
      "div",
      { class: "editor" },
      el(
        "div",
        { class: "main" },
        el("nav", { "aria-label": "Brand sections" }, el("ol", { class: "toc" }, SECTIONS.map(([id, t]) => el("li", {}, el("a", { href: `#${id}` }, t))))),
        el("p", {}, "Changes are checked and previewed as you type. Press Save brand to keep them. Uploaded files are saved straight away."),
        ...sections,
        S.detail.protected ? null : el("section", {}, el("h2", {}, "Delete this brand"), el("button", { type: "button", class: "button warning", onclick: () => removeBrand({ id: S.id, name: S.draft.name }) }, "Delete brand")),
      ),
      el(
        "div",
        { class: "side", id: "side" },
        el("h2", {}, "Preview"),
        el("p", { class: "small" }, "Title, Statement and End card in each format, as they will render. Select a picture to see it larger."),
        el("div", { id: "preview", class: "previews" }, el("p", {}, "Loading the preview...")),
        el("h2", {}, "Checks"),
        el("div", { id: "checks", "aria-live": "polite" }),
      ),
    ),
    el(
      "div",
      { class: "save-bar" },
      el("button", { type: "button", class: "button", id: "save-button", onclick: save }, "Save brand"),
      el("button", { type: "button", class: "button secondary narrow-only", id: "show-preview-button", onclick: openSidePanel }, "Show preview and checks"),
      el("span", { class: "status", id: "save-status", role: "status" }),
      el("span", { class: "check-summary", id: "check-summary" }),
    ),
  );
  renderAbout();
  renderGuidelines();
  renderColours();
  renderFonts();
  renderType();
  renderLogo();
  renderIcons();
  renderVoice();
  renderWriting();
  updateSaveStatus();
}

// On narrow screens (or when zoomed in) the preview and checks open in a dialog from the save bar, which is
// always in view, instead of sitting after a page of controls. The panel is moved into the dialog and back.
function openSidePanel() {
  const side = $("side");
  const d = $("side-dialog");
  if (!side || !d) return;
  side.dataset.home = "1";
  $("side-dialog-body").append(side);
  d.showModal();
  $("side-dialog-close").focus();
}

function closeSidePanel() {
  const side = $("side");
  const editor = document.querySelector(".editor");
  if (side && editor && side.parentElement?.id === "side-dialog-body") editor.append(side);
  $("side-dialog").close();
}

function updateSaveStatus(text) {
  const st = $("save-status");
  if (!st) return;
  if (text) st.textContent = text;
  else st.textContent = dirty() ? "You have unsaved changes." : "All changes saved.";
}

const scheduleCheck = debounce(() => runCheck(), 250);
const schedulePreview = debounce(() => runPreview(), 650);
function edited(after) {
  updateSaveStatus();
  scheduleCheck();
  schedulePreview();
  if (after) after();
}

async function runCheck() {
  if (!S.id) return;
  try {
    S.check = await api("POST", `/api/brands/${encodeURIComponent(S.id)}/check`, { brand: S.draft });
  } catch (e) {
    S.check = { ok: false, issues: [{ level: "error", field: "brand", message: e.message }], contrast: [] };
  }
  renderChecks();
  renderContrast();
}

async function runPreview() {
  if (!S.id) return;
  const seq = ++S.previewSeq;
  let r;
  try {
    r = await api("POST", `/api/brands/${encodeURIComponent(S.id)}/preview`, { brand: S.draft });
  } catch (e) {
    if (seq === S.previewSeq) $("preview").replaceChildren(el("p", { class: "error-text" }, `The preview could not be made: ${e.message}`));
    return;
  }
  if (seq !== S.previewSeq || !$("preview")) return;
  renderPreview(r.items);
}

// ---------- preview ----------

function renderPreview(items) {
  const box = $("preview");
  if (!items.length) {
    box.replaceChildren(el("p", {}, "Fix the problems listed under Checks to see a preview."));
    return;
  }
  const H = 180;
  const scenes = [...new Set(items.map((i) => i.scene))];
  // Reuse iframes so the old picture stays until the new one has loaded.
  for (const scene of scenes) {
    let row = box.querySelector(`[data-scene-row="${scene}"]`);
    if (!row) {
      if (!box.querySelector("[data-scene-row]")) box.replaceChildren();
      row = el("div", { class: "scene-row", dataset: { sceneRow: scene } }, el("h3", {}, SCENE_LABELS[scene] ?? scene), el("div", { class: "frames" }));
      box.append(row);
    }
    const frames = row.querySelector(".frames");
    for (const it of items.filter((i) => i.scene === scene)) {
      const key = `${scene}-${it.format}`;
      let wrap = frames.querySelector(`[data-key="${key}"]`);
      const scale = H / it.height;
      if (!wrap) {
        const frame = el("iframe", { title: `${SCENE_LABELS[scene] ?? scene} preview, ${FORMAT_LABELS[it.format]}`, tabindex: "-1", width: it.width, height: it.height, style: `transform:scale(${scale})`, "aria-hidden": "true" });
        const btn = el(
          "button",
          { type: "button", class: "preview-button", style: `width:${Math.round(it.width * scale) + 4}px;height:${Math.round(it.height * scale) + 4}px`, "aria-label": `Show the ${SCENE_LABELS[scene] ?? scene} preview in ${FORMAT_LABELS[it.format]} larger` },
          frame,
        );
        wrap = el("div", { dataset: { key } }, btn, el("p", { class: "preview-label" }, FORMAT_LABELS[it.format]));
        frames.append(wrap);
      }
      wrap.querySelector("iframe").src = it.url;
      wrap.querySelector("button").onclick = () => openBigPreview(it);
    }
  }
}

function openBigPreview(it) {
  const maxW = Math.min(window.innerWidth * 0.9, 1600);
  const maxH = window.innerHeight * 0.7;
  const scale = Math.min(maxW / it.width, maxH / it.height, 1);
  $("preview-dialog-title").textContent = `${SCENE_LABELS[it.scene] ?? it.scene}, ${FORMAT_LABELS[it.format]}`;
  $("preview-dialog-body").replaceChildren(
    el(
      "div",
      { class: "big-preview", style: `width:${Math.round(it.width * scale) + 4}px;height:${Math.round(it.height * scale) + 4}px` },
      el("iframe", { src: it.url, width: it.width, height: it.height, style: `transform:scale(${scale})`, title: `${SCENE_LABELS[it.scene] ?? it.scene} preview, ${FORMAT_LABELS[it.format]}` }),
    ),
    it.issues?.length ? el("ul", { class: "list" }, it.issues.map((i) => el("li", {}, i))) : null,
  );
  $("preview-dialog").showModal();
  $("preview-dialog-close").focus();
}

// ---------- checks ----------

const FIELD_SECTIONS = [
  [/^colours|^surfaces|^captions(?!\.weight)/, "sec-colours", "Colours"],
  [/^fonts|^captions\.weight/, "sec-fonts", "Fonts"],
  [/^typeScale|^lineHeight|^letterSpacing|^spacing|^radius/, "sec-type", "Type sizes"],
  [/^logo/, "sec-logo", "Logo"],
  [/^icons|^graphics/, "sec-icons", "Icons"],
  [/^voice/, "sec-voice", "Voice"],
  [/^toneOfVoice|^guidelines|^rules/, "sec-writing", "Writing"],
  [/^provisional|^name|^id|^description/, "sec-about", "Name and status"],
];
function sectionFor(field) {
  for (const [re, id, label] of FIELD_SECTIONS) if (re.test(field || "")) return { id, label };
  return { id: "sec-about", label: "Brand" };
}

function renderChecks() {
  const box = $("checks");
  if (!box) return;
  const issues = S.check?.issues ?? [];
  const errors = issues.filter((i) => i.level === "error");
  // "Still to confirm" groups are one line, so they do not bury a real warning.
  const unconfirmed = issues.filter((i) => i.level === "warning" && i.field === "provisional").map((i) => i.message.replace(/ is provisional and still needs confirming\.$/, ""));
  const warnings = issues.filter((i) => i.level === "warning" && i.field !== "provisional");
  const item = (i) => {
    const s = sectionFor(i.field);
    return el("li", {}, el("a", { href: `#${s.id}` }, s.label), `: ${i.message}`);
  };
  box.replaceChildren(
    errors.length
      ? el("div", { class: "error-summary" }, el("h3", {}, `${errors.length} problem${errors.length === 1 ? "" : "s"} stop${errors.length === 1 ? "s" : ""} this brand being used`), el("ul", { class: "issues" }, errors.map(item)))
      : el("div", { class: "success" }, el("p", { class: "ok-text" }, warnings.length ? "This brand can be used for videos. It passes AAA contrast. Look at the points under Worth checking." : "This brand passes every check, including AAA contrast. It can be used for videos.")),
    warnings.length ? el("div", {}, el("h3", {}, "Worth checking"), el("ul", { class: "issues list" }, warnings.map(item))) : null,
    unconfirmed.length
      ? el("p", {}, el("a", { href: "#sec-about" }, "Not yet checked against the brand guidelines"), `: ${unconfirmed.join(", ")}. These do not stop videos being made.`)
      : null,
  );
  renderCheckSummary(errors.length, warnings.length);
  renderLogoWarnings();
}

/** One line in the save bar, so the result of the checks is always in view, whatever the screen size. */
function renderCheckSummary(nErrors, nWarnings = 0) {
  const box = $("check-summary");
  if (!box) return;
  setTextIfChanged(
    box,
    nErrors
      ? `${nErrors} problem${nErrors === 1 ? "" : "s"} stop${nErrors === 1 ? "s" : ""} this brand being used.`
      : nWarnings
        ? `Can be used. ${nWarnings} thing${nWarnings === 1 ? "" : "s"} worth checking.`
        : "Passes every check.",
  );
  box.className = `check-summary ${nErrors ? "error-text" : "ok-text"}`;
}

function setTextIfChanged(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

/** Logo problems shown next to the logo itself, with the white-version button when it would help. */
function renderLogoWarnings() {
  for (const key of ["onDark", "onLight"]) {
    const box = $(`logo-${key}-warn`);
    if (!box) continue;
    const found = (S.check?.issues ?? []).filter((i) => i.field === `logo.${key}` && !/^PNG logos/.test(i.message));
    box.replaceChildren(
      ...found.map((i) =>
        el(
          "div",
          { class: i.level === "error" ? "error-summary" : "notice warn" },
          el("p", {}, i.level === "error" ? el("strong", {}, "Problem: ") : el("strong", {}, "Check: "), i.message.replace(/ Upload a white or reversed logo for dark backgrounds, or use Make a white version in the Logo section\.$/, " Upload a white or reversed logo for dark backgrounds, or make a white version.")),
          key === "onDark" && /\.svg$/i.test(S.draft.logo.onLight || "") ? el("button", { type: "button", class: "button secondary small", onclick: () => $("reverse-logo-button")?.click() }, "Make a white version for dark backgrounds") : null,
        ),
      ),
    );
  }
}

// ---------- section: about ----------

function renderAbout() {
  const body = $("sec-about-body");
  const name = bound("input", "name", { type: "text", maxlength: "80" }, { after: () => ($("editor-title").textContent = `Edit ${S.draft.name}`) });
  const desc = bound("textarea", "description", { rows: "3", maxlength: "400" });
  const fictional = bound("input", "fictional", { type: "checkbox" });
  const prov = new Set(S.draft.provisional ?? []);
  const groups = [...new Set([...GROUPS, ...prov])];
  body.replaceChildren(
    field("f-name", "Name", name),
    field("f-description", "Description (optional)", desc, "A sentence about the organisation. The script writer reads it."),
    el("p", {}, `Brand id: ${S.id} (used for the folder name; it cannot be changed).`),
    el("label", { class: "check" }, fictional, el("span", {}, "This is a sample brand, not a real organisation")),
    el(
      "fieldset",
      {},
      el("legend", {}, "Still to confirm"),
      el("p", { class: "hint" }, "Tick anything that is a placeholder until the real guidelines confirm it. These show as warnings, not problems."),
      el(
        "div",
        { class: "inline-checks" },
        groups.map((g) => {
          const cb = el("input", { type: "checkbox", value: g, checked: prov.has(g) });
          cb.addEventListener("change", () => {
            const cur = new Set(S.draft.provisional ?? []);
            cb.checked ? cur.add(g) : cur.delete(g);
            S.draft.provisional = [...cur];
            edited();
          });
          return el("label", { class: "check" }, cb, el("span", {}, g));
        }),
      ),
    ),
  );
}

// ---------- section: guidelines file ----------

function renderGuidelines() {
  const body = $("sec-guidelines-body");
  const input = el("input", { type: "file", id: "guidelines-file", accept: ".pdf,.md,.txt,application/pdf,text/plain,text/markdown", "aria-describedby": "guidelines-file-hint" });
  const status = el("div", { "aria-live": "polite" });
  const out = el("div", { id: "suggestions" });
  const docs = S.files.documents?.length ? el("p", { class: "small" }, `Files already added: ${S.files.documents.join(", ")}.`) : null;
  body.replaceChildren(
    el("p", {}, "Upload the brand guidelines and the video maker will suggest colours, fonts, tone of voice and rules from them. Nothing changes until you choose which suggestions to use."),
    field("guidelines-file", "Guidelines file", input, "A PDF, Markdown or text file, up to 25 MB. For a Word document, save it as a PDF first."),
    docs,
    el("div", { class: "button-row" }, el("button", { type: "button", class: "button secondary", onclick: read }, "Read guidelines")),
    status,
    out,
  );
  if (S.suggestions) renderSuggestions(S.suggestions);
  async function read() {
    const f = input.files[0];
    if (!f) return (status.replaceChildren(el("p", { class: "error-text" }, "Error: Choose a guidelines file first.")), input.focus());
    const fd = new FormData();
    fd.append("file", f, f.name);
    status.replaceChildren(el("p", { class: "progress-text" }, "Reading the guidelines. This can take up to a minute for a long document."));
    try {
      const r = await api("POST", `/api/brands/${encodeURIComponent(S.id)}/guidelines`, fd);
      S.files = r.files;
      S.suggestions = r.suggestions;
      status.replaceChildren(el("p", { class: "ok-text" }, `Read ${r.suggestions.pages ? `${r.suggestions.pages} pages, ` : ""}${r.suggestions.chars.toLocaleString("en-GB")} characters. The file is kept with the brand.`));
      renderSuggestions(r.suggestions);
      $("suggestions-h")?.focus();
    } catch (e) {
      status.replaceChildren(el("p", { class: "error-text", role: "alert" }, `Error: ${e.message}`));
    }
  }
}

function renderSuggestions(s) {
  const out = $("suggestions");
  const picks = [];
  const roleSel = (c, i) => {
    const sel = el("select", { id: `sg-colour-${i}`, "aria-label": `Use ${c.value}${c.name ? ` (${c.name})` : ""} as` }, el("option", { value: "" }, "Do not use"), ROLES.map((r) => el("option", { value: r.key }, `${r.label} colour`)));
    sel.value = c.role && ROLES.some((r) => r.key === c.role) ? c.role : "";
    picks.push(() => sel.value && { kind: "colour", role: sel.value, value: c.value, name: c.name });
    return sel;
  };
  const tick = (id, label, kind, data, checked = true) => {
    const cb = el("input", { type: "checkbox", id, checked });
    picks.push(() => cb.checked && { kind, data });
    return el("label", { class: "check", for: id }, cb, el("span", {}, label));
  };
  const parts = [el("h3", { id: "suggestions-h", tabindex: "-1" }, "Suggestions from your guidelines")];
  if (s.colours.length) {
    parts.push(
      el("h4", {}, "Colours"),
      el(
        "div",
        { class: "suggestions" },
        s.colours.map((c, i) =>
          el(
            "div",
            { class: "row" },
            el("span", { class: "swatch", style: `background:${c.value}`, "aria-hidden": "true" }),
            el("strong", {}, c.value),
            el("span", {}, c.name ?? ""),
            roleSel(c, i),
            c.context ? el("span", { class: "small" }, `Found in: "${c.context.slice(0, 90)}"`) : null,
          ),
        ),
      ),
    );
  }
  if (s.fonts.length) {
    parts.push(
      el("h4", {}, "Fonts"),
      el(
        "ul",
        { class: "font-results" },
        s.fonts.map((f) =>
          el(
            "li",
            {},
            el("span", { class: "fam" }, f.family),
            el("span", {}, f.role ? `For ${f.role === "heading" ? "headings" : "body text"}.` : ""),
            f.openFont
              ? el("button", { type: "button", class: "button secondary small", onclick: () => useOpenFont(f.family, true) }, `Download and use ${f.family}`)
              : el("span", { class: "small" }, "This font cannot be downloaded here. If the organisation has the font files, upload them in the Fonts section."),
          ),
        ),
      ),
    );
  }
  if (s.toneOfVoice) parts.push(el("h4", {}, "Tone of voice"), el("div", { class: "quote" }, s.toneOfVoice), tick("sg-tone", "Use this as the tone of voice", "tone", s.toneOfVoice));
  if (s.guidelines) parts.push(el("h4", {}, "Guidelines for the script writer"), el("div", { class: "quote" }, s.guidelines), tick("sg-guide", "Use this as the guidelines the script writer reads", "guidelines", s.guidelines));
  if (s.rules?.do?.length || s.rules?.dont?.length)
    parts.push(
      el("h4", {}, "Do and don't rules"),
      el("div", { class: "quote" }, [...(s.rules.do ?? []).map((r) => `Do: ${r}`), ...(s.rules.dont ?? []).map((r) => `Don't: ${r}`)].join("\n")),
      tick("sg-rules", "Use these rules (they replace the current ones)", "rules", s.rules),
    );
  if (s.voice) parts.push(tick("sg-voice", `Use the voice ${s.voice.id}. ${s.voice.reason}`, "voice", s.voice.id, false));
  if (s.iconWeight) parts.push(tick("sg-iconweight", `Use ${s.iconWeight} icons`, "iconWeight", s.iconWeight));
  if (s.logoMinHeight) parts.push(tick("sg-logomin", `Keep the logo at least ${s.logoMinHeight} px tall`, "logoMin", s.logoMinHeight));
  if (s.notes?.length) parts.push(el("h4", {}, "Notes"), el("ul", { class: "list" }, s.notes.map((n) => el("li", {}, n))));
  parts.push(
    el(
      "div",
      { class: "button-row" },
      el("button", { type: "button", class: "button", onclick: () => {
        const chosen = picks.map((p) => p()).filter(Boolean);
        applySuggestions(chosen);
      } }, "Use the chosen suggestions"),
    ),
  );
  out.replaceChildren(el("div", { class: "panel" }, ...parts));
}

function applySuggestions(chosen) {
  const done = [];
  for (const c of chosen) {
    if (c.kind === "colour") {
      S.draft.colours[c.role] = { value: c.value.toUpperCase(), ...(c.name ? { name: c.name.slice(0, 40) } : {}) };
      done.push(`${c.role} colour`);
    } else if (c.kind === "tone") {
      S.draft.toneOfVoice = c.data.slice(0, 4000);
      done.push("tone of voice");
    } else if (c.kind === "guidelines") {
      S.draft.guidelines = c.data.slice(0, 20000);
      done.push("guidelines");
    } else if (c.kind === "rules") {
      S.draft.rules = { do: (c.data.do ?? []).map((r) => r.slice(0, 300)), dont: (c.data.dont ?? []).map((r) => r.slice(0, 300)) };
      done.push("rules");
    } else if (c.kind === "voice") {
      S.draft.voice.id = c.data;
      done.push("voice");
    } else if (c.kind === "iconWeight") {
      S.draft.icons = { ...(S.draft.icons ?? {}), weight: c.data };
      done.push("icon weight");
    } else if (c.kind === "logoMin") {
      S.draft.logo.minHeight = c.data;
      done.push("logo size");
    }
  }
  renderColours();
  renderIcons();
  renderVoice();
  renderWriting();
  renderLogo();
  edited();
  announce(done.length ? `Added: ${done.join(", ")}. Check the contrast results, then save.` : "No suggestions were chosen.");
  if (done.length) focusReport($("sec-colours-h"));
}

// ---------- section: colours ----------

function renderColours() {
  const body = $("sec-colours-body");
  const rows = ROLES.map((r) => {
    const tok = S.draft.colours[r.key];
    if (!tok && !r.required) {
      return el(
        "div",
        { class: "colour-row" },
        el("span", { class: "role" }, `${r.label} colour`),
        el("span"),
        el("span"),
        el("span", { class: "small" }, "Not used."),
        el("button", { type: "button", class: "button secondary small", id: `c-${r.key}-add`, onclick: () => {
          S.draft.colours[r.key] = { value: "#505A5F", name: r.label };
          keepFocus(renderColours, `c-${r.key}-hex`);
          $(`c-${r.key}-hex`)?.focus();
          edited();
        } }, `Add a ${r.label.toLowerCase()} colour`),
      );
    }
    const hexId = `c-${r.key}-hex`;
    const picker = el("input", { type: "color", id: `c-${r.key}-pick`, value: tok?.value?.toLowerCase() ?? "#000000", "aria-label": `${r.label} colour picker` });
    const hex = el("input", { type: "text", id: hexId, value: tok?.value ?? "", maxlength: "7", spellcheck: "false", autocomplete: "off" });
    const nameIn = el("input", { type: "text", id: `c-${r.key}-name`, value: tok?.name ?? "", maxlength: "40" });
    const err = el("p", { class: "error-text", hidden: true, id: `${hexId}-err` });
    const setVal = (v) => {
      S.draft.colours[r.key] = { ...(S.draft.colours[r.key] ?? {}), value: v.toUpperCase() };
      edited();
    };
    picker.addEventListener("input", () => {
      hex.value = picker.value.toUpperCase();
      err.hidden = true;
      setVal(picker.value);
    });
    hex.addEventListener("input", () => {
      let v = hex.value.trim();
      if (/^[0-9A-Fa-f]{6}$/.test(v)) v = `#${v}`;
      if (isHex(v)) {
        err.hidden = true;
        hex.removeAttribute("aria-invalid");
        picker.value = v.toLowerCase();
        setVal(v);
      } else {
        err.hidden = false;
        err.textContent = "Error: Enter the colour as # and 6 letters or numbers, such as #0B3B60";
        hex.setAttribute("aria-invalid", "true");
      }
    });
    hex.setAttribute("aria-describedby", `${hexId}-err c-${r.key}-hint`);
    nameIn.addEventListener("input", () => {
      const v = nameIn.value.trim();
      if (v) S.draft.colours[r.key].name = v;
      else delete S.draft.colours[r.key].name;
      edited(renderSurfaceSelects);
    });
    return el(
      "div",
      {},
      el(
        "div",
        { class: "colour-row" },
        el("span", { class: "role" }, `${r.label} colour`),
        picker,
        el("div", {}, el("label", { for: hexId }, "Hex value"), hex),
        el("div", {}, el("label", { for: `c-${r.key}-name` }, "Name"), nameIn),
        r.required
          ? el("span")
          : el("button", { type: "button", class: "button secondary small", onclick: () => {
              delete S.draft.colours[r.key];
              keepFocus(renderColours, `c-${r.key}-add`);
              edited();
            } }, "Remove"),
      ),
      el("p", { class: "small", id: `c-${r.key}-hint` }, r.hint),
      err,
    );
  });
  body.replaceChildren(
    el("p", {}, "Every text colour must have a contrast of at least 7 to 1 with its background (WCAG AAA). The checks below update as you type."),
    ...rows,
    el("h3", { id: "contrast-h", tabindex: "-1" }, "Contrast checks"),
    el("div", { id: "contrast" }),
    el("h3", {}, "Where each colour is used"),
    el("p", {}, "Scenes use surfaces, not colours. Choose the colours for each surface and for the caption box."),
    el("div", { class: "button-row" }, el("button", { type: "button", class: "button secondary", id: "propose-button", onclick: proposeSurfaces }, "Choose passing colours for me")),
    el("div", { id: "propose-notes", "aria-live": "polite" }),
    el("div", { id: "surface-selects", class: "surface-grid" }),
  );
  renderSurfaceSelects();
  renderContrast();
}

function colourOptions() {
  return Object.keys(S.draft.colours)
    .filter((k) => S.draft.colours[k])
    .map((k) => ({ value: k, label: `${colourName(k)} (${S.draft.colours[k].value})` }));
}

function renderSurfaceSelects() {
  const box = $("surface-selects");
  if (!box) return;
  const opts = colourOptions();
  const sel = (path, label) => {
    const id = `s-${path.replace(/\./g, "-")}`;
    const s = bound("select", path, { id }, { options: opts });
    if (!opts.some((o) => o.value === getPath(S.draft, path))) s.prepend(el("option", { value: getPath(S.draft, path) ?? "", selected: true }, `${getPath(S.draft, path) ?? "None"} (missing)`));
    return el("div", {}, el("label", { for: id }, label), s);
  };
  const weights = [...new Set((S.draft.fonts.faces ?? []).filter((f) => f.family === S.draft.fonts.body.family).map((f) => f.weight))].filter((w) => w >= 400 && w <= 800).sort();
  const capWeight = bound("select", "captions.weight", { id: "s-captions-weight" }, { options: (weights.length ? weights : [400]).map((w) => ({ value: String(w), label: String(w) })), fromText: Number });
  box.replaceChildren(
    ...SURFACES.map((s) =>
      el("fieldset", {}, el("legend", {}, `${s.label}: ${s.hint}`), sel(`surfaces.${s.key}.background`, "Background"), sel(`surfaces.${s.key}.text`, "Text"), sel(`surfaces.${s.key}.accent`, "Highlighted words")),
    ),
    el("fieldset", {}, el("legend", {}, "Captions"), sel("captions.background", "Caption box"), sel("captions.text", "Caption text"), el("div", {}, el("label", { for: "s-captions-weight" }, "Caption font weight"), capWeight)),
  );
}

/**
 * A picture of the colour pair. It is drawn as SVG, not text, because it must show failing pairs as they
 * would look, and the page's own text has to keep AAA contrast. The result is given in words beside it.
 */
function contrastSample(fg, bg) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "sample");
  svg.setAttribute("viewBox", "0 0 108 44");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const rect = document.createElementNS(ns, "rect");
  for (const [k, v] of Object.entries({ width: "108", height: "44", fill: bg })) rect.setAttribute(k, v);
  const text = document.createElementNS(ns, "text");
  for (const [k, v] of Object.entries({ x: "54", y: "30", "text-anchor": "middle", "font-size": "20", "font-weight": "700", fill: fg })) text.setAttribute(k, v);
  text.textContent = "Aa";
  svg.append(rect, text);
  return svg;
}

function renderContrast() {
  const box = $("contrast");
  if (!box) return;
  const pairs = S.check?.contrast ?? [];
  if (!pairs.length) {
    box.replaceChildren(el("p", {}, "The contrast checks appear when every colour has a valid value."));
    return;
  }
  box.replaceChildren(
    el(
      "ul",
      { class: "contrast" },
      pairs.map((p) => {
        const r = p.result;
        // Which colour token is the foreground of this pair?
        const fgToken = p.id === "captions" ? S.draft.captions?.text : getPath(S.draft, p.id);
        return el(
          "li",
          {},
          contrastSample(r.foreground, r.background),
          el(
            "div",
            { class: "result" },
            el("strong", {}, p.label),
            " ",
            r.passesAAA ? el("span", { class: "tag good" }, `Passes AAA: ${r.ratioText} to 1`) : el("span", { class: "tag bad" }, `Fails AAA: ${r.ratioText} to 1`),
            el("p", { class: r.passesAAA ? "" : "error-text" }, r.passesAAA ? r.message : r.message.replace(/ Try #[0-9A-F]{6} for the text, or change the background\.$/, "")),
            !r.passesAAA ? fixButtons(p.id, fgToken) : null,
          ),
        );
      }),
    ),
  );
}

/**
 * One-click fixes for a failing pair. They come from the server, which tries each one on the whole brand and
 * only offers fixes that leave every other pair passing (engine/brand/fixes.ts).
 */
function fixButtons(pairId, fgToken) {
  const fixes = S.check?.fixes?.[pairId] ?? [];
  if (!fixes.length) {
    return el(
      "div",
      { class: "fixes" },
      el("p", {}, "No single change fixes this without making another pair fail. Let the video maker choose the colour for each surface, or change the colours above."),
      el("button", { type: "button", class: "button secondary small", onclick: () => proposeSurfaces().then(() => focusReport($("propose-notes"))) }, "Choose passing colours for me"),
    );
  }
  return el(
    "div",
    { class: "fixes" },
    el("p", { class: "small" }, fixes.length === 1 ? "One way to fix it:" : "Ways to fix it:"),
    el(
      "ul",
      { class: "fix-list" },
      fixes.map((f) =>
        el(
          "li",
          {},
          el("button", { type: "button", class: "button secondary small", onclick: () => applyFix(f) }, f.label),
          el("span", { class: "small" }, f.note),
        ),
      ),
    ),
  );
}

function applyFix(f) {
  if (f.kind === "use") setPath(S.draft, f.path, f.token);
  else if (f.kind === "recolour" && S.draft.colours[f.colour]) S.draft.colours[f.colour].value = f.value.toUpperCase();
  renderColours();
  // The list is rebuilt when the check comes back; keep focus on the heading above it meanwhile.
  focusReport($("contrast-h"));
  edited();
  announce(`${f.label.replace(/^Use/, "Using").replace(/^Change/, "Changed")}. The contrast checks are updating.`);
}

async function proposeSurfaces() {
  const notes = $("propose-notes");
  try {
    const p = await api("POST", `/api/brands/${encodeURIComponent(S.id)}/propose-surfaces`, { colours: S.draft.colours });
    S.draft.surfaces = p.surfaces;
    S.draft.captions = { ...S.draft.captions, ...p.captions };
    renderSurfaceSelects();
    edited();
    notes.replaceChildren(
      p.ok ? el("p", { class: "ok-text" }, "Every pair now passes AAA.") : el("p", { class: "error-text" }, "Some pairs still fail. Change the colours themselves."),
      p.notes?.length ? el("ul", { class: "list" }, p.notes.map((n) => el("li", {}, n))) : null,
    );
  } catch (e) {
    notes.replaceChildren(el("p", { class: "error-text" }, `Error: ${e.message}`));
  }
}

// ---------- section: fonts ----------

function families() {
  return [...new Set((S.draft.fonts.faces ?? []).map((f) => f.family))];
}

function renderFonts() {
  const body = $("sec-fonts-body");
  const roleControls = (role, label) => {
    const famId = `font-${role}-family`;
    const wId = `font-${role}-weight`;
    const fam = el("select", { id: famId }, families().map((f) => el("option", { value: f }, f)));
    fam.value = S.draft.fonts[role].family;
    const weight = el("select", { id: wId });
    const fillWeights = () => {
      const ws = [...new Set(S.draft.fonts.faces.filter((f) => f.family === fam.value && f.style === "normal").map((f) => f.weight))].sort((a, b) => a - b);
      weight.replaceChildren(...ws.map((w) => el("option", { value: String(w) }, String(w))));
      if (!ws.includes(S.draft.fonts[role].weight)) weight.prepend(el("option", { value: String(S.draft.fonts[role].weight) }, `${S.draft.fonts[role].weight} (no file)`));
      weight.value = String(S.draft.fonts[role].weight);
    };
    fillWeights();
    fam.addEventListener("change", () => {
      const ws = S.draft.fonts.faces.filter((f) => f.family === fam.value && f.style === "normal").map((f) => f.weight);
      const want = role === "heading" ? 700 : 400;
      const best = ws.sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0] ?? want;
      S.draft.fonts[role] = { family: fam.value, weight: best };
      fillWeights();
      edited(renderSurfaceSelects);
    });
    weight.addEventListener("change", () => {
      S.draft.fonts[role].weight = Number(weight.value);
      edited(renderSurfaceSelects);
    });
    return el("fieldset", {}, el("legend", {}, label), el("div", { class: "field" }, el("label", { for: famId }, "Font"), fam), el("div", { class: "field" }, el("label", { for: wId }, "Weight"), weight));
  };

  const faces = S.draft.fonts.faces ?? [];
  const facesTable = el(
    "table",
    { class: "faces stack-narrow" },
    el("caption", { class: "visually-hidden" }, "Font files the brand uses"),
    el("thead", {}, el("tr", {}, ["Font", "Weight", "Style", "File", "Action"].map((h) => el("th", { scope: "col" }, h)))),
    el(
      "tbody",
      {},
      faces.map((f, i) =>
        el(
          "tr",
          {},
          el("td", { "data-label": "Font" }, f.family),
          el("td", { "data-label": "Weight" }, String(f.weight)),
          el("td", { "data-label": "Style" }, f.style),
          el("td", { "data-label": "File" }, f.src.replace(/^fonts\//, ""), f.unicodeRange ? el("span", { class: "small" }, " (part of the character set)") : null),
          el("td", {}, el("button", { type: "button", class: "link-button", onclick: () => {
            if (faces.length <= 1) return announce("A brand needs at least one font.");
            S.draft.fonts.faces.splice(i, 1);
            keepFocus(renderFonts, "font-files-h");
            edited();
          } }, "Remove", el("span", { class: "visually-hidden" }, ` ${f.family} ${f.weight} ${f.src}`))),
        ),
      ),
    ),
  );
  const used = new Set(faces.map((f) => f.src));
  const unused = (S.files.fonts ?? []).filter((f) => !used.has(f.file) && !(f.usedBy ?? []).length);

  const upload = el("input", { type: "file", id: "font-upload", multiple: true, accept: ".woff2,.woff,.ttf,.otf", "aria-describedby": "font-upload-hint" });
  const useRoles = el("input", { type: "checkbox", id: "font-upload-roles" });
  const upStatus = el("div", { "aria-live": "polite" });
  const q = el("input", { type: "search", id: "font-search", "aria-describedby": "font-search-hint", autocomplete: "off" });
  const results = el("ul", { class: "font-results", "aria-live": "polite" });
  const rolesForOpen = el("input", { type: "checkbox", id: "open-font-roles", checked: true });

  body.replaceChildren(
    el("p", {}, "Fonts are stored with the brand, so videos never depend on the internet. Each weight needs its own file, or one variable font file."),
    el("div", { class: "surface-grid" }, roleControls("heading", "Headings"), roleControls("body", "Body text and captions")),
    el("h3", { id: "font-files-h", tabindex: "-1" }, "Font files in use"),
    facesTable,
    unused.length
      ? el("div", {}, el("p", {}, "Files not used by any font:"), el("ul", { class: "list" }, unused.map((f) => el("li", {}, f.file.replace(/^fonts\//, ""), " ", el("button", { type: "button", class: "link-button", onclick: () => deleteFile(f.file) }, "Delete file", el("span", { class: "visually-hidden" }, ` ${f.file}`))))))
      : null,
    el("h3", {}, "Upload font files"),
    field("font-upload", "Font files", upload, "WOFF2 is best. WOFF, TTF and OTF also work. Upload the regular and bold files at least. Only upload fonts the organisation is licensed to use in video."),
    el("label", { class: "check" }, useRoles, el("span", {}, "Use this font for headings and body text")),
    el("div", { class: "button-row" }, el("button", { type: "button", class: "button secondary", id: "font-upload-button", onclick: uploadFonts }, "Upload fonts")),
    upStatus,
    el("h3", {}, "Use an open-licence font"),
    field("font-search", "Search open fonts", q, "Google Fonts and other open-licence fonts, through Fontsource. The regular and bold weights are downloaded into the brand."),
    el("label", { class: "check" }, rolesForOpen, el("span", {}, "Use the font for headings and body text")),
    el("div", { class: "button-row" }, el("button", { type: "button", class: "button secondary", onclick: search }, "Search")),
    results,
  );
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      search();
    }
  });

  async function uploadFonts() {
    if (!upload.files.length) return upStatus.replaceChildren(el("p", { class: "error-text" }, "Error: Choose one or more font files first."));
    const fd = new FormData();
    for (const f of upload.files) fd.append("file", f, f.name);
    fd.append("useForRoles", useRoles.checked ? "yes" : "no");
    upStatus.replaceChildren(el("p", {}, "Uploading..."));
    try {
      const r = await api("POST", `/api/brands/${encodeURIComponent(S.id)}/files/font`, fd);
      mergeFonts(r.raw);
      S.files = r.files;
      renderFonts();
      const report = uploadReport(r.results);
      $("font-upload-button").closest(".button-row").after(report);
      focusReport(report);
      edited(renderSurfaceSelects);
    } catch (e) {
      upStatus.replaceChildren(el("p", { class: "error-text", role: "alert" }, `Error: ${e.message}`));
    }
  }

  async function search() {
    results.replaceChildren(el("li", {}, "Searching..."));
    try {
      const list = await api("GET", `/api/fonts?q=${encodeURIComponent(q.value)}`);
      if (!list.length) return results.replaceChildren(el("li", {}, "No open fonts match. Try another name, or upload the font files."));
      results.replaceChildren(
        ...list.map((f) =>
          el(
            "li",
            {},
            el("span", { class: "fam" }, f.family),
            el("span", { class: "small" }, `${f.category}, weights ${f.weights.join(", ")}, ${f.license}`),
            el("button", { type: "button", class: "button secondary small", onclick: () => useOpenFont(f.family, rolesForOpen.checked) }, `Use ${f.family}`),
          ),
        ),
      );
    } catch (e) {
      results.replaceChildren(el("li", { class: "error-text" }, `Error: ${e.message}`));
    }
  }
}

function mergeFonts(raw) {
  S.draft.fonts = clone(raw.fonts);
  if (raw.captions?.weight) S.draft.captions.weight = raw.captions.weight;
}

function uploadReport(results) {
  const items = results.flatMap((r) => (r.error ? [el("li", { class: "error-text" }, `${r.name}: ${r.error}`)] : [el("li", {}, `${r.name}: added.`), ...r.warnings.map((w) => el("li", {}, `${r.name}: ${w}`))]));
  return el("div", { class: "notice", role: "status" }, el("ul", { class: "list" }, items));
}

async function useOpenFont(family, roles) {
  announce(`Downloading ${family}...`);
  try {
    const r = await api("POST", `/api/brands/${encodeURIComponent(S.id)}/fonts/open`, { family, weights: [400, 700], roles });
    mergeFonts(r.raw);
    S.files = r.files;
    renderFonts();
    const done = el("div", { class: "success", role: "status" }, el("p", {}, `${family} has been added to the brand.`), r.warnings?.length ? el("ul", { class: "list" }, r.warnings.map((w) => el("li", {}, w))) : null);
    $("sec-fonts-body").prepend(done);
    edited(renderSurfaceSelects);
    $("sec-fonts-h").scrollIntoView({ block: "start" });
    focusReport(done);
  } catch (e) {
    const box = el("div", { class: "error-summary", role: "alert" }, el("p", {}, `Error: ${e.message}`));
    $("sec-fonts-body").prepend(box);
    focusReport(box);
  }
}

async function deleteFile(rel) {
  const ok = await confirmDialog("Delete this file?", `${rel} will be removed from the brand folder.`, "Delete file");
  if (!ok) return;
  try {
    const r = await api("POST", `/api/brands/${encodeURIComponent(S.id)}/files-delete`, { path: rel });
    S.files = r.files;
    S.icons = r.icons ?? S.icons;
    // Faces that pointed at the file are gone from the saved brand; drop them from the draft too.
    S.draft.fonts.faces = S.draft.fonts.faces.filter((f) => f.src !== rel);
    renderFonts();
    renderLogo();
    renderIcons();
    edited();
    // The Delete button is gone: go back to the top of its section.
    const sec = /^fonts\//.test(rel) ? "sec-fonts-h" : /^logo\//.test(rel) ? "sec-logo-h" : "sec-icons-h";
    focusReport($(sec));
    announce("The file has been deleted.");
  } catch (e) {
    announce(e.message);
    await confirmDialog("The file could not be deleted", e.message, "OK");
  }
}

// ---------- section: type ----------

function renderType() {
  const body = $("sec-type-body");
  const num = (path, label, min, max, step = 1, hint) => {
    const n = bound("input", path, { type: "number", min: String(min), max: String(max), step: String(step), inputmode: "decimal" });
    return field(n.id, label, n, hint ?? `From ${min} to ${max}.`);
  };
  body.replaceChildren(
    el("p", {}, "Sizes are in pixels for a 1920 by 1080 video. Portrait videos use them 20% larger. Body text, labels and captions can never be smaller than 42 pixels, so they stay easy to read."),
    el(
      "div",
      { class: "surface-grid" },
      el("fieldset", {}, el("legend", {}, "Text sizes"), num("typeScale.display", "Title size", 60, 200), num("typeScale.heading", "Heading size", 48, 160), num("typeScale.body", "Body text size", 42, 110), num("typeScale.label", "Label size", 42, 80), num("typeScale.caption", "Caption size", 42, 80)),
      el("fieldset", {}, el("legend", {}, "Line height"), num("lineHeight.display", "Titles", 0.95, 1.6, 0.01), num("lineHeight.heading", "Headings", 1, 1.6, 0.01), num("lineHeight.body", "Body text", 1.1, 1.8, 0.01)),
      el("fieldset", {}, el("legend", {}, "Spacing"), num("letterSpacing.display", "Title letter spacing (em)", -0.05, 0.1, 0.005), num("letterSpacing.heading", "Heading letter spacing (em)", -0.05, 0.1, 0.005), num("spacing.unit", "Spacing unit (px)", 4, 16), num("radius", "Corner radius (px)", 0, 48)),
    ),
  );
}

// ---------- section: logo ----------

function renderLogo() {
  const body = $("sec-logo-body");
  if (!body) return;
  const logos = (S.files.logos ?? []).map((l) => l.file);
  const box = (key, label, surface) => {
    const id = `logo-${key}`;
    const sel = bound("select", `logo.${key}`, { id }, { options: logos.map((l) => ({ value: l, label: l.replace(/^logo\//, "") })), after: () => keepFocus(renderLogo) });
    const bg = S.draft.colours?.[S.draft.surfaces?.[surface]?.background]?.value ?? (surface === "dark" ? "#0B0C0C" : "#FFFFFF");
    const src = S.draft.logo[key];
    return el(
      "div",
      { class: "logo-box" },
      el("h3", {}, label),
      el("p", { class: "hint" }, key === "onDark" ? "Used in videos, on the title and end card." : "Not used in videos yet."),
      el("div", { class: "stage", style: `background:${bg}` }, src ? el("img", { src: `/brand-files/${encodeURIComponent(S.id)}/${src}?t=${Date.now()}`, alt: `${S.draft.logo.alt} logo on the ${surface} background` }) : null),
      el("div", { id: `logo-${key}-warn` }),
      el("label", { for: id }, "Logo file"),
      sel,
    );
  };
  const alt = bound("input", "logo.alt", { type: "text", maxlength: "120" });
  const minH = bound("input", "logo.minHeight", { type: "number", min: "24", max: "240" });
  const upload = el("input", { type: "file", id: "logo-upload", accept: ".svg,.png,image/svg+xml,image/png", "aria-describedby": "logo-upload-hint" });
  const radios = ["both", "onLight", "onDark"].map((v, i) =>
    el("label", { class: "check" }, el("input", { type: "radio", name: "logo-for", value: v, checked: i === 0 }), el("span", {}, { onLight: "Light backgrounds only", onDark: "Dark backgrounds only", both: "Light and dark backgrounds" }[v])),
  );
  const status = el("div", { "aria-live": "polite" });
  const unused = logos.filter((l) => l !== S.draft.logo.onLight && l !== S.draft.logo.onDark);
  body.replaceChildren(
    el("p", {}, "Use an SVG logo if you can. It stays sharp at any size. A PNG works but can look soft."),
    el("div", { class: "logo-pair" }, box("onLight", "On light backgrounds", "light"), box("onDark", "On dark backgrounds", "dark")),
    field("f-logo-alt", "Logo description", alt, "What the logo says, for people who cannot see it. Usually the organisation's name."),
    field("f-logo-minHeight", "Smallest logo height (px)", minH, "The smallest size the guidelines allow, in a 1080p video. From 24 to 240."),
    el("h3", {}, "Upload a logo"),
    field("logo-upload", "Logo file", upload, "SVG or PNG, up to 25 MB."),
    el("fieldset", { "aria-describedby": "logo-for-hint" }, el("legend", {}, "Use it on"), el("p", { class: "hint", id: "logo-for-hint" }, "Videos show the logo on dark backgrounds. If the logo cannot be seen on a dark background, it is used on light backgrounds only and you can make a white version."), el("div", { class: "inline-checks" }, radios)),
    el(
      "div",
      { class: "button-row" },
      el("button", { type: "button", class: "button secondary", id: "logo-upload-button", onclick: uploadLogo }, "Upload logo"),
      /\.svg$/i.test(S.draft.logo.onLight) ? el("button", { type: "button", class: "button secondary", id: "reverse-logo-button", onclick: reverse }, "Make a white version for dark backgrounds") : null,
    ),
    status,
    unused.length ? el("div", {}, el("h3", {}, "Logo files not in use"), el("ul", { class: "list" }, unused.map((l) => el("li", {}, l.replace(/^logo\//, ""), " ", el("button", { type: "button", class: "link-button", onclick: () => deleteFile(l) }, "Delete file", el("span", { class: "visually-hidden" }, ` ${l}`)))))) : null,
  );
  renderLogoWarnings();
  async function uploadLogo() {
    if (!upload.files.length) return status.replaceChildren(el("p", { class: "error-text" }, "Error: Choose a logo file first."));
    const fd = new FormData();
    fd.append("file", upload.files[0], upload.files[0].name);
    fd.append("logoFor", body.querySelector('input[name="logo-for"]:checked').value);
    try {
      const r = await api("POST", `/api/brands/${encodeURIComponent(S.id)}/files/logo`, fd);
      S.draft.logo.onLight = r.raw.logo.onLight;
      S.draft.logo.onDark = r.raw.logo.onDark;
      S.files = r.files;
      renderLogo();
      const report = uploadReport(r.results);
      $("logo-upload-button").closest(".button-row").after(report);
      focusReport(report);
      edited();
    } catch (e) {
      status.replaceChildren(el("p", { class: "error-text", role: "alert" }, `Error: ${e.message}`));
    }
  }
  async function reverse() {
    const ok = await confirmDialog(
      "Make a white version of the logo?",
      ["This turns every colour in the light logo white, for dark backgrounds.", "Only do this if the brand guidelines allow a one-colour white logo. If the organisation has an official reversed logo, upload that instead."],
      "Make white version",
    );
    if (!ok) return;
    try {
      const r = await api("POST", `/api/brands/${encodeURIComponent(S.id)}/reverse-logo`, { path: S.draft.logo.onLight });
      S.draft.logo.onDark = r.raw.logo.onDark;
      S.files = r.files;
      renderLogo();
      const report = el("div", { class: r.warnings?.length ? "notice warn" : "success", role: "status" }, el("p", {}, "A white version of the logo has been made. It is used on dark backgrounds."), r.warnings?.length ? el("ul", { class: "list" }, r.warnings.map((w) => el("li", {}, w))) : null);
      $("logo-upload-button").closest(".button-row").after(report);
      focusReport(report);
      edited();
    } catch (e) {
      status.replaceChildren(el("p", { class: "error-text", role: "alert" }, `Error: ${e.message}`));
    }
  }
}

// ---------- section: icons and graphics ----------

function renderIcons() {
  const body = $("sec-icons-body");
  if (!body) return;
  const weight = bound("select", "icons.weight", { id: "icon-weight" }, { options: ICON_WEIGHTS.map((w) => ({ value: w, label: w })) });
  const icons = S.files.icons ?? [];
  const graphics = S.files.graphics ?? [];
  const up = el("input", { type: "file", id: "icon-upload", multiple: true, accept: ".svg,image/svg+xml", "aria-describedby": "icon-upload-hint" });
  const nameIn = el("input", { type: "text", id: "icon-name", maxlength: "60", "aria-describedby": "icon-name-hint" });
  const gUp = el("input", { type: "file", id: "graphic-upload", multiple: true, accept: ".svg,.png,.jpg,.jpeg,.webp", "aria-describedby": "graphic-upload-hint" });
  const status = el("div", { "aria-live": "polite" });
  body.replaceChildren(
    field("icon-weight", "Default icon weight", weight, `Library icons come in six weights. ${S.icons.library ? `${S.icons.library} library icons are available.` : ""}`),
    el("h3", {}, "The brand's own icons"),
    icons.length
      ? el(
          "ul",
          { class: "icon-grid" },
          icons.map((i) =>
            el(
              "li",
              {},
              el("img", { src: `/brand-files/${encodeURIComponent(S.id)}/${i.file}`, alt: "" }),
              el("span", { class: "name" }, i.name),
              i.weight ? el("p", { class: "small" }, `${i.weight} weight`) : null,
              i.overridesLibrary ? el("p", { class: "small" }, "Replaces the library icon") : null,
              el("button", { type: "button", class: "link-button", onclick: () => deleteFile(i.file) }, "Delete", el("span", { class: "visually-hidden" }, ` icon ${i.name}`)),
            ),
          ),
        )
      : el("p", {}, "None yet. Videos use the library icons."),
    el("h3", {}, "Upload icons"),
    field("icon-upload", "Icon files", up, "SVG only. The file name becomes the icon name, so bin.svg is the icon called bin. An icon with the same name as a library icon replaces it in this brand's videos. Icons drawn with currentColor take the brand colours."),
    field("icon-name", "Icon name (optional, for one file)", nameIn, "Lower-case words joined by hyphens, such as brown-bin."),
    el("div", { class: "button-row" }, el("button", { type: "button", class: "button secondary", id: "icon-upload-button", onclick: () => uploadKind("icon", up, { iconName: nameIn.value.trim() }) }, "Upload icons")),
    el("h3", {}, "Graphics"),
    graphics.length ? el("ul", { class: "list" }, graphics.map((g) => el("li", {}, g.file, " ", el("button", { type: "button", class: "link-button", onclick: () => deleteFile(g.file) }, "Delete", el("span", { class: "visually-hidden" }, ` ${g.file}`))))) : el("p", {}, "None yet."),
    field("graphic-upload", "Graphic files", gUp, "SVG, PNG, JPEG or WebP. Scenes that use graphics can show them."),
    el("div", { class: "button-row" }, el("button", { type: "button", class: "button secondary", id: "graphic-upload-button", onclick: () => uploadKind("graphic", gUp, {}) }, "Upload graphics")),
    status,
  );
  async function uploadKind(kind, input, extra) {
    if (!input.files.length) return status.replaceChildren(el("p", { class: "error-text" }, "Error: Choose a file first."));
    const fd = new FormData();
    for (const f of input.files) fd.append("file", f, f.name);
    if (extra.iconName && input.files.length === 1) fd.append("iconName", extra.iconName);
    try {
      const r = await api("POST", `/api/brands/${encodeURIComponent(S.id)}/files/${kind}`, fd);
      S.files = r.files;
      S.icons = r.icons ?? S.icons;
      renderIcons();
      const report = uploadReport(r.results);
      $(`${kind}-upload-button`).closest(".button-row").after(report);
      focusReport(report);
      edited();
    } catch (e) {
      status.replaceChildren(el("p", { class: "error-text", role: "alert" }, `Error: ${e.message}`));
    }
  }
}

// ---------- section: voice ----------

function renderVoice() {
  const body = $("sec-voice-body");
  if (!body) return;
  const voices = S.detail.voices ?? S.meta.voices;
  const sel = bound("select", "voice.id", { id: "voice-id" }, { options: voices.map((v) => ({ value: v.id, label: v.label })), after: () => setLang() });
  const speed = bound("input", "voice.speed", { type: "range", min: "0.8", max: "1.2", step: "0.05", id: "voice-speed" }, { fromText: Number, after: () => (out.textContent = `${Number(S.draft.voice.speed).toFixed(2)} times normal speed`) });
  const out = el("output", { for: "voice-speed" }, `${Number(S.draft.voice.speed ?? 1).toFixed(2)} times normal speed`);
  const player = el("div", { "aria-live": "polite" });
  function setLang() {
    S.draft.voice.lang = S.draft.voice.id.startsWith("b") ? "en-gb" : "en-us";
  }
  body.replaceChildren(
    field("voice-id", "Voice", sel, "British voices start the list. A video can still choose another voice."),
    field("voice-speed", "Speed", speed, "From 0.8 (slower) to 1.2 (faster). 1 is normal.", out),
    el("div", { class: "button-row" }, el("button", { type: "button", class: "button secondary", onclick: play }, "Play a sample")),
    player,
  );
  async function play() {
    player.replaceChildren(el("p", {}, "Making the sample. The first one can take a few seconds."));
    try {
      const r = await api("POST", "/api/voice-sample", { voice: S.draft.voice.id, speed: S.draft.voice.speed });
      const audio = el("audio", { controls: true, src: r.url, "aria-label": "Voice sample" });
      player.replaceChildren(audio);
      audio.play().catch(() => {});
    } catch (e) {
      player.replaceChildren(el("p", { class: "error-text" }, `Error: ${e.message}`));
    }
  }
}

// ---------- section: writing ----------

function renderWriting() {
  const body = $("sec-writing-body");
  if (!body) return;
  const lines = { toText: (a) => (a ?? []).join("\n"), fromText: (t) => t.split("\n").map((x) => x.trim()).filter(Boolean) };
  const tone = bound("textarea", "toneOfVoice", { rows: "5" });
  const guide = bound("textarea", "guidelines", { rows: "10" });
  const dos = bound("textarea", "rules.do", { rows: "5" }, lines);
  const donts = bound("textarea", "rules.dont", { rows: "5" }, lines);
  body.replaceChildren(
    el("p", {}, "The script writer reads all of this for every video made with this brand."),
    field(tone.id, "Tone of voice", tone, "How the videos should sound. For example: calm, clear and helpful; short sentences; no jargon.", counterFor(tone, 4000)),
    field(guide.id, "Guidelines for the script writer", guide, "Anything else the writing should follow: how to write dates and numbers, words to use or avoid, what every video must include.", counterFor(guide, 20000)),
    field(dos.id, "Do (one rule per line)", dos, "For example: End every video with one clear action."),
    field(donts.id, "Do not (one rule per line)", donts, "For example: Do not use exclamation marks."),
  );
}

// ---------- save ----------

let saving = false;
async function save() {
  const btn = $("save-button");
  // aria-disabled, not disabled: a disabled button drops keyboard focus to the page.
  if (saving) return;
  saving = true;
  btn.setAttribute("aria-disabled", "true");
  updateSaveStatus("Saving...");
  try {
    const r = await api("PUT", `/api/brands/${encodeURIComponent(S.id)}`, { brand: S.draft });
    S.check = r.check;
    S.files = r.files;
    if (r.saved) {
      S.draft = clone(r.raw);
      S.saved = JSON.stringify(S.draft);
      $("top-errors").replaceChildren();
      updateSaveStatus(r.check.ok ? "Saved. The brand is ready to use." : "Saved, but the problems under Checks stop it being used for videos.");
      announce(r.check.ok ? "Saved. The brand is ready to use." : "Saved. Some problems still stop this brand being used.");
    } else {
      updateSaveStatus("Not saved. Fix the problems listed above.");
      showErrors($("top-errors"), "The brand could not be saved", r.check.issues.filter((i) => i.level === "error").map((i) => `${sectionFor(i.field).label}: ${i.message}`));
    }
    renderChecks();
    renderContrast();
  } catch (e) {
    updateSaveStatus("Not saved.");
    showErrors($("top-errors"), "The brand could not be saved", [e.message]);
  } finally {
    saving = false;
    btn.removeAttribute("aria-disabled");
  }
}

init();
