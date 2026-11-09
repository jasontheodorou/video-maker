// Make a video page: the brief form, live progress, results, the script editor and past videos.
import { api, el, formatDate, formatBytes, showErrors, errorLink, announce, FORMAT_LABELS } from "/static/common.js";

const $ = (id) => document.getElementById(id);
const state = {
  meta: null,
  brands: [],
  jobId: null,
  view: null,
  timer: null,
  sigs: {},
  editorFor: null,
  editorDirty: false,
};

// ---------- start ----------

/** Load the brand list, trying again a few times: a server that has just started can be slow to answer. */
async function loadBrands() {
  let last = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const brands = await api("GET", "/api/brands");
      if (Array.isArray(brands) && brands.length) return brands;
      last = new Error("No brands were found. Add one on the Brands page.");
    } catch (e) {
      last = e;
    }
    if (attempt < 4) {
      $("brand-status").textContent = "Still loading brands. Trying again.";
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw last;
}

async function init() {
  const sel = $("brand");
  sel.replaceChildren(el("option", { value: "" }, "Loading brands..."));
  $("brand-status").textContent = "Loading brands.";
  try {
    const [meta, brands] = await Promise.all([api("GET", "/api/meta"), loadBrands()]);
    state.meta = meta;
    state.brands = brands;
  } catch (e) {
    sel.replaceChildren();
    $("brand-status").textContent = "";
    showErrors($("form-errors"), "There is a problem", [e.message]);
    return;
  }
  fillForm();
  $("make-form").addEventListener("submit", onSubmit);
  briefCounter();
  $("brand").addEventListener("change", onBrandChange);
  $("media").addEventListener("change", onMediaChange);
  await loadHistory();
  const id = new URLSearchParams(location.search).get("job");
  if (id) openJob(id, false);
}

function fillForm() {
  const sel = $("brand");
  sel.replaceChildren();
  let remembered = null;
  try {
    remembered = localStorage.getItem("va-brand");
  } catch {
    /* no storage */
  }
  for (const b of state.brands) {
    const label = `${b.name}${b.fictional ? " (sample)" : ""}${b.ok ? "" : " - has problems"}`;
    sel.append(el("option", { value: b.id }, label));
  }
  const want = state.brands.find((b) => b.id === remembered) ? remembered : state.brands.find((b) => b.id === "demo") ? "demo" : state.brands[0]?.id;
  if (want) sel.value = want;
  const fm = $("formats");
  fm.replaceChildren(
    ...state.meta.formats.map((f) =>
      el("label", { class: "check" }, el("input", { type: "checkbox", name: "formats", id: `format-${f.id}`, value: f.id, checked: true }), el("span", {}, `${f.label} (${f.width} x ${f.height})`)),
    ),
  );
  onBrandChange();
}

function onBrandChange() {
  const b = state.brands.find((x) => x.id === $("brand").value);
  const voiceSel = $("voice");
  const current = voiceSel.value;
  voiceSel.replaceChildren();
  const brandVoice = state.meta.voices.find((v) => v.id === b?.voice);
  voiceSel.append(el("option", { value: "" }, `The brand's voice${brandVoice ? `: ${brandVoice.label}` : ""}`));
  for (const v of state.meta.voices) voiceSel.append(el("option", { value: v.id }, v.label));
  voiceSel.value = [...voiceSel.options].some((o) => o.value === current) ? current : "";
  const status = $("brand-status");
  if (!b) {
    status.textContent = "";
    return;
  }
  if (b.ok) {
    status.replaceChildren(el("span", { class: "ok-text" }, "Ready to use."), b.provisional?.length ? ` Not yet checked against the brand guidelines: ${b.provisional.join(", ")}.` : "");
  } else {
    status.replaceChildren(el("span", { class: "error-text" }, "This brand has problems that stop videos being made. "), el("a", { href: `/brands?brand=${encodeURIComponent(b.id)}` }, "Fix the brand"));
  }
  try {
    localStorage.setItem("va-brand", b.id);
  } catch {
    /* no storage */
  }
}

function onMediaChange() {
  const list = $("media-list");
  list.replaceChildren();
  const files = [...$("media").files];
  if (!files.length) return;
  if (files.length > 12) {
    list.append(el("p", { class: "error-text" }, "Choose 12 files or fewer."));
    return;
  }
  list.append(
    el("p", { class: "small" }, `${files.length} file${files.length === 1 ? "" : "s"} chosen.`),
    ...files.map((f, i) =>
      el(
        "div",
        { class: "field" },
        el("label", { for: `media-desc-${i}` }, `What does ${f.name} show? (optional)`),
        el("p", { class: "hint small", id: `media-desc-hint-${i}` }, `${formatBytes(f.size)}. For example: a resident putting a brown bin out.`),
        el("input", { type: "text", id: `media-desc-${i}`, "aria-describedby": `media-desc-hint-${i}`, maxlength: "200" }),
      ),
    ),
  );
}

// ---------- submit ----------

const BRIEF_MAX = 20000;

