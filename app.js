const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
const dateLabel = value => {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};
const words = value => Array.isArray(value) ? value.join("\n") : (value || "");
let state = { config: {}, missions: [], teams: [], projects: [], leaderboard: [], schedule: [], faqs: [] };
let adminData = null;
let countdownTimer = null;

function toast(message, kind = "success") {
  const region = $(".toast-region");
  const item = document.createElement("div");
  item.className = `toast toast-${kind}`;
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 4200);
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The server returned an unreadable response. Please try again.");
  }
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

async function loadPortal() {
  try {
    state = await request("/api/bootstrap");
    renderPortal();
  } catch (error) {
    toast(error.message, "error");
  }
}

function renderPortal() {
  renderEventInfo();
  renderCountdown();
  renderMissions();
  renderTeams();
  renderLeaderboard();
  renderSchedule();
  renderFaqs();
  renderRegistrationOptions();
}

function renderEventInfo() {
  const config = state.config;
  $("#hero-tagline").textContent = config.tagline || "Aim. Launch. Innovate. Conquer.";
  document.title = `${config.event_name || "SHOOT2CODE"} — ${config.tagline || "Aim. Launch. Innovate. Conquer."}`;
  const year = config.start_date ? Number(config.start_date.slice(0, 4)) : null;
  $("#event-dates").textContent = config.start_date
    ? `${dateLabel(config.start_date)}${config.end_date ? ` – ${dateLabel(config.end_date)}` : ""}`
    : `January${year ? ` ${year}` : ""} · To be announced`;
  $("#event-venue").textContent = [config.venue, config.format && config.format !== "To be announced" ? config.format : ""].filter(Boolean).join(" · ") || "Format & venue to be announced";
  $("#event-team-size").textContent = config.min_team_size && config.max_team_size
    ? `${config.min_team_size}–${config.max_team_size} participants`
    : config.max_team_size ? `Up to ${config.max_team_size} participants`
      : config.min_team_size ? `At least ${config.min_team_size} participants` : "Set by organizers";
  $("#event-deadline").textContent = dateLabel(config.registration_deadline) || "To be announced";
  $("#organizer-name").textContent = config.organizer || "SHOOT2CODE Organizing Team";
  const emailLink = $("#organizer-email");
  emailLink.textContent = config.event_email || "Contact details to be announced";
  emailLink.href = config.event_email ? `mailto:${encodeURIComponent(config.event_email)}` : "#contact";
  $("#current-year").textContent = new Date().getFullYear();
}

function renderCountdown() {
  if (countdownTimer) window.clearInterval(countdownTimer);
  const start = state.config.start_date ? new Date(`${state.config.start_date}T00:00:00`) : null;
  const status = $("#countdown-status");
  const fields = ["days", "hours", "minutes", "seconds"].map(id => $(`#${id}`));
  if (!start || Number.isNaN(start.getTime())) {
    status.textContent = "Event date to be announced";
    fields.forEach(field => { field.textContent = "--"; });
    return;
  }
  const tick = () => {
    const remaining = start.getTime() - Date.now();
    if (remaining <= 0) {
      status.textContent = "The event is underway!";
      fields.forEach(field => { field.textContent = "00"; });
      window.clearInterval(countdownTimer);
      return;
    }
    status.textContent = `Launch day · ${dateLabel(state.config.start_date)}`;
    const seconds = Math.floor(remaining / 1000);
    [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60]
      .forEach((value, index) => { fields[index].textContent = String(value).padStart(2, "0"); });
  };
  tick();
  countdownTimer = window.setInterval(tick, 1000);
}

