import hashlib
import hmac
import json
import os
import re
import secrets
import smtplib
import threading
import time
from datetime import datetime, timezone
from email.message import EmailMessage
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("S2C_DATA_DIR", str(ROOT / "data"))).resolve()
STORE_PATH = DATA_DIR / "store.json"
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
}
STORE_LOCK = threading.RLock()
SESSIONS = {}
LOGIN_ATTEMPTS = {}
SESSION_TTL = 8 * 60 * 60
MAX_BODY_SIZE = 64 * 1024


def new_store():
    return {
        "config": {
            "event_name": "SHOOT2CODE",
            "tagline": "Aim. Launch. Innovate. Conquer.",
            "start_date": "",
            "end_date": "",
            "registration_deadline": "",
            "venue": "",
            "format": "To be announced",
            "min_team_size": None,
            "max_team_size": None,
            "capacity": None,
            "registration_open": True,
            "event_email": "",
            "organizer": "",
        },
        "missions": [
            {
                "id": "S2C-101",
                "title": "Make campus life flow",
                "category": "Web Development",
                "difficulty": "Medium",
                "description": "Reimagine one everyday campus process that wastes people's time. Build a clear, accessible digital experience that makes the next step obvious.",
                "skills": ["React", "UX", "APIs"],
                "deliverables": ["Working prototype", "Short demo", "README"],
                "evaluation": ["Impact", "Usability", "Technical execution", "Originality"],
                "constraints": ["Use sample data only; do not expose real student records."],
                "use_cases": ["Finding an available study space", "Getting a campus service update"],
                "outcomes": ["A testable prototype and a clear plan for a responsible pilot."],
                "status": "Open",
                "sample": True,
            },
            {
                "id": "S2C-102",
                "title": "Less waste, better days",
                "category": "Sustainability",
                "difficulty": "Easy",
                "description": "Help a community spot a small, measurable opportunity to reduce waste or make a shared resource go further.",
                "skills": ["Data", "Mobile", "Prototyping"],
                "deliverables": ["Working prototype", "Impact hypothesis", "Short demo"],
                "evaluation": ["Practical impact", "Clarity", "Feasibility", "Craft"],
                "constraints": ["Do not claim measured environmental savings without evidence."],
                "use_cases": ["Reuse exchange", "Resource-use awareness"],
                "outcomes": ["A prototype and a simple way to measure its intended impact."],
                "status": "Open",
                "sample": True,
            },
            {
                "id": "S2C-103",
                "title": "Open Innovation",
                "category": "Open Innovation",
                "difficulty": "Hard",
                "description": "Bring a problem worth solving. Define who experiences it, show why current approaches fall short, and propose a thoughtful, testable solution.",
                "skills": ["Research", "Product thinking", "Any stack"],
                "deliverables": ["Problem brief", "Working prototype", "Short demo"],
                "evaluation": ["Problem understanding", "Originality", "Impact", "Execution"],
                "constraints": ["An organizer must approve the problem framing before the team proceeds."],
                "use_cases": ["A problem from your community, workplace, or campus."],
                "outcomes": ["An organizer-reviewed idea and a demonstrable first solution."],
                "status": "Open",
                "sample": True,
            },
        ],
        "registrations": [],
        "teams": [],
        "schedule": [
            {"title": "Registration & team formation", "time": "To be announced", "detail": "Form your flock and choose a mission."},
            {"title": "Opening & mission briefing", "time": "To be announced", "detail": "Get the lay of the land before launch."},
            {"title": "Build session", "time": "To be announced", "detail": "Turn a bold idea into a working prototype."},
            {"title": "Demos & recognition", "time": "To be announced", "detail": "Show what you made and celebrate the flock."},
        ],
        "faqs": [
            {"question": "Who can take part?", "answer": "SHOOT2CODE is an internal event. Eligibility details will be shared by the organizers."},
            {"question": "Do we need a finished idea to register?", "answer": "No. Pick a mission to get started, or propose an Open Innovation idea for organizer approval."},
            {"question": "What should we bring?", "answer": "Bring a laptop, your usual development tools, and a willingness to test ideas. Venue and format details will be confirmed by organizers."},
            {"question": "How are projects judged?", "answer": "Projects are reviewed for impact, originality, usability, and technical execution. Mission-specific criteria appear on each mission card."},
        ],
        "admin": None,
    }