/** The brief's character count: shown as you type, announced once you pause, red when over the limit. */
function briefCounter() {
  const box = $("brief");
  const out = $("brief-count");
  const live = el("span", { class: "visually-hidden", "aria-live": "polite" });
  out.after(live);
  let timer = null;
  const text = () => {
    const n = box.value.length;
    if (n === 0) return `You can enter up to ${BRIEF_MAX.toLocaleString("en-GB")} characters`;
    return n > BRIEF_MAX ? `You have ${(n - BRIEF_MAX).toLocaleString("en-GB")} characters too many` : `You have ${(BRIEF_MAX - n).toLocaleString("en-GB")} characters remaining`;
  };
  box.addEventListener("input", () => {
    out.textContent = text();
    out.classList.toggle("over", box.value.length > BRIEF_MAX);
    clearTimeout(timer);
    timer = setTimeout(() => (live.textContent = box.value.length > BRIEF_MAX * 0.9 ? text() : ""), 1000);
  });
}

function fieldError(id, msg) {
  const p = $(`${id}-error`);
  if (!p) return;
  p.hidden = !msg;
  p.textContent = msg ? `Error: ${msg}` : "";
}

async function onSubmit(e) {
  e.preventDefault();
  const brief = $("brief").value.trim();
  const formats = [...document.querySelectorAll('input[name="formats"]:checked')].map((i) => i.value);
  const brand = state.brands.find((b) => b.id === $("brand").value);
  const errors = [];
  fieldError("brief", "");
  fieldError("formats", "");
  fieldError("brand", "");
  if (brief.length < 10) {
    errors.push({ id: "brief", text: "Describe the video in at least one sentence" });
    fieldError("brief", "Describe the video in at least one sentence");
  } else if (brief.length > BRIEF_MAX) {
    const msg = `The brief must be ${BRIEF_MAX.toLocaleString("en-GB")} characters or fewer. Remove ${(brief.length - BRIEF_MAX).toLocaleString("en-GB")} characters.`;
    errors.push({ id: "brief", text: msg });
    fieldError("brief", msg);
  }
  if (!formats.length) {
    errors.push({ id: "formats", text: "Choose at least one format" });
    fieldError("formats", "Choose at least one format");
  }
  if (brand && !brand.ok) {
    errors.push({ id: "brand", text: "Choose a brand that is ready to use, or fix this brand first" });
    fieldError("brand", "This brand has problems that stop videos being made");
  }
  if (errors.length) {
    const box = $("form-errors");
    box.hidden = false;
    box.replaceChildren(
      el(
        "div",
        { class: "error-summary", role: "alert", tabindex: "-1" },
        el("h2", {}, "There is a problem"),
        el("ul", {}, errors.map((x) => el("li", {}, errorLink(x.id === "formats" ? ($("formats").querySelector("input")?.id ?? "formats") : x.id, x.text)))),
      ),
    );
    box.firstChild.focus();
    return;
  }
  $("form-errors").hidden = true;
  const fd = new FormData();
  fd.append("brief", brief);
  fd.append("brand", $("brand").value);
  fd.append("voice", $("voice").value);
  for (const f of formats) fd.append("formats", f);
  [...$("media").files].forEach((f, i) => {
    fd.append("mediaDescription", ($(`media-desc-${i}`)?.value ?? "").trim());
    fd.append("media", f, f.name);
  });
  const btn = $("make-button");
  btn.disabled = true;
  btn.textContent = "Sending...";
  try {
    const view = await api("POST", "/api/jobs", fd);
    $("media").value = "";
    $("media-list").replaceChildren();
    openJob(view.job.id, true, view);
    loadHistory();
  } catch (err) {
    showErrors($("form-errors"), "There is a problem", [err.message]);
  } finally {
    btn.disabled = false;
    btn.textContent = "Make video";
  }
}

// ---------- one job ----------

/** Move focus to the job and scroll it to the top of the screen, so the progress is in view. */
function focusJob() {
  const t = $("job-title");
  if (!t) return;
  t.scrollIntoView({ block: "start" });
  t.focus({ preventScroll: true });
}

function openJob(id, focus, view) {
  state.jobId = id;
  state.sigs = {};
  state.editorFor = null;
  state.editorDirty = false;
  const url = new URL(location.href);
  url.searchParams.set("job", id);
  history.replaceState(null, "", url);
  buildJobSkeleton();
  if (view) render(view);
  poll(focus);
}

function buildJobSkeleton() {
  const s = $("job");
  s.hidden = false;
  s.replaceChildren(
    el("hr"),
    buildHead(),
    buildProgress(),
    el("div", { id: "job-error" }),
    el("div", { id: "job-notes" }),
    el("div", { id: "job-decision" }),
    el("div", { id: "job-videos" }),
    el("div", { id: "job-sheet" }),
    el("div", { id: "job-editor" }),
  );
}