function renderMissions() {
  const grid = $("#mission-grid");
  const search = $("#mission-search").value.trim().toLowerCase();
  const category = $("#category-filter").value;
  const difficulty = $("#difficulty-filter").value;
  const sortBy = $("#mission-sort").value;
  const openMissions = state.missions.filter(mission => mission.status === "Open");
  const categories = [...new Set(state.missions.map(mission => mission.category))].sort();
  const categorySelect = $("#category-filter");
  const previous = categorySelect.value;
  categorySelect.innerHTML = `<option value="">All categories</option>${categories.map(item => `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`).join("")}`;
  categorySelect.value = categories.includes(previous) ? previous : "";
  const filtered = state.missions.filter(mission => {
    const text = `${mission.title} ${mission.description} ${mission.category} ${(mission.skills || []).join(" ")}`.toLowerCase();
    return (!search || text.includes(search)) && (!category || mission.category === category) && (!difficulty || mission.difficulty === difficulty);
  });
  const difficultyRank = { Easy: 1, Medium: 2, Hard: 3 };
  if (sortBy === "title") filtered.sort((a, b) => a.title.localeCompare(b.title));
  if (sortBy === "difficulty") filtered.sort((a, b) => (difficultyRank[a.difficulty] || 0) - (difficultyRank[b.difficulty] || 0));
  grid.innerHTML = filtered.map((mission, index) => `
    <article class="mission-card mission-card-${index % 3}">
      <div class="mission-card-top"><span class="mission-id">${escapeHTML(mission.id)}</span><span class="mission-status status-${mission.status.toLowerCase()}"><i></i>${escapeHTML(mission.status)}</span></div>
      <div class="mission-illustration mission-illustration-${index % 3}" aria-hidden="true"><span class="mission-illustration-shape"></span><span class="mission-illustration-icon">${["⌘", "✳", "↗"][index % 3]}</span><span class="mission-illustration-dot"></span></div>
      <div class="mission-card-body"><div class="mission-meta"><span>${escapeHTML(mission.category)}</span><span class="difficulty difficulty-${mission.difficulty.toLowerCase()}">${escapeHTML(mission.difficulty)}</span></div>
      <h3>${escapeHTML(mission.title)}</h3><p>${escapeHTML(mission.description)}</p>
      <div class="skill-chips">${(mission.skills || []).slice(0, 3).map(skill => `<span>${escapeHTML(skill)}</span>`).join("")}</div>
      <div class="mission-card-actions"><button class="inline-link mission-detail-button" data-mission-details="${escapeHTML(mission.id)}">Mission briefing <span>↗</span></button><button class="mission-select-button" data-select-mission="${escapeHTML(mission.id)}" ${mission.status !== "Open" ? "disabled" : ""} aria-label="Select ${escapeHTML(mission.title)}">＋</button></div></div>
    </article>`).join("");
  $("#mission-empty").classList.toggle("hidden", filtered.length > 0);
  $("#register-mission").innerHTML = `<option value="">Choose an open mission</option>${openMissions.map(mission => `<option value="${escapeHTML(mission.id)}">${escapeHTML(mission.id)} · ${escapeHTML(mission.title)}</option>`).join("")}`;
  if (!openMissions.length) $("#register-mission").insertAdjacentHTML("beforeend", `<option value="" disabled>No open missions right now</option>`);
}

function renderMissionDetails(mission) {
  $("#mission-modal-content").innerHTML = `
    <div class="section-kicker">${escapeHTML(mission.id)} · ${escapeHTML(mission.category)}</div>
    <div class="mission-detail-hero"><span class="difficulty difficulty-${mission.difficulty.toLowerCase()}">${escapeHTML(mission.difficulty)}</span><span class="mission-status status-${mission.status.toLowerCase()}"><i></i>${escapeHTML(mission.status)}</span></div>
    <h2 id="modal-title">${escapeHTML(mission.title)}</h2><p class="mission-detail-description">${escapeHTML(mission.description)}</p>
    ${detailList("Suggested skills", mission.skills)}${detailList("Expected deliverables", mission.deliverables)}
    ${detailList("Evaluation criteria", mission.evaluation)}${detailList("Requirements & constraints", mission.constraints)}
    ${detailList("Sample use cases", mission.use_cases)}${detailList("Expected outcomes", mission.outcomes)}
    <button class="button button-red" data-select-mission="${escapeHTML(mission.id)}" ${mission.status !== "Open" ? "disabled" : ""}>Select this mission <span>↗</span></button>`;
  $("#mission-modal").showModal();
}

function detailList(title, values) {
  if (!values?.length) return "";
  return `<div class="detail-list"><h3>${escapeHTML(title)}</h3><ul>${values.map(item => `<li>${escapeHTML(item)}</li>`).join("")}</ul></div>`;
}