def password_hash(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
    return salt.hex(), digest.hex()


def load_store():
    DATA_DIR.mkdir(exist_ok=True)
    if not STORE_PATH.exists():
        store = new_store()
        admin_password = os.environ.get("S2C_ADMIN_PASSWORD") or secrets.token_urlsafe(15)
        salt, digest = password_hash(admin_password)
        store["admin"] = {
            "email": os.environ.get("S2C_ADMIN_EMAIL", "admin@shoot2code.local").strip().lower(),
            "salt": salt,
            "password_hash": digest,
        }
        STORE_PATH.write_text(json.dumps(store, indent=2), encoding="utf-8")
        if not os.environ.get("S2C_ADMIN_PASSWORD"):
            print(f"Initial admin login: {store['admin']['email']}", flush=True)
            print(f"Initial admin password (shown once): {admin_password}", flush=True)
    else:
        store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        defaults = new_store()
        for key, value in defaults.items():
            if key not in store:
                store[key] = value
        store["config"] = {**defaults["config"], **store.get("config", {})}
        if not store.get("admin"):
            admin_password = os.environ.get("S2C_ADMIN_PASSWORD") or secrets.token_urlsafe(15)
            salt, digest = password_hash(admin_password)
            store["admin"] = {
                "email": os.environ.get("S2C_ADMIN_EMAIL", "admin@shoot2code.local").strip().lower(),
                "salt": salt,
                "password_hash": digest,
            }
            if not os.environ.get("S2C_ADMIN_PASSWORD"):
                print(f"Initial admin login: {store['admin']['email']}", flush=True)
                print(f"Initial admin password (shown once): {admin_password}", flush=True)
        save_store(store)
    return store


def save_store(store):
    DATA_DIR.mkdir(exist_ok=True)
    temp_path = STORE_PATH.with_suffix(".tmp")
    temp_path.write_text(json.dumps(store, indent=2), encoding="utf-8")
    temp_path.replace(STORE_PATH)


STORE = load_store()


def public_team(team):
    project_approved = team.get("project_status") == "Approved"
    return {
        "id": team["id"],
        "name": team["name"],
        "mission_id": team.get("mission_id", ""),
        "project_title": team.get("project_title", "") if project_approved else "",
        "project_summary": team.get("project_summary", "") if project_approved else "",
        "project_submitted": bool(team.get("project_title") and team.get("project_summary")),
        "project_status": team.get("project_status", "Pending"),
        "status": team.get("status", "Registered"),
        "members": [{"name": person["name"], "role": person.get("role", "Member")} for person in team["members"]],
        "score": team.get("score"),
    }


def bootstrap_data():
    with STORE_LOCK:
        teams = [public_team(team) for team in STORE["teams"] if team.get("status") == "Registered"]
        approved_projects = [
            team for team in teams
            if team["project_status"] == "Approved" and team.get("project_title")
        ]
        leaderboard = sorted(
            [team for team in approved_projects if team.get("score") is not None],
            key=lambda team: team["score"],
            reverse=True,
        )[:5]
        return {
            "config": STORE["config"],
            "missions": STORE["missions"],
            "teams": teams,
            "projects": approved_projects,
            "leaderboard": leaderboard,
            "schedule": STORE["schedule"],
            "faqs": STORE["faqs"],
            "registered_teams": len([team for team in STORE["teams"] if team.get("status") == "Registered"]),
        }


def valid_email(value):
    return isinstance(value, str) and len(value) <= 254 and re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value.strip()) is not None


def send_confirmation(email, name, team_id, status="Registered"):
    host = os.environ.get("S2C_SMTP_HOST")
    if not host:
        return "not_configured"
    message = EmailMessage()
    message["Subject"] = "Your SHOOT2CODE registration"
    message["From"] = os.environ.get("S2C_SMTP_FROM", os.environ.get("S2C_SMTP_USER", ""))
    message["To"] = email
    status_text = "is on the waitlist" if status == "Waitlisted" else "is confirmed"
    message.set_content(
        f"Hi {name},\n\nYour SHOOT2CODE team registration {status_text}.\nTeam ID: {team_id}\n\nSee you at launch!"
    )
    try:
        smtp_type = smtplib.SMTP_SSL if os.environ.get("S2C_SMTP_SSL") == "1" else smtplib.SMTP
        with smtp_type(host, int(os.environ.get("S2C_SMTP_PORT", "587")), timeout=10) as smtp:
            if smtp_type is smtplib.SMTP:
                smtp.starttls()
            user = os.environ.get("S2C_SMTP_USER")
            password = os.environ.get("S2C_SMTP_PASSWORD")
            if user and password:
                smtp.login(user, password)
            smtp.send_message(message)
        return "sent"
    except (OSError, ValueError, smtplib.SMTPException) as exc:
        print(f"Registration email delivery failed: {exc}", flush=True)
        return "failed"