async function poll(focus) {
  clearTimeout(state.timer);
  const id = state.jobId;
  try {
    const view = await api("GET", `/api/jobs/${encodeURIComponent(id)}`);
    if (id !== state.jobId) return;
    const before = state.view?.job?.state;
    render(view);
    if (focus) focusJob();
    const st = view.job.state;
    if (before && before !== st) {
      loadHistory();
      if (st === "done") announce("Your video is ready.");
      if (st === "error") announce("There was a problem making the video.");
    }
    if (st === "queued" || st === "running") state.timer = setTimeout(() => poll(false), 1000);
  } catch (e) {
    $("job-error").replaceChildren(el("div", { class: "error-summary", role: "alert" }, el("h2", {}, "There is a problem"), el("p", {}, e.message)));
    state.timer = setTimeout(() => poll(false), 3000);
  }
}

const STATE_TEXT = { queued: "Waiting", running: "In progress", done: "Ready", error: "Problem", stopped: "Stopped" };
const STATE_CLASS = { queued: "busy", running: "busy", done: "good", error: "bad", stopped: "" };

function changed(key, value) {
  const sig = JSON.stringify(value);
  if (state.sigs[key] === sig) return false;
  state.sigs[key] = sig;
  return true;
}

function render(view) {
  state.view = view;
  const j = view.job;
  const busy = j.state === "queued" || j.state === "running";
  const brand = state.brands.find((b) => b.id === j.brand);

  // Updated in place, never rebuilt: the heading often has keyboard focus, and rebuilding it would drop
  // focus to the page body when the script writer changes the title.
  const h = state.head;
  if (h) {
    setText(h.title, j.title);
    const tagClass = `tag ${STATE_CLASS[j.state]}`;
    if (h.tag.className !== tagClass) h.tag.className = tagClass;
    setText(h.tag, STATE_TEXT[j.state] ?? j.state);
    setText(h.info, `  Brand: ${brand?.name ?? j.brand}. Started ${formatDate(j.createdAt)}.`);
    setText(h.brief, j.brief || "No brief was saved.");
  }
  updateHistoryRow(j);

  renderProgress(view);

  if (changed("error", [j.state, j.error])) {
    const box = $("job-error");
    box.replaceChildren();
    if (j.state === "error" && j.error) {
      box.append(
        el(
          "div",
          { class: "error-summary", role: "alert" },
          el("h2", { tabindex: "-1" }, "The video could not be made"),
          el("p", { style: "white-space:pre-wrap" }, j.error.message),
          j.error.problems?.length ? el("ul", { class: "list" }, j.error.problems.slice(0, 12).map((p) => el("li", {}, p))) : null,
          el(
            "div",
            { class: "button-row" },
            view.spec ? el("a", { class: "button secondary", href: "#script-editor" }, "Edit the script") : null,
            !view.spec && j.brief
              ? el("a", { class: "button secondary", href: "#brief", onclick: (e) => {
                  e.preventDefault();
                  $("brief").value = j.brief;
                  $("brief").dispatchEvent(new Event("input"));
                  $("brief").scrollIntoView({ block: "center" });
                  $("brief").focus({ preventScroll: true });
                } }, "Change the brief")
              : null,
            (j.fromApp || view.spec) && j.error.retryable !== false ? el("button", { type: "button", class: "button", onclick: retryJob }, "Try again") : null,
          ),
        ),
      );
    }
  }

  if (changed("notes", j.notes)) {
    $("job-notes").replaceChildren(
      ...(j.notes?.length ? [el("div", { class: "notice warn" }, el("h3", {}, "Things to check"), el("ul", { class: "list" }, j.notes.map((n) => el("li", {}, n))))] : []),
    );
  }

  if (changed("decision", [view.decision, view.duration])) renderDecision(view);
  if (changed("videos", [view.outputs, view.srt])) renderVideos(view);
  if (changed("sheet", view.sheet)) renderSheet(view);
  if (view.spec && !busy && (state.editorFor !== j.id || (!state.editorDirty && changed("spec", view.spec)))) renderEditor(view);
  if (busy && state.editorFor === j.id && !state.editorDirty) {
    $("job-editor").replaceChildren();
    state.editorFor = null;
  }
}

function renderDecision(view) {
  const d = view.decision;
  const box = $("job-decision");
  box.replaceChildren();
  if (!d) return;
  const size = { short: "Short", medium: "Medium", long: "Long" }[d.size] ?? d.size;
  box.append(
    el("h3", {}, "Length"),
    el(
      "p",
      {},
      el("strong", {}, `${size} video, ${d.targetSeconds.min} to ${d.targetSeconds.max} seconds.`),
      view.duration ? ` This one is ${view.duration.toFixed(1)} seconds long.` : "",
      ` The script has ${d.wordCount} spoken words (the most for this length is ${d.wordBudget}).`,
    ),
    el("p", {}, "Why this length:"),
    el("ul", { class: "list" }, d.reasons.map((r) => el("li", {}, r))),
    d.warnings?.length ? el("details", {}, el("summary", {}, `${d.warnings.length} note${d.warnings.length === 1 ? "" : "s"} about the story`), el("ul", { class: "list" }, d.warnings.map((w) => el("li", {}, w)))) : null,
  );
}