function renderTeams() {
  const grid = $("#team-grid");
  const teams = state.teams.filter(team => team.status === "Registered");
  $("#team-empty").classList.toggle("hidden", teams.length > 0);
  grid.innerHTML = teams.slice(0, 6).map((team, index) => {
    const mission = state.missions.find(item => item.id === team.mission_id);
    const names = team.members.slice(0, 3).map(member => `${member.name} · ${member.role}`).join(" / ");
    const project = team.project_status === "Approved" && team.project_title;
    const progress = 50 + (team.project_submitted ? 25 : 0) + (project ? 25 : 0);
    const rating = Number.isFinite(team.score) ? Math.max(0, Math.min(5, Math.round(team.score / 20))) : null;
    return `<article class="team-card"><div class="team-card-top"><span class="team-avatar team-avatar-${index % 4}">${escapeHTML(team.name.slice(0, 1).toUpperCase())}</span><span class="team-id">${escapeHTML(team.id)}</span><span class="team-member-count">♟ ${team.members.length}</span></div><h3>${escapeHTML(team.name)}</h3><p class="team-members">${escapeHTML(names)}${team.members.length > 3 ? ` / +${team.members.length - 3}` : ""}</p><div class="team-achievements"><span>✦ ${project ? "PROJECT SPOTLIGHT" : "MISSION LOCKED IN"}</span>${rating !== null ? `<span class="team-rating" aria-label="Organizer rating: ${rating} out of 5 stars">${"★".repeat(rating)}${"☆".repeat(5 - rating)} <b>${escapeHTML(team.score)}</b></span>` : ""}</div><div class="team-progress-label"><span>Showcase progress</span><b>${progress}%</b></div><div class="team-progress" role="progressbar" aria-label="Showcase progress" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"><span style="width:${progress}%"></span></div>${project ? `<div class="team-project"><b>${escapeHTML(team.project_title)}</b><p>${escapeHTML(team.project_summary)}</p></div>` : ""}<div class="team-card-bottom"><span>${project ? "APPROVED PROJECT" : escapeHTML(mission?.title || "Mission to be announced")}</span><span class="team-arrow">↗</span></div></article>`;
  }).join("");
  if (!teams.length) grid.innerHTML = "";
}

function renderLeaderboard() {
  const leaderboard = $("#leaderboard-list");
  const rows = state.leaderboard || [];
  leaderboard.innerHTML = rows.length ? rows.slice(0, 5).map((team, index) => `<div class="leaderboard-row"><span class="rank rank-${index + 1}">${String(index + 1).padStart(2, "0")}</span><span class="leaderboard-team">${escapeHTML(team.name)}<small>${escapeHTML(team.project_title || "Team project")}</small></span><strong>${Number(team.score).toFixed(0)}<small>PTS</small></strong></div>`).join("") : `<div class="leaderboard-empty"><span>✦</span><p>The board is waiting for its first big launch.</p><small>Approved project scores will appear here.</small></div>`;
}

function renderSchedule() {
  $("#schedule-track").innerHTML = state.schedule.map((item, index) => `<article class="schedule-item"><div class="schedule-marker"><span>${String(index + 1).padStart(2, "0")}</span><i></i></div><div class="schedule-time">${escapeHTML(item.time || "To be announced")}</div><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.detail || "")}</p></article>`).join("");
}

function renderFaqs() {
  $("#faq-list").innerHTML = state.faqs.map((item, index) => `<details class="faq-item"${index === 0 ? " open" : ""}><summary><span>${escapeHTML(item.question)}</span><i aria-hidden="true">+</i></summary><p>${escapeHTML(item.answer)}</p></details>`).join("");
}

function renderAdminRegistrationRow(registration) {
  const team = adminData.teams.find(item => item.id === registration.team_id);
  const mission = adminData.missions.find(item => item.id === team?.mission_id);
  const leaderDetails = [registration.department, registration.job_role, registration.institution_id, registration.phone, registration.skills].filter(Boolean).join(" · ");
  const members = team?.members || [];
  return `<tr><td><b>${escapeHTML(registration.team_name)}</b><small>${escapeHTML(registration.leader)} · ${escapeHTML(registration.email)}</small>${leaderDetails ? `<small>${escapeHTML(leaderDetails)}</small>` : ""}</td><td>${escapeHTML(mission?.title || "—")}</td><td><details class="admin-participants"><summary>${members.length} participant${members.length === 1 ? "" : "s"}</summary><div>${members.map(member => `<p><b>${escapeHTML(member.name)}</b> · ${escapeHTML(member.role || "Member")}<small>${escapeHTML(member.email)}</small></p>`).join("")}</div></details></td><td><span class="admin-status">${escapeHTML(registration.status)}</span></td><td><select data-registration-status="${escapeHTML(registration.id)}"><option ${registration.status === "Registered" ? "selected" : ""}>Registered</option><option ${registration.status === "Waitlisted" ? "selected" : ""}>Waitlisted</option><option ${registration.status === "Withdrawn" ? "selected" : ""}>Withdrawn</option></select><button class="mini-button" data-save-registration="${escapeHTML(registration.id)}">Save</button></td></tr>`;
}