class Handler(BaseHTTPRequestHandler):
    server_version = "SHOOT2CODE/1.0"

    def log_message(self, format_string, *args):
        print(f"{self.address_string()} - {format_string % args}", flush=True)

    def send_json(self, status, value, headers=None):
        content = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'")
        if headers:
            for name, value in headers.items():
                self.send_header(name, value)
        self.end_headers()
        self.wfile.write(content)

    def send_static(self, filename, content_type):
        content = (ROOT / filename).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(content)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("Invalid request size.")
        if length < 1 or length > MAX_BODY_SIZE:
            raise ValueError("Request must contain valid JSON under 64 KB.")
        try:
            return json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ValueError("Request body must be valid JSON.")

    def admin_session(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        morsel = cookie.get("s2c_admin")
        token = morsel.value if morsel else ""
        expires = SESSIONS.get(token)
        if expires and expires > time.time():
            return token
        if token:
            SESSIONS.pop(token, None)
        return None

    def require_admin(self):
        if not self.admin_session():
            self.send_json(401, {"error": "Admin sign-in is required."})
            return False
        return True

    def do_GET(self):
        path = urlparse(self.path).path
        if path in STATIC_FILES:
            filename, content_type = STATIC_FILES[path]
            try:
                self.send_static(filename, content_type)
            except OSError:
                self.send_error(404)
            return
        if path == "/api/bootstrap":
            self.send_json(200, bootstrap_data())
            return
        if path.startswith("/api/registration/"):
            registration_id = unquote(path.rsplit("/", 1)[-1])
            with STORE_LOCK:
                registration = next((item for item in STORE["registrations"] if item["id"] == registration_id), None)
                if registration:
                    self.send_json(200, {
                        "id": registration["id"],
                        "team_id": registration["team_id"],
                        "team_name": registration["team_name"],
                        "status": registration["status"],
                    })
                else:
                    self.send_json(404, {"error": "Registration not found. Check the ID and try again."})
            return
        if path == "/api/admin/me":
            self.send_json(200, {"authenticated": bool(self.admin_session())})
            return
        if path == "/api/admin/data":
            if not self.require_admin():
                return
            with STORE_LOCK:
                self.send_json(200, {
                    "config": STORE["config"],
                    "missions": STORE["missions"],
                    "registrations": [
                        {key: value for key, value in item.items() if key != "invite_code"}
                        for item in STORE["registrations"]
                    ],
                    "teams": [
                        {key: value for key, value in team.items() if key != "invite_code"}
                        for team in STORE["teams"]
                    ],
                    "schedule": STORE["schedule"],
                    "faqs": STORE["faqs"],
                    "admin_email": STORE["admin"]["email"],
                })
            return
        self.send_json(404, {"error": "Not found."})

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self.read_json()
        except ValueError as exc:
            self.send_json(400, {"error": str(exc)})
            return
        if not isinstance(body, dict):
            self.send_json(400, {"error": "Request must be a JSON object."})
            return
        if path == "/api/register":
            self.register_team(body)
        elif path == "/api/join":
            self.join_team(body)
        elif path == "/api/admin/login":
            self.admin_login(body)
        elif path == "/api/admin/logout":
            token = self.admin_session()
            if token:
                SESSIONS.pop(token, None)
            self.send_json(200, {"ok": True}, {"Set-Cookie": "s2c_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"})
        elif path == "/api/admin/missions":
            if self.require_admin():
                self.create_mission(body)
        else:
            self.send_json(404, {"error": "Not found."})

    def register_team(self, body):
        name = str(body.get("name", "")).strip()
        email = str(body.get("email", "")).strip().lower()
        team_name = str(body.get("team_name", "")).strip()
        department = str(body.get("department", "")).strip()
        if not name or not team_name or len(name) > 100 or len(team_name) > 80:
            self.send_json(400, {"error": "Enter a participant name and a team name."})
            return
        if not valid_email(email):
            self.send_json(400, {"error": "Enter a valid institutional or employee email address."})
            return
        if not department:
            self.send_json(400, {"error": "Enter your department, branch, or division."})
            return
        if not body.get("consent"):
            self.send_json(400, {"error": "Please agree to the event guidelines and privacy notice."})
            return
        extra_members = body.get("members", [])
        if not isinstance(extra_members, list) or len(extra_members) > 10:
            self.send_json(400, {"error": "Check the team member details and try again."})
            return
        members = [{"name": name, "email": email, "role": "Team lead", "department": department}]
        members[0]["job_role"] = str(body.get("role", "")).strip()[:100]
        members[0]["institution_id"] = str(body.get("institution_id", "")).strip()[:80]
        members[0]["phone"] = str(body.get("phone", "")).strip()[:30]
        members[0]["skills"] = str(body.get("skills", "")).strip()[:200]
        seen_emails = {email}
        for member in extra_members:
            if not isinstance(member, dict):
                self.send_json(400, {"error": "Each team member needs a name and a valid email address."})
                return
            member_name = str(member.get("name", "")).strip()
            member_email = str(member.get("email", "")).strip().lower()
            if not member_name or len(member_name) > 100 or not valid_email(member_email):
                self.send_json(400, {"error": "Each team member needs a name and a valid email address."})
                return
            if member_email in seen_emails:
                self.send_json(400, {"error": "A team cannot include the same email address twice."})
                return
            seen_emails.add(member_email)
            members.append({"name": member_name, "email": member_email, "role": "Member"})
        with STORE_LOCK:
            config = STORE["config"]
            if not config.get("registration_open"):
                self.send_json(403, {"error": "Registration is currently closed."})
                return
            deadline = config.get("registration_deadline")
            if deadline:
                try:
                    if datetime.now(timezone.utc).date() > datetime.fromisoformat(deadline).date():
                        self.send_json(403, {"error": "The registration deadline has passed."})
                        return
                except ValueError:
                    self.send_json(500, {"error": "The configured registration deadline is invalid. Please contact an organizer."})
                    return
            team_size = len(members)
            minimum = config.get("min_team_size")
            maximum = config.get("max_team_size")
            if minimum and team_size < minimum:
                self.send_json(400, {"error": f"Teams need at least {minimum} participants."})
                return
            if maximum and team_size > maximum:
                self.send_json(400, {"error": f"Teams can have no more than {maximum} participants."})
                return
            known_emails = {
                person["email"].lower()
                for team in STORE["teams"]
                for person in team["members"]
            }
            duplicate = next((value for value in seen_emails if value in known_emails), None)
            if duplicate:
                self.send_json(409, {"error": f"{duplicate} is already registered. Use the team invitation flow if you need to join an existing team."})
                return
            mission_id = str(body.get("mission_id", "")).strip()
            mission = next((item for item in STORE["missions"] if item["id"] == mission_id), None)
            if not mission or mission["status"] != "Open":
                self.send_json(400, {"error": "Choose an open mission or the Open Innovation track."})
                return
            team_id = "TEAM-" + secrets.token_hex(3).upper()
            registration_id = "S2C-" + secrets.token_hex(12).upper()
            invite_code = secrets.token_urlsafe(6).upper()
            registered_count = sum(1 for team in STORE["teams"] if team.get("status") == "Registered")
            status = "Waitlisted" if config.get("capacity") and registered_count >= config["capacity"] else "Registered"
            team = {
                "id": team_id,
                "name": team_name,
                "mission_id": mission_id,
                "project_title": str(body.get("project_title", "")).strip()[:100],
                "project_summary": str(body.get("project_summary", "")).strip()[:1000],
                "project_status": "Pending",
                "status": status,
                "members": members,
                "invite_code": invite_code,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            registration = {
                "id": registration_id,
                "team_id": team_id,
                "team_name": team_name,
                "leader": name,
                "email": email,
                "institution_id": members[0]["institution_id"],
                "department": department,
                "job_role": members[0]["job_role"],
                "phone": members[0]["phone"],
                "skills": members[0]["skills"],
                "status": status,
                "created_at": team["created_at"],
            }
            STORE["teams"].append(team)
            STORE["registrations"].append(registration)
            save_store(STORE)
        email_results = [send_confirmation(person["email"], person["name"], team_id, status) for person in members]
        email_status = "not_configured" if all(result == "not_configured" for result in email_results) else "failed" if "failed" in email_results else "sent"
        self.send_json(201, {
            "id": registration_id,
            "team_id": team_id,
            "team_name": team_name,
            "invite_code": invite_code,
            "status": status,
            "email_status": email_status,
        })

    def join_team(self, body):
        name = str(body.get("name", "")).strip()
        email = str(body.get("email", "")).strip().lower()
        invite_code = str(body.get("invite_code", "")).strip().upper()
        if not name or not valid_email(email) or not invite_code:
            self.send_json(400, {"error": "Enter your name, a valid email address, and the team invitation code."})
            return
        if not body.get("consent"):
            self.send_json(400, {"error": "Please agree to the event guidelines and privacy notice."})
            return
        with STORE_LOCK:
            team = next((item for item in STORE["teams"] if hmac.compare_digest(item["invite_code"], invite_code)), None)
            if not team:
                self.send_json(404, {"error": "That invitation code was not found. Check with your team lead."})
                return
            if team.get("status") != "Registered":
                self.send_json(403, {"error": "This team is not currently accepting members."})
                return
            known_emails = {
                person["email"].lower()
                for existing in STORE["teams"]
                for person in existing["members"]
            }
            if email in known_emails:
                self.send_json(409, {"error": "This email address is already registered."})
                return
            maximum = STORE["config"].get("max_team_size")
            if maximum and len(team["members"]) >= maximum:
                self.send_json(400, {"error": "This team has reached its configured size limit."})
                return
            team["members"].append({"name": name[:100], "email": email, "role": "Member"})
            registration = {
                "id": "S2C-" + secrets.token_hex(12).upper(),
                "team_id": team["id"],
                "team_name": team["name"],
                "leader": name[:100],
                "email": email,
                "institution_id": "",
                "department": "",
                "job_role": "",
                "phone": "",
                "skills": "",
                "status": "Registered",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            STORE["registrations"].append(registration)
            save_store(STORE)
        email_status = send_confirmation(email, name, team["id"])
        self.send_json(201, {
            "id": registration["id"],
            "team_id": team["id"],
            "team_name": team["name"],
            "status": "Registered",
            "email_status": email_status,
        })

    def admin_login(self, body):
        address = self.client_address[0]
        failures = LOGIN_ATTEMPTS.get(address, [])
        now = time.time()
        failures = [stamp for stamp in failures if now - stamp < 300]
        if len(failures) >= 8:
            self.send_json(429, {"error": "Too many sign-in attempts. Try again in a few minutes."})
            return
        email = str(body.get("email", "")).strip().lower()
        password = body.get("password", "")
        admin = STORE["admin"]
        supplied = password_hash(password, bytes.fromhex(admin["salt"]))[1] if isinstance(password, str) else ""
        if email != admin["email"] or not hmac.compare_digest(supplied, admin["password_hash"]):
            failures.append(now)
            LOGIN_ATTEMPTS[address] = failures
            self.send_json(401, {"error": "Email or password is incorrect."})
            return
        LOGIN_ATTEMPTS.pop(address, None)
        token = secrets.token_urlsafe(32)
        SESSIONS[token] = now + SESSION_TTL
        self.send_json(200, {"ok": True}, {
            "Set-Cookie": f"s2c_admin={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_TTL}{'; Secure' if os.environ.get('S2C_COOKIE_SECURE') == '1' else ''}"
        })

    def create_mission(self, body):
        mission = self.clean_mission(body)
        if not mission:
            return
        with STORE_LOCK:
            if any(item["id"].lower() == mission["id"].lower() for item in STORE["missions"]):
                self.send_json(409, {"error": "That mission ID is already in use."})
                return
            STORE["missions"].append(mission)
            save_store(STORE)
        self.send_json(201, {"mission": mission})

    def clean_mission(self, body, existing=None):
        mission_id = str(body.get("id", existing.get("id", "") if existing else "")).strip().upper()
        title = str(body.get("title", existing.get("title", "") if existing else "")).strip()
        description = str(body.get("description", existing.get("description", "") if existing else "")).strip()
        category = str(body.get("category", existing.get("category", "") if existing else "")).strip()
        difficulty = str(body.get("difficulty", existing.get("difficulty", "") if existing else "")).strip()
        status = str(body.get("status", existing.get("status", "Open") if existing else "Open")).strip()
        if not mission_id or not re.fullmatch(r"[A-Z0-9-]{3,30}", mission_id) or not title or not description:
            self.send_json(400, {"error": "Enter a valid mission ID, title, and description."})
            return None
        if category not in {"AI/ML", "Web Development", "Mobile Applications", "Automation", "Sustainability", "Cybersecurity", "Open Innovation", "Other"}:
            self.send_json(400, {"error": "Choose a valid mission category."})
            return None
        if difficulty not in {"Easy", "Medium", "Hard"} or status not in {"Open", "Locked", "Closed"}:
            self.send_json(400, {"error": "Choose a valid difficulty and mission status."})
            return None
        def list_field(key):
            value = body.get(key, existing.get(key, []) if existing else [])
            if isinstance(value, str):
                value = value.splitlines()
            if not isinstance(value, list):
                return []
            return [str(item).strip()[:200] for item in value if str(item).strip()][:20]
        return {
            "id": mission_id,
            "title": title[:100],
            "category": category,
            "difficulty": difficulty,
            "description": description[:2000],
            "skills": list_field("skills"),
            "deliverables": list_field("deliverables"),
            "evaluation": list_field("evaluation"),
            "constraints": list_field("constraints"),
            "use_cases": list_field("use_cases"),
            "outcomes": list_field("outcomes"),
            "status": status,
            "sample": False,
        }

    def do_PUT(self):
        path = urlparse(self.path).path
        try:
            body = self.read_json()
        except ValueError as exc:
            self.send_json(400, {"error": str(exc)})
            return
        if not self.require_admin():
            return
        if path == "/api/admin/config":
            self.update_config(body)
        elif path == "/api/admin/content":
            self.update_content(body)
        else:
            self.send_json(404, {"error": "Not found."})

    def update_content(self, body):
        schedule = body.get("schedule")
        faqs = body.get("faqs")
        if not isinstance(schedule, list) or not isinstance(faqs, list) or len(schedule) > 30 or len(faqs) > 40:
            self.send_json(400, {"error": "Schedule and FAQ content must be valid lists."})
            return
        clean_schedule = []
        for item in schedule:
            if not isinstance(item, dict):
                self.send_json(400, {"error": "Each schedule item needs a title, time, and description."})
                return
            title = str(item.get("title", "")).strip()
            if not title:
                self.send_json(400, {"error": "Each schedule item needs a title."})
                return
            clean_schedule.append({
                "title": title[:120],
                "time": str(item.get("time", "")).strip()[:100],
                "detail": str(item.get("detail", "")).strip()[:500],
            })
        clean_faqs = []
        for item in faqs:
            if not isinstance(item, dict):
                self.send_json(400, {"error": "Each FAQ needs a question and answer."})
                return
            question = str(item.get("question", "")).strip()
            answer = str(item.get("answer", "")).strip()
            if not question or not answer:
                self.send_json(400, {"error": "Each FAQ needs both a question and an answer."})
                return
            clean_faqs.append({"question": question[:200], "answer": answer[:1000]})
        with STORE_LOCK:
            STORE["schedule"] = clean_schedule
            STORE["faqs"] = clean_faqs
            save_store(STORE)
        self.send_json(200, {"schedule": clean_schedule, "faqs": clean_faqs})

    def update_config(self, body):
        date_fields = {"start_date", "end_date", "registration_deadline"}
        integer_fields = {"min_team_size", "max_team_size", "capacity"}
        text_fields = {"event_name", "tagline", "venue", "format", "event_email", "organizer"}
        config = dict(STORE["config"])
        for key in date_fields:
            value = str(body.get(key, config.get(key, ""))).strip()
            if value:
                try:
                    datetime.strptime(value, "%Y-%m-%d")
                except ValueError:
                    self.send_json(400, {"error": f"{key.replace('_', ' ').capitalize()} must use YYYY-MM-DD format."})
                    return
            config[key] = value
        for key in integer_fields:
            value = body.get(key, config.get(key))
            if value in ("", None):
                config[key] = None
            elif isinstance(value, int) and not isinstance(value, bool) and value > 0:
                config[key] = value
            else:
                self.send_json(400, {"error": f"{key.replace('_', ' ').capitalize()} must be a positive whole number or blank."})
                return
        minimum, maximum = config.get("min_team_size"), config.get("max_team_size")
        if minimum and maximum and minimum > maximum:
            self.send_json(400, {"error": "Minimum team size cannot exceed maximum team size."})
            return
        for key in text_fields:
            value = str(body.get(key, config.get(key, ""))).strip()
            if len(value) > 200:
                self.send_json(400, {"error": f"{key.replace('_', ' ').capitalize()} is too long."})
                return
            config[key] = value
        config["registration_open"] = bool(body.get("registration_open", config.get("registration_open", False)))
        with STORE_LOCK:
            STORE["config"] = config
            save_store(STORE)
        self.send_json(200, {"config": config})

    def do_PATCH(self):
        path = urlparse(self.path).path
        try:
            body = self.read_json()
        except ValueError as exc:
            self.send_json(400, {"error": str(exc)})
            return
        if not self.require_admin():
            return
        if path.startswith("/api/admin/missions/"):
            mission_id = unquote(path.rsplit("/", 1)[-1])
            with STORE_LOCK:
                index = next((i for i, item in enumerate(STORE["missions"]) if item["id"] == mission_id), None)
                if index is None:
                    self.send_json(404, {"error": "Mission not found."})
                    return
                updated = self.clean_mission(body, STORE["missions"][index])
                if not updated:
                    return
                updated["id"] = STORE["missions"][index]["id"]
                STORE["missions"][index] = updated
                save_store(STORE)
            self.send_json(200, {"mission": updated})
        elif path.startswith("/api/admin/teams/"):
            team_id = unquote(path.rsplit("/", 1)[-1])
            status = body.get("project_status")
            if status not in {"Pending", "Approved", "Needs changes"}:
                self.send_json(400, {"error": "Choose Pending, Approved, or Needs changes."})
                return
            with STORE_LOCK:
                team = next((item for item in STORE["teams"] if item["id"] == team_id), None)
                if not team:
                    self.send_json(404, {"error": "Team not found."})
                    return
                if "score" in body:
                    score = body["score"]
                    if score in ("", None):
                        score_to_save = None
                    elif isinstance(score, (int, float)) and 0 <= score <= 100:
                        score_to_save = score
                    else:
                        self.send_json(400, {"error": "Leaderboard score must be between 0 and 100."})
                        return
                else:
                    score_to_save = team.get("score")
                team["project_status"] = status
                if score_to_save is None:
                    team.pop("score", None)
                else:
                    team["score"] = score_to_save
                save_store(STORE)
            self.send_json(200, {"team": public_team(team)})
        elif path.startswith("/api/admin/registrations/"):
            registration_id = unquote(path.rsplit("/", 1)[-1])
            status = body.get("status")
            if status not in {"Registered", "Waitlisted", "Withdrawn"}:
                self.send_json(400, {"error": "Choose Registered, Waitlisted, or Withdrawn."})
                return
            with STORE_LOCK:
                registration = next((item for item in STORE["registrations"] if item["id"] == registration_id), None)
                if not registration:
                    self.send_json(404, {"error": "Registration not found."})
                    return
                team = next((item for item in STORE["teams"] if item["id"] == registration["team_id"]), None)
                if status == "Registered" and team and team.get("status") != "Registered":
                    capacity = STORE["config"].get("capacity")
                    registered_count = sum(1 for item in STORE["teams"] if item.get("status") == "Registered")
                    if capacity and registered_count >= capacity:
                        self.send_json(409, {"error": "Team capacity is full. Increase the configured capacity before promoting this team."})
                        return
                registration["status"] = status
                if team and registration["email"].lower() == team["members"][0]["email"].lower():
                    team["status"] = status
                    for other in STORE["registrations"]:
                        if other["team_id"] == team["id"]:
                            other["status"] = status
                save_store(STORE)
            self.send_json(200, {"registration": {key: value for key, value in registration.items() if key != "invite_code"}})
        else:
            self.send_json(404, {"error": "Not found."})

    def do_DELETE(self):
        path = urlparse(self.path).path
        if not self.require_admin():
            return
        if path.startswith("/api/admin/missions/"):
            mission_id = unquote(path.rsplit("/", 1)[-1])
            with STORE_LOCK:
                mission = next((item for item in STORE["missions"] if item["id"] == mission_id), None)
                if not mission:
                    self.send_json(404, {"error": "Mission not found."})
                    return
                if any(team.get("mission_id") == mission_id for team in STORE["teams"]):
                    mission["status"] = "Closed"
                else:
                    STORE["missions"].remove(mission)
                save_store(STORE)
            self.send_json(200, {"ok": True})
        else:
            self.send_json(404, {"error": "Not found."})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"SHOOT2CODE is running at http://127.0.0.1:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nSHOOT2CODE server stopped.", flush=True)