function renderVideos(view) {
  const box = $("job-videos");
  box.replaceChildren();
  if (!view.outputs.length) return;
  const order = ["16x9", "9x16", "1x1"];
  const outs = [...view.outputs].sort((a, b) => order.indexOf(a.format) - order.indexOf(b.format));
  const dims = { "16x9": [1920, 1080], "9x16": [1080, 1920], "1x1": [1080, 1080] };
  box.append(
    el("h3", { id: "videos-title" }, "Watch and download"),
    el(
      "div",
      { class: "videos" },
      outs.map((o) =>
        el(
          "figure",
          { class: "video-card" },
          el("video", { controls: true, preload: "metadata", playsinline: true, poster: o.poster ?? null, src: o.url, width: dims[o.format][0], height: dims[o.format][1], "data-format": o.format, "aria-label": `${FORMAT_LABELS[o.format]} video` }),
          el("figcaption", {}, el("strong", {}, FORMAT_LABELS[o.format]), el("br"), el("a", { href: o.download, download: "" }, `Download MP4 (${formatBytes(o.bytes)})`)),
        ),
      ),
    ),
    view.srt ? el("p", {}, el("a", { href: view.srt, download: "" }, "Download subtitles (SRT file)"), " The captions are also burned into each video.") : null,
  );
}

function renderSheet(view) {
  const box = $("job-sheet");
  box.replaceChildren();
  if (!view.sheet) return;
  box.append(
    el("h3", {}, "Contact sheet"),
    el("p", {}, "One still of each scene in each format, for a quick check before or after rendering."),
    el("p", { class: "sheet" }, el("a", { href: view.sheet, target: "_blank", rel: "noopener" }, el("img", { src: view.sheet, alt: "Contact sheet: one still of each scene in each format. Opens full size in a new tab." }))),
  );
}

function buildHead() {
  const h = {};
  h.title = el("h2", { id: "job-title", tabindex: "-1" });
  h.tag = el("span", { class: "tag" });
  h.info = el("span");
  h.brief = el("p", { style: "white-space:pre-wrap" });
  h.box = el("div", { id: "job-head" }, h.title, el("p", {}, h.tag, h.info), el("details", {}, el("summary", {}, "Show the brief"), h.brief));
  state.head = h;
  return h.box;
}

// ---------- progress ----------
// Built once per job and then updated in place, so keyboard focus (for example on Stop) is never lost
// and screen readers hear each new step once, not a rebuilt block every second.