function renderRegistrationOptions() {
  const open = state.config.registration_open !== false;
  $("#registration-closed").classList.toggle("hidden", open);
  $(".register-card").classList.toggle("is-closed", !open);
  $$(".registration-form").forEach(form => form.classList.toggle("hidden", !open));
  $$(".registration-tab").forEach(tab => { tab.disabled = !open; });
  if (!open) {
    $(".register-card").classList.add("is-closed");
    $("#event-deadline").textContent = "Registration closed";
  }
}

function setFormMessage(form, message, kind = "error") {
  const output = $(".form-message", form);
  if (!output) return;
  output.textContent = message;
  output.className = `form-message ${message ? `message-${kind}` : ""}`;
}

function activateRegistrationTab(name) {
  $$(".registration-tab").forEach(tab => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  $$(".registration-form").forEach(form => form.classList.toggle("hidden", form.id !== `${name}-form`));
  $("#registration-closed").classList.add("hidden");
}

function showSuccess(payload) {
  const isWaitlisted = payload.status === "Waitlisted";
  $("#success-content").innerHTML = `<div class="success-burst" aria-hidden="true">✦</div><div class="section-kicker">${isWaitlisted ? "YOU'RE ON THE WAITLIST" : "REGISTRATION LOCKED IN"}</div><h2 id="success-title">${isWaitlisted ? "Hold tight,<br>your shot is coming." : "Your flock is<br>ready to fly."}</h2><p>${isWaitlisted ? "Your team has a place on the waitlist. Organizers will be in touch if a spot opens." : "You're on the board. Save these details and share your team invite code with your crew."}</p><div class="success-details"><div><small>REGISTRATION ID</small><b>${escapeHTML(payload.id)}</b></div><div><small>TEAM ID</small><b>${escapeHTML(payload.team_id)}</b></div>${payload.invite_code ? `<div class="invite-code-row"><small>TEAM INVITE CODE</small><b>${escapeHTML(payload.invite_code)}</b></div>` : ""}</div><p class="email-note">${payload.email_status === "sent" ? "A confirmation email is on its way." : payload.email_status === "failed" ? "Your registration is saved, but the confirmation email could not be sent. Please save your registration ID." : "Save your registration ID to check your status later. Email confirmation is not configured."}</p><button class="button button-red button-wide" data-close-dialog>Got it <span>↗</span></button>`;
  $("#success-modal").showModal();
  $("#create-form").reset();
  $("#join-form").reset();
}

async function handleCreateRegistration(event) {
  event.preventDefault();
  const form = event.currentTarget;
  setFormMessage(form, "");
  const values = Object.fromEntries(new FormData(form));
  const members = String(values.members || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const separator = line.indexOf(",");
    if (separator < 1) return { name: "", email: "" };
    return { name: line.slice(0, separator).trim(), email: line.slice(separator + 1).trim() };
  });
  if (members.some(member => !member.name || !member.email)) {
    setFormMessage(form, "Add each team member on a new line in the format: name, email.");
    return;
  }
  const submit = $("button[type=submit]", form);
  submit.disabled = true;
  submit.classList.add("is-loading");
  try {
    const payload = await request("/api/register", {
      method: "POST",
      body: JSON.stringify({
        ...values,
        members,
        consent: form.elements.consent.checked
      })
    });
    showSuccess(payload);
    await loadPortal();
  } catch (error) {
    setFormMessage(form, error.message);
  } finally {
    submit.disabled = false;
    submit.classList.remove("is-loading");
  }
}

async function handleJoinRegistration(event) {
  event.preventDefault();
  const form = event.currentTarget;
  setFormMessage(form, "");
  const submit = $("button[type=submit]", form);
  submit.disabled = true;
  try {
    const payload = await request("/api/join", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    showSuccess(payload);
    await loadPortal();
  } catch (error) {
    setFormMessage(form, error.message);
  } finally {
    submit.disabled = false;
  }
}

async function handleLookup(event) {
  event.preventDefault();
  const form = event.currentTarget;
  setFormMessage(form, "");
  try {
    const values = Object.fromEntries(new FormData(form));
    const result = await request(`/api/registration/${encodeURIComponent(values.id.trim())}`);
    setFormMessage(form, `${result.team_name} · ${result.status} · Team ${result.team_id}`, "success");
  } catch (error) {
    setFormMessage(form, error.message);
  }
}

async function openAdmin() {
  try {
    const session = await request("/api/admin/me");
    if (session.authenticated) {
      await openAdminDashboard();
    } else {
      $("#login-modal").showModal();
    }
  } catch (error) {
    toast(error.message, "error");
  }
}

async function openAdminDashboard() {
  try {
    adminData = await request("/api/admin/data");
    renderAdmin("overview");
    $("#admin-modal").showModal();
    $("#login-modal").close();
  } catch (error) {
    toast(error.message, "error");
  }
}

function renderAdmin(section) {
  $$(".admin-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.adminTab === section));
  const content = $("#admin-content");
  if (!adminData) return;
  if (section === "overview") {
    content.innerHTML = `<div class="admin-stats"><div><small>REGISTERED TEAMS</small><strong>${adminData.teams.filter(team => team.status === "Registered").length}</strong></div><div><small>MISSIONS</small><strong>${adminData.missions.length}</strong></div><div><small>PROJECTS TO REVIEW</small><strong>${adminData.teams.filter(team => team.project_status === "Pending" && team.project_title).length}</strong></div><div><small>WAITLIST</small><strong>${adminData.registrations.filter(item => item.status === "Waitlisted").length}</strong></div></div><div class="admin-welcome"><div class="section-kicker">GOOD TO SEE YOU, ORGANIZER</div><h3>Your launchpad is ready.</h3><p>Review registrations, publish missions, approve project spotlights, and keep the event details up to date from here.</p><button class="button button-dark" data-admin-tab="settings">Update event details ↗</button></div>`;
  } else if (section === "missions") {
    content.innerHTML = `<div class="admin-section-heading"><div><h3>Mission board</h3><p>Create, update, publish, and close problem statements.</p></div><button class="button button-red button-small" data-new-mission>＋ New mission</button></div><div class="admin-mission-list">${adminData.missions.map(mission => `<article class="admin-row"><div><b>${escapeHTML(mission.title)}</b><small>${escapeHTML(mission.id)} · ${escapeHTML(mission.category)} · ${escapeHTML(mission.status)}</small></div><div><button class="mini-button" data-edit-mission="${escapeHTML(mission.id)}">Edit</button><button class="mini-button" data-delete-mission="${escapeHTML(mission.id)}">Remove</button></div></article>`).join("")}</div><form id="mission-editor" class="admin-editor hidden"><h4 id="mission-editor-title">New mission</h4><div class="form-row"><label>Mission ID<input name="id" required placeholder="S2C-104"></label><label>Title<input name="title" required maxlength="100"></label></div><div class="form-row"><label>Category<select name="category"><option>AI/ML</option><option>Web Development</option><option>Mobile Applications</option><option>Automation</option><option>Sustainability</option><option>Cybersecurity</option><option>Open Innovation</option><option>Other</option></select></label><label>Difficulty<select name="difficulty"><option>Easy</option><option>Medium</option><option>Hard</option></select></label><label>Status<select name="status"><option>Open</option><option>Locked</option><option>Closed</option></select></label></div><label>Description<textarea name="description" rows="3" required maxlength="2000"></textarea></label><div class="form-row"><label>Suggested skills <span class="optional">(one per line)</span><textarea name="skills" rows="3"></textarea></label><label>Deliverables <span class="optional">(one per line)</span><textarea name="deliverables" rows="3"></textarea></label></div><div class="form-row"><label>Evaluation criteria <span class="optional">(one per line)</span><textarea name="evaluation" rows="3"></textarea></label><label>Requirements &amp; constraints <span class="optional">(one per line)</span><textarea name="constraints" rows="3"></textarea></label></div><div class="form-row"><label>Sample use cases <span class="optional">(one per line)</span><textarea name="use_cases" rows="2"></textarea></label><label>Expected outcomes <span class="optional">(one per line)</span><textarea name="outcomes" rows="2"></textarea></label></div><div class="form-message"></div><div class="admin-editor-actions"><button type="button" class="button button-ghost button-small" data-cancel-editor>Cancel</button><button type="submit" class="button button-red button-small">Save mission</button></div></form>`;
  } else if (section === "registrations") {
    content.innerHTML = `<div class="admin-section-heading"><div><h3>Team registrations</h3><p>Participant details are visible only to organizers.</p></div></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Team / lead</th><th>Mission</th><th>Members</th><th>Status</th><th>Update</th></tr></thead><tbody>${adminData.registrations.filter(item => item.email === (adminData.teams.find(team => team.id === item.team_id)?.members?.[0]?.email || item.email)).map(renderAdminRegistrationRow).join("")}</tbody></table></div>`;
  } else if (section === "projects") {
    const teams = adminData.teams.filter(team => team.project_title);
    content.innerHTML = `<div class="admin-section-heading"><div><h3>Project review</h3><p>Approve projects to feature them in the public flock directory.</p></div></div><div class="admin-project-list">${teams.length ? teams.map(team => `<article class="admin-project"><div><span class="team-id">${escapeHTML(team.id)}</span><h4>${escapeHTML(team.project_title)}</h4><p>${escapeHTML(team.project_summary || "No summary provided.")}</p><small>${escapeHTML(team.name)}</small></div><div class="admin-project-controls"><select data-project-status="${escapeHTML(team.id)}"><option ${team.project_status === "Pending" ? "selected" : ""}>Pending</option><option ${team.project_status === "Approved" ? "selected" : ""}>Approved</option><option ${team.project_status === "Needs changes" ? "selected" : ""}>Needs changes</option></select><input aria-label="Score out of 100" type="number" min="0" max="100" step="1" placeholder="Score" value="${escapeHTML(team.score ?? "")}" data-project-score="${escapeHTML(team.id)}"><button class="mini-button" data-save-project="${escapeHTML(team.id)}">Save</button></div></article>`).join("") : `<div class="empty-state">No project ideas have been submitted yet.</div>`}</div>`;
  } else if (section === "settings") {
    const config = adminData.config;
    content.innerHTML = `<div class="admin-section-heading"><div><h3>Event settings</h3><p>Keep event details and participation limits current. Blank fields stay “to be announced.”</p></div></div><form id="settings-form" class="admin-editor"><div class="form-row"><label>Event name<input name="event_name" value="${escapeHTML(config.event_name)}" required></label><label>Tagline<input name="tagline" value="${escapeHTML(config.tagline)}"></label></div><div class="form-row"><label>Event start date<input name="start_date" type="date" value="${escapeHTML(config.start_date)}"></label><label>Event end date<input name="end_date" type="date" value="${escapeHTML(config.end_date)}"></label><label>Registration deadline<input name="registration_deadline" type="date" value="${escapeHTML(config.registration_deadline)}"></label></div><div class="form-row"><label>Venue<input name="venue" value="${escapeHTML(config.venue)}" placeholder="Leave blank until confirmed"></label><label>Format<input name="format" value="${escapeHTML(config.format)}" placeholder="e.g. In person / Online"></label></div><div class="form-row"><label>Minimum team size<input name="min_team_size" type="number" min="1" value="${escapeHTML(config.min_team_size ?? "")}"></label><label>Maximum team size<input name="max_team_size" type="number" min="1" value="${escapeHTML(config.max_team_size ?? "")}"></label><label>Team capacity<input name="capacity" type="number" min="1" value="${escapeHTML(config.capacity ?? "")}"></label></div><div class="form-row"><label>Organizer / department<input name="organizer" value="${escapeHTML(config.organizer)}"></label><label>Event contact email<input name="event_email" type="email" value="${escapeHTML(config.event_email)}"></label></div><label class="consent"><input name="registration_open" type="checkbox" ${config.registration_open ? "checked" : ""}><span>Registration is open</span></label><div class="form-message"></div><button class="button button-red" type="submit">Save event settings <span>↗</span></button></form>`;
  } else if (section === "schedule") {
    content.innerHTML = `<div class="admin-section-heading"><div><h3>Schedule &amp; FAQ</h3><p>One item per line. Use “title | time | description” or “question | answer”.</p></div></div><form id="content-form" class="admin-editor"><label>Event schedule <span class="optional">(title | time | description)</span><textarea name="schedule" rows="8">${escapeHTML(adminData.schedule.map(item => `${item.title} | ${item.time} | ${item.detail}`).join("\n"))}</textarea></label><label>Frequently asked questions <span class="optional">(question | answer)</span><textarea name="faqs" rows="8">${escapeHTML(adminData.faqs.map(item => `${item.question} | ${item.answer}`).join("\n"))}</textarea></label><div class="form-message"></div><button class="button button-red" type="submit">Save schedule &amp; FAQ <span>↗</span></button></form>`;
  }
}

async function refreshAdmin(section) {
  adminData = await request("/api/admin/data");
  renderAdmin(section);
}

function fillMissionEditor(mission) {
  const form = $("#mission-editor");
  if (!form) return;
  form.classList.remove("hidden");
  $("#mission-editor-title").textContent = mission ? `Edit ${mission.id}` : "New mission";
  form.dataset.editId = mission?.id || "";
  for (const key of ["id", "title", "category", "difficulty", "status", "description", "skills", "deliverables", "evaluation", "constraints", "use_cases", "outcomes"]) {
    if (form.elements[key]) form.elements[key].value = Array.isArray(mission?.[key]) ? mission[key].join("\n") : (mission?.[key] || (key === "status" ? "Open" : ""));
  }
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function handleMissionEditor(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  for (const key of ["skills", "deliverables", "evaluation", "constraints", "use_cases", "outcomes"]) payload[key] = String(payload[key] || "").split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const editId = form.dataset.editId;
  const button = $("button[type=submit]", form);
  button.disabled = true;
  try {
    await request(editId ? `/api/admin/missions/${encodeURIComponent(editId)}` : "/api/admin/missions", {
      method: editId ? "PATCH" : "POST",
      body: JSON.stringify(payload)
    });
    await refreshAdmin("missions");
    await loadPortal();
    toast("Mission saved.");
  } catch (error) {
    setFormMessage(form, error.message);
  } finally {
    button.disabled = false;
  }
}

async function handleSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  for (const key of ["min_team_size", "max_team_size", "capacity"]) payload[key] = payload[key] ? Number(payload[key]) : null;
  payload.registration_open = form.elements.registration_open.checked;
  try {
    await request("/api/admin/config", { method: "PUT", body: JSON.stringify(payload) });
    await refreshAdmin("settings");
    await loadPortal();
    toast("Event settings updated.");
  } catch (error) {
    setFormMessage(form, error.message);
  }
}

async function handleContent(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const lines = value => String(value).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const schedule = lines(form.elements.schedule.value).map(line => {
    const [title = "", time = "", ...detail] = line.split("|").map(part => part.trim());
    return { title, time, detail: detail.join(" | ") };
  });
  const faqs = lines(form.elements.faqs.value).map(line => {
    const [question = "", ...answer] = line.split("|").map(part => part.trim());
    return { question, answer: answer.join(" | ") };
  });
  try {
    await request("/api/admin/content", { method: "PUT", body: JSON.stringify({ schedule, faqs }) });
    await refreshAdmin("schedule");
    await loadPortal();
    toast("Schedule and FAQ updated.");
  } catch (error) {
    setFormMessage(form, error.message);
  }
}

async function adminLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  setFormMessage(form, "");
  const button = $("button[type=submit]", form);
  button.disabled = true;
  try {
    await request("/api/admin/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    form.reset();
    await openAdminDashboard();
  } catch (error) {
    setFormMessage(form, error.message);
  } finally {
    button.disabled = false;
  }
}

async function adminClick(event) {
  const tab = event.target.closest("[data-admin-tab]");
  if (tab) {
    renderAdmin(tab.dataset.adminTab);
    return;
  }
  const edit = event.target.closest("[data-edit-mission]");
  if (edit) {
    fillMissionEditor(adminData.missions.find(mission => mission.id === edit.dataset.editMission));
    return;
  }
  if (event.target.closest("[data-new-mission]")) {
    fillMissionEditor(null);
    return;
  }
  if (event.target.closest("[data-cancel-editor]")) {
    $("#mission-editor").classList.add("hidden");
    return;
  }
  const remove = event.target.closest("[data-delete-mission]");
  if (remove) {
    const mission = adminData.missions.find(item => item.id === remove.dataset.deleteMission);
    if (!window.confirm(`Remove "${mission.title}"? Missions already selected by a team will be closed instead.`)) return;
    try {
      await request(`/api/admin/missions/${encodeURIComponent(mission.id)}`, { method: "DELETE" });
      await refreshAdmin("missions");
      await loadPortal();
      toast("Mission removed or closed.");
    } catch (error) {
      toast(error.message, "error");
    }
    return;
  }
  const saveRegistration = event.target.closest("[data-save-registration]");
  if (saveRegistration) {
    const id = saveRegistration.dataset.saveRegistration;
    const status = $(`[data-registration-status="${CSS.escape(id)}"]`).value;
    try {
      await request(`/api/admin/registrations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await refreshAdmin("registrations");
      await loadPortal();
      toast("Registration updated.");
    } catch (error) {
      toast(error.message, "error");
    }
    return;
  }
  const saveProject = event.target.closest("[data-save-project]");
  if (saveProject) {
    const id = saveProject.dataset.saveProject;
    const status = $(`[data-project-status="${CSS.escape(id)}"]`).value;
    const scoreInput = $(`[data-project-score="${CSS.escape(id)}"]`);
    const score = scoreInput.value === "" ? null : Number(scoreInput.value);
    try {
      await request(`/api/admin/teams/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ project_status: status, score }) });
      await refreshAdmin("projects");
      await loadPortal();
      toast("Project review saved.");
    } catch (error) {
      toast(error.message, "error");
    }
  }
}