function buildProgress() {
  const p = {};
  p.heading = el("h3", {}, "Progress");
  p.list = el("ol", { class: "steps" });
  p.label = el("p", { class: "progress-text", id: "progress-label" });
  p.fill = el("span");
  p.bar = el("div", { class: "bar", role: "progressbar", "aria-labelledby": "progress-label", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" }, p.fill);
  p.message = el("p", { class: "progress-message" });
  // Announces new steps and the end of the job only.
  p.live = el("p", { class: "visually-hidden", "aria-live": "polite" });
  p.stop = el("button", { type: "button", class: "button secondary", onclick: () => p.stop.getAttribute("aria-disabled") !== "true" && askStop() }, "Stop");
  p.confirm = el(
    "div",
    { class: "notice warn", hidden: true, role: "group", "aria-labelledby": "stop-question" },
    el("p", { id: "stop-question" }, el("strong", {}, "Stop making this video?"), " The work so far will be lost. You can try again later."),
    el(
      "div",
      { class: "button-row" },
      (p.confirmYes = el("button", { type: "button", class: "button warning", onclick: confirmStop }, "Yes, stop it")),
      el("button", { type: "button", class: "button secondary", onclick: cancelStop }, "No, carry on"),
    ),
  );
  p.retry = el("button", { type: "button", class: "button", onclick: retryJob }, "Try again");
  p.stopRow = el("div", { class: "button-row" }, p.stop);
  p.retryRow = el("div", { class: "button-row" }, p.retry);
  p.lastStage = null;
  p.box = el("div", { id: "job-progress" }, p.heading, p.list, p.label, p.bar, p.message, p.live, p.stopRow, p.confirm, p.retryRow);
  state.progress = p;
  return p.box;
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

/** A running step with no change for this long gets a "taking longer than usual" note. */
const SLOW_STEP_MS = 60000;

function renderProgress(view) {
  const p = state.progress;
  if (!p) return;
  const j = view.job;
  const busy = j.state === "queued" || j.state === "running";
  const stopping = busy && j.stopping;
  setText(p.heading, busy ? "Progress" : "Steps");
  // Steps: one list item per stage, made once and then updated.
  if (p.list.children.length !== view.stages.length) {
    p.list.replaceChildren(
      ...view.stages.map((s, i) => el("li", {}, el("span", { class: "mark", "aria-hidden": "true" }, String(i + 1)), el("span", {}, s.label), el("span", { class: "state" }, "Waiting"))),
    );
  }
  view.stages.forEach((s, i) => {
    const li = p.list.children[i];
    const done = j.stagesDone.includes(s.id);
    const active = busy && j.stage === s.id;
    const failed = j.state === "error" && j.error?.stage === s.id;
    const cls = failed ? "failed" : active ? "active" : done ? "done" : "";
    if (li.className !== cls) li.className = cls;
    setText(li.children[0], done && !failed ? "✓" : failed ? "!" : String(i + 1));
    setText(li.children[2], failed ? "Problem" : active ? (stopping ? "Stopping" : "In progress") : done ? "Done" : "Waiting");
  });
  const pct = Math.round((j.progress ?? 0) * 100);
  const showBar = busy || j.state === "done";
  p.label.hidden = !showBar;
  p.bar.hidden = !showBar;
  setText(p.label, `${pct}% complete`);
  if (p.bar.getAttribute("aria-valuenow") !== String(pct)) p.bar.setAttribute("aria-valuenow", String(pct));
  p.fill.style.width = `${pct}%`;
  let queueText = j.state === "queued" ? (view.queuePosition > 0 ? `Waiting for ${view.queuePosition} other video${view.queuePosition === 1 ? "" : "s"} to finish.` : "Starting...") : j.message || "";
  // A running step that has not moved for a while: say so, so nobody thinks the page has stopped working.
  const moveKey = `${j.state}:${j.stage}:${pct}:${j.message}`;
  if (p.moveKey !== moveKey) {
    p.moveKey = moveKey;
    p.movedAt = Date.now();
  }
  if (j.state === "running" && !stopping && Date.now() - p.movedAt > SLOW_STEP_MS && !/longer than usual|^Waiting/i.test(queueText))
    queueText = `${queueText.replace(/\.?$/, ".")} This step is taking longer than usual. It is still working. The computer may be busy with other work.`;
  // A failed job's message is in the "could not be made" summary just below, so it is not repeated here.
  setText(p.message, j.state === "error" ? "" : queueText);
  // Tell screen reader users about a new step or the end, not every percentage.
  const stageKey = `${j.state}:${j.stage}:${stopping ? "s" : ""}`;
  if (p.lastStage !== null && p.lastStage !== stageKey) {
    const label = view.stages.find((s) => s.id === j.stage)?.label;
    const say = stopping ? "Stopping." : j.state === "stopped" ? "Stopped." : busy && label ? `${label}.` : "";
    if (say) setText(p.live, say);
  }
  p.lastStage = stageKey;
  // Where focus is before the Stop row or question is hidden: if it is there (or already lost), it is moved on below.
  const active = document.activeElement;
  const focusInProgress = !active || active === document.body || p.box.contains(active);
  // Stop, with its question, while the job runs. aria-disabled, not disabled, so a focused Stop keeps focus.
  p.stopRow.hidden = !busy || !p.confirm.hidden;
  if (stopping) p.stop.setAttribute("aria-disabled", "true");
  else p.stop.removeAttribute("aria-disabled");
  setText(p.stop, stopping ? "Stopping..." : "Stop");
  if (!busy) p.confirm.hidden = true;
  if (stopping && !p.confirm.hidden) {
    p.confirm.hidden = true;
    p.stopRow.hidden = false;
  }
  p.retryRow.hidden = !(j.state === "stopped" && (j.fromApp || view.spec));
  // The job has just ended: if focus was on Stop (now hidden) or nowhere, put it on what comes next.
  const ended = p.lastState && (p.lastState === "queued" || p.lastState === "running") && !busy;
  p.lastState = j.state;
  if (ended && focusInProgress) {
    if (j.state === "stopped" && !p.retryRow.hidden) p.retry.focus();
    else if (j.state === "stopped") focusNode(p.message);
    else if (j.state === "error") focusNode(document.querySelector("#job-error .error-summary h2") ?? p.message);
    else focusNode(state.head?.title);
  }
}

/** Focus a heading or message that is not normally focusable. */
function focusNode(node) {
  if (!node) return;
  if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
  node.focus();
}

function askStop() {
  const p = state.progress;
  p.confirm.hidden = false;
  p.stopRow.hidden = true;
  p.confirmYes.focus();
}

function cancelStop() {
  const p = state.progress;
  p.confirm.hidden = true;
  p.stopRow.hidden = false;
  p.stop.focus();
}

async function confirmStop() {
  const p = state.progress;
  p.confirm.hidden = true;
  p.stopRow.hidden = false;
  // Show it at once: the job may take a few seconds to reach a safe point.
  p.stop.setAttribute("aria-disabled", "true");
  setText(p.stop, "Stopping...");
  setText(p.message, "Stopping. This can take a few seconds.");
  setText(p.live, "Stopping.");
  p.stop.focus();
  try {
    const view = await api("POST", `/api/jobs/${encodeURIComponent(state.jobId)}/stop`);
    if (view?.job) render(view);
  } catch (e) {
    announce(e.message);
  }
  poll(false);
}

async function retryJob() {
  try {
    const view = await api("POST", `/api/jobs/${encodeURIComponent(state.jobId)}/retry`);
    state.sigs = {};
    render(view);
    poll(false);
    loadHistory();
  } catch (e) {
    showErrors($("job-error"), "There is a problem", [e.message]);
  }
}

// ---------- script editor ----------

function sceneDef(type) {
  return state.meta.scenes.find((s) => s.type === type);
}

/**
 * A character count under a box. The visible count changes as you type; screen readers hear it once you
 * pause (like the GOV.UK character count), not on every key press.
 */
function counter(input, max) {
  const out = el("p", { class: "char-count", id: `${input.id}-count` });
  const live = el("span", { class: "visually-hidden", "aria-live": "polite" });
  let timer = null;
  const text = () => {
    const n = input.value.length;
    return n > max ? `${n - max} character${n - max === 1 ? "" : "s"} too many` : `${max - n} character${max - n === 1 ? "" : "s"} left`;
  };
  const update = () => {
    out.firstChild.textContent = text();
    out.classList.toggle("over", input.value.length > max);
  };
  out.append(el("span", {}, ""), live);
  input.addEventListener("input", () => {
    update();
    clearTimeout(timer);
    timer = setTimeout(() => (live.textContent = text()), 1000);
  });
  input.setAttribute("aria-describedby", [input.getAttribute("aria-describedby"), `${input.id}-count`].filter(Boolean).join(" "));
  update();
  return out;
}

/** An inline error above a box, linked from the error summary. */
function fieldErrorBox(id) {
  return el("p", { class: "error-text", id: `${id}-error`, hidden: true });
}

/** What each story beat does, in plain words. */
const BEAT_WORDS = { hook: "the opening", problem: "the problem", message: "the main message", insight: "what it means", proof: "the evidence", summary: "the summary", action: "what to do" };

const SLOT_LABELS = {
  title: "Title",
  eyebrow: "Small heading above the title",
  subtitle: "Line under the title",
  kicker: "Small heading",
  text: "Main text",
  support: "Supporting line",
  action: "What to do",
  link: "Web address",
  detail: "Extra detail",
  heading: "Heading",
  value: "Number",
  label: "What the number means",
  source: "Where the number comes from",
  quote: "Quote",
  name: "Name of the person quoted",
  role: "Their job or role",
  items: "List",
  emphasis: "Words to highlight",
  icon: "Icon",
  photo: "Photo",
  clip: "Video clip",
};

/** The label people see for a slot. Never the raw slot name. */
function slotLabel(slot) {
  return SLOT_LABELS[slot] ?? String(slot).charAt(0).toUpperCase() + String(slot).slice(1).replace(/([A-Z])/g, " $1").toLowerCase();
}

function renderEditor(view) {
  state.editorFor = view.job.id;
  state.editorDirty = false;
  const spec = JSON.parse(JSON.stringify(view.spec));
  const box = $("job-editor");
  const errors = el("div", { id: "editor-errors", hidden: true });
  const form = el("form", { id: "script-form", novalidate: true });
  const titleInput = el("input", { type: "text", id: "spec-title", value: spec.title, maxlength: "120" });
  form.append(el("div", { class: "field" }, el("label", { for: "spec-title" }, "Video title"), el("p", { class: "hint" }, "Used for the file names. It is not shown in the video."), titleInput));

  spec.scenes.forEach((scene, si) => {
    const def = sceneDef(scene.type);
    const fs = el("fieldset", { class: "scene-edit" }, el("legend", {}, `Scene ${si + 1}: ${def?.label ?? scene.type}${BEAT_WORDS[scene.beat] ? `, ${BEAT_WORDS[scene.beat]}` : ""}`));
    for (const t of def?.text ?? []) {
      // A list (Points, Icon row): one box per item. With 4 items each must be shorter to fit.
      if (t.slot === "items" && Array.isArray(scene.slots.items)) {
        const items = scene.slots.items;
        const key = items[0] && "label" in items[0] ? "label" : "text";
        const max = items.length >= 4 && t.maxCharsWhenFull ? t.maxCharsWhenFull : t.maxChars;
        const noun = key === "label" ? "Label" : "Point";
        items.forEach((it, k) => {
          const id = `s${si}-items-${k}`;
          const input = el("input", { type: "text", id, value: it[key] ?? "", "data-scene": si, "data-item": k, "data-key": key, "aria-describedby": `${id}-error` });
          fs.append(el("div", { class: "field" }, el("label", { for: id }, `${noun} ${k + 1}`), fieldErrorBox(id), input, counter(input, max)));
        });
        if (items.length >= 4 && t.maxCharsWhenFull)
          fs.append(el("p", { class: "hint" }, `With 4 ${noun.toLowerCase()}s, each can have up to ${t.maxCharsWhenFull} characters, so they fit the square and portrait videos.`));
        continue;
      }
      if (t.slot === "items" || (scene.slots[t.slot] != null && typeof scene.slots[t.slot] !== "string")) continue;
      const has = typeof scene.slots[t.slot] === "string";
      const id = `s${si}-${t.slot}`;
      const input = el("input", { type: "text", id, value: has ? scene.slots[t.slot] : "", "data-scene": si, "data-slot": t.slot, "aria-describedby": `${id}-error` });
      fs.append(
        el(
          "div",
          { class: "field" },
          el("label", { for: id }, `${slotLabel(t.slot)}${(def.required ?? []).includes(t.slot) ? "" : " (optional)"}`),
          fieldErrorBox(id),
          input,
          counter(input, t.maxChars),
        ),
      );
    }
    if ("emphasis" in (def?.sample ?? {}) || scene.slots.emphasis) {
      const id = `s${si}-emphasis`;
      fs.append(
        el(
          "div",
          { class: "field" },
          el("label", { for: id }, "Words to highlight (optional)"),
          el("p", { class: "hint", id: `${id}-hint` }, "Up to 3, separated by commas. Each must appear exactly in the main text."),
          fieldErrorBox(id),
          el("input", { type: "text", id, value: (scene.slots.emphasis ?? []).join(", "), "data-scene": si, "data-emphasis": "1", "aria-describedby": `${id}-error ${id}-hint` }),
        ),
      );
    }
    if (scene.slots.icon || "icon" in (def?.sample ?? {})) {
      const id = `s${si}-icon`;
      fs.append(
        el(
          "div",
          { class: "field" },
          el("label", { for: id }, "Icon (optional)"),
          el("p", { class: "hint", id: `${id}-hint` }, "An icon name, such as calendar or recycle. Leave empty for no icon."),
          fieldErrorBox(id),
          el("input", { type: "text", id, value: scene.slots.icon?.icon ?? "", "data-scene": si, "data-icon": "1", list: "icon-names", "aria-describedby": `${id}-error ${id}-hint` }),
        ),
      );
    }
    const phrases = el("div", { class: "stack" });
    const addPhrase = (text) => {
      const k = phrases.children.length;
      const id = `s${si}-vo-${k}-${Math.random().toString(36).slice(2, 6)}`;
      const ta = el("textarea", { id, rows: "2", "data-scene": si, "data-vo": "1" }, text);
      const row = el(
        "div",
        { class: "field" },
        el("label", { for: id }, `Spoken line ${k + 1}`),
        el("div", { class: "phrase-row" }, ta),
        counter(ta, 220),
        el("button", { type: "button", class: "link-button", onclick: () => {
          if (phrases.querySelectorAll("textarea").length <= 1) return announce("Each scene needs at least one spoken line.");
          row.remove();
          state.editorDirty = true;
        } }, `Remove spoken line ${k + 1}`),
      );
      phrases.append(row);
    };
    scene.voiceover.forEach(addPhrase);
    fs.append(
      el("h4", {}, "Voiceover"),
      el("p", { class: "hint" }, "What the voice says while this scene is on screen. The captions show it word for word. Write dates as 3 March and web addresses without https."),
      phrases,
      el("button", { type: "button", class: "button secondary small", onclick: () => {
        if (phrases.querySelectorAll("textarea").length >= 4) return announce("A scene can have up to 4 spoken lines.");
        addPhrase("");
        state.editorDirty = true;
        phrases.lastChild.querySelector("textarea").focus();
      } }, "Add a spoken line"),
      el("p"),
    );
    form.append(fs);
  });

  const submit = el("button", { type: "submit", class: "button" }, "Save script and make the video again");
  form.append(el("div", { class: "button-row" }, submit, el("button", { type: "button", class: "button secondary", onclick: () => { state.sigs.spec = null; state.editorDirty = false; renderEditor(state.view); } }, "Undo my changes")));
  form.addEventListener("input", () => (state.editorDirty = true));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const next = collectSpec(spec, form);
    submit.disabled = true;
    submit.textContent = "Checking the text fits...";
    try {
      const v = await api("PUT", `/api/jobs/${encodeURIComponent(state.jobId)}/spec`, { spec: next });
      state.editorDirty = false;
      state.sigs = {};
      render(v);
      poll(false);
      loadHistory();
      focusJob();
      announce("The script is saved. The video is being made again.");
    } catch (err) {
      for (const p of form.querySelectorAll(".error-text[id$='-error']")) p.hidden = true;
      for (const n of form.querySelectorAll("[aria-invalid]")) n.removeAttribute("aria-invalid");
      const marked = [];
      for (const f of err.data?.fields ?? []) {
        const ids = f.slot === "items" ? (f.item != null ? [`s${f.scene}-items-${f.item}`] : [...form.querySelectorAll(`[id^="s${f.scene}-items-"][data-item]`)].map((n) => n.id)) : [`s${f.scene}-${f.slot}`];
        for (const fid of ids) {
          const box = document.getElementById(`${fid}-error`);
          if (!box) continue;
          box.hidden = false;
          box.textContent = `Error: ${f.message}`;
          document.getElementById(fid)?.setAttribute("aria-invalid", "true");
          marked.push(fid);
        }
      }
      // Summary items link to their fields, named as the editor names them (GOV.UK error summary pattern).
      const linked = [];
      const seen = new Set();
      for (const f of err.data?.fields ?? []) {
        const fid = f.slot === "items" ? (f.item != null ? `s${f.scene}-items-${f.item}` : marked.find((m) => m.startsWith(`s${f.scene}-items-`))) : `s${f.scene}-${f.slot}`;
        const text = /^Scene \d/.test(f.message) ? f.message : `Scene ${f.scene + 1}, ${f.slot === "items" && f.item != null ? `Item ${f.item + 1}` : slotLabel(f.slot)}: ${f.message}`;
        if (seen.has(text)) continue;
        seen.add(text);
        linked.push(fid && document.getElementById(fid) ? { text, target: fid } : { text });
      }
      // Problems the fields do not cover (the video title, spoken lines, the script length) stay as text.
      const covered = (p) => (err.data?.fields ?? []).some((f) => p.startsWith(`Scene ${f.scene + 1},`) && p.endsWith(f.message)) || seen.has(p);
      const rest = (err.data?.problems ?? []).filter((p) => !covered(p)).map((p) => (/^Video title: /.test(p) ? { text: p, target: "spec-title" } : p));
      const items = [...linked, ...rest];
      showErrors(errors, err.data?.fields?.length ? err.message : "There is a problem with the script", items.length ? items : [err.message]);
    } finally {
      submit.disabled = false;
      submit.textContent = "Save script and make the video again";
    }
  });

  box.replaceChildren(
    el("h3", { id: "script-editor", tabindex: "-1" }, "Edit the script"),
    el("p", {}, "Change the words on screen or the voiceover, then make the video again. The brief is not read again, and unchanged lines reuse their recorded voice."),
    errors,
    form,
  );
  loadIconNames(view.job.brand);
}

function collectSpec(spec, form) {
  const next = JSON.parse(JSON.stringify(spec));
  next.title = form.querySelector("#spec-title").value.trim();
  next.scenes.forEach((s) => (s.voiceover = []));
  for (const input of form.querySelectorAll("[data-scene]")) {
    const s = next.scenes[Number(input.dataset.scene)];
    const v = input.value.trim();
    if (input.dataset.item != null) {
      const item = s.slots.items?.[Number(input.dataset.item)];
      if (item) item[input.dataset.key] = v;
    } else if (input.dataset.slot) {
      if (v) s.slots[input.dataset.slot] = v;
      else delete s.slots[input.dataset.slot];
    } else if (input.dataset.emphasis) {
      const list = v.split(",").map((x) => x.trim()).filter(Boolean);
      if (list.length) s.slots.emphasis = list;
      else delete s.slots.emphasis;
    } else if (input.dataset.icon) {
      if (v) s.slots.icon = { ...(s.slots.icon ?? {}), icon: v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") };
      else delete s.slots.icon;
    } else if (input.dataset.vo) {
      if (v) s.voiceover.push(v.replace(/\s+/g, " "));
    }
  }
  return next;
}

let iconBrand = null;
async function loadIconNames(brand) {
  if (iconBrand === brand && document.getElementById("icon-names")) return;
  iconBrand = brand;
  try {
    const names = await api("GET", `/api/icons?brand=${encodeURIComponent(brand)}`);
    document.getElementById("icon-names")?.remove();
    document.body.append(el("datalist", { id: "icon-names" }, names.map((n) => el("option", { value: n }))));
  } catch {
    /* the list is only a help */
  }
}

// ---------- history ----------

function historyStatus(j) {
  return j.state === "running" ? `${STATE_TEXT[j.state]} ${Math.round((j.progress ?? 0) * 100)}%` : STATE_TEXT[j.state] ?? j.state;
}

/** Keep the open job's row in step with the progress above it, without reloading the list. */
function updateHistoryRow(j) {
  const row = [...document.querySelectorAll("#history tr[data-job]")].find((r) => r.dataset.job === j.id);
  if (!row) return;
  const tag = row.querySelector("td[data-label='Status'] .tag");
  const link = row.querySelector("td[data-label='Video'] a");
  if (tag) {
    setText(tag, historyStatus(j));
    const cls = `tag ${STATE_CLASS[j.state]}`;
    if (tag.className !== cls) tag.className = cls;
  }
  if (link) setText(link, j.title);
}

async function loadHistory() {
  const box = $("history");
  let jobs;
  try {
    jobs = await api("GET", "/api/jobs");
  } catch (e) {
    box.replaceChildren(el("p", { class: "error-text" }, e.message));
    return;
  }
  if (!jobs.length) {
    box.replaceChildren(el("p", {}, "No videos yet. Describe one above and press Make video."));
    return;
  }
  const brandName = (id) => state.brands.find((b) => b.id === id)?.name ?? id;
  box.replaceChildren(
    el(
      "table",
      { class: "jobs stack-narrow" },
      el("caption", { class: "visually-hidden" }, "Videos made so far, newest first"),
      el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Video"), el("th", { scope: "col" }, "Brand"), el("th", { scope: "col" }, "Started"), el("th", { scope: "col" }, "Status"))),
      el(
        "tbody",
        {},
        jobs.slice(0, 50).map((j) =>
          el(
            "tr",
            { "data-job": j.id },
            el("td", { "data-label": "Video" }, el("a", { href: `/?job=${encodeURIComponent(j.id)}`, onclick: (e) => { e.preventDefault(); openJob(j.id, true); } }, j.title)),
            el("td", { "data-label": "Brand" }, brandName(j.brand)),
            el("td", { "data-label": "Started" }, formatDate(j.createdAt)),
            el("td", { "data-label": "Status" }, el("span", { class: `tag ${STATE_CLASS[j.state]}` }, historyStatus(j))),
          ),
        ),
      ),
    ),
  );
}

init();