async function logoutAdmin() {
  try {
    await request("/api/admin/logout", { method: "POST", body: "{}" });
    $("#admin-modal").close();
    toast("Signed out.");
  } catch (error) {
    toast(error.message, "error");
  }
}

function installInteractions() {
  $("#mission-search").addEventListener("input", renderMissions);
  $("#category-filter").addEventListener("change", renderMissions);
  $("#difficulty-filter").addEventListener("change", renderMissions);
  $("#mission-sort").addEventListener("change", renderMissions);
  $("#mission-grid").addEventListener("click", event => {
    const details = event.target.closest("[data-mission-details]");
    if (details) {
      const mission = state.missions.find(item => item.id === details.dataset.missionDetails);
      if (mission) renderMissionDetails(mission);
      return;
    }
    const select = event.target.closest("[data-select-mission]");
    if (select && select.dataset.selectMission) {
      $("#register-mission").value = select.dataset.selectMission;
      $("#register").scrollIntoView({ behavior: "smooth" });
      activateRegistrationTab("create");
      $("#register-mission").focus({ preventScroll: true });
    }
  });
  $("#mission-modal-content").addEventListener("click", event => {
    const select = event.target.closest("[data-select-mission]");
    if (select) {
      $("#mission-modal").close();
      $("#register-mission").value = select.dataset.selectMission;
      $("#register").scrollIntoView({ behavior: "smooth" });
      activateRegistrationTab("create");
    }
  });
  $$(".registration-tab").forEach(tab => tab.addEventListener("click", () => activateRegistrationTab(tab.dataset.tab)));
  $("#create-form").addEventListener("submit", handleCreateRegistration);
  $("#join-form").addEventListener("submit", handleJoinRegistration);
  $("#lookup-form").addEventListener("submit", handleLookup);
  $$("[data-open-login]").forEach(button => button.addEventListener("click", openAdmin));
  $("#login-form").addEventListener("submit", adminLogin);
  $(".admin-tabs").addEventListener("click", adminClick);
  $("#admin-content").addEventListener("click", adminClick);
  $("#admin-content").addEventListener("submit", event => {
    if (event.target.id === "mission-editor") handleMissionEditor(event);
    if (event.target.id === "settings-form") handleSettings(event);
    if (event.target.id === "content-form") handleContent(event);
  });
  $("#admin-logout").addEventListener("click", logoutAdmin);
  $$(".modal").forEach(dialog => {
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
      if (event.target.closest(".modal-close")) dialog.close();
      if (event.target.closest("[data-close-dialog]")) dialog.close();
    });
  });
  const menuToggle = $(".menu-toggle");
  menuToggle.addEventListener("click", () => {
    const open = menuToggle.getAttribute("aria-expanded") !== "true";
    menuToggle.setAttribute("aria-expanded", String(open));
    $(".main-nav").classList.toggle("nav-open", open);
  });
  $$(".main-nav a").forEach(link => link.addEventListener("click", () => {
    $(".main-nav").classList.remove("nav-open");
    menuToggle.setAttribute("aria-expanded", "false");
  }));
}

installInteractions();
loadPortal();
