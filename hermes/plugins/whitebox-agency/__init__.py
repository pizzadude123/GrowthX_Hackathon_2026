"""Whitebox's constrained Hermes Telegram command surface."""
from __future__ import annotations

import asyncio
import json
import os
import re
import shlex
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


def _control_sync(path: str, body: dict[str, Any]) -> dict[str, Any]:
    base = os.environ.get("WHITEBOX_CONTROL_PLANE_URL", "").rstrip("/")
    token = os.environ.get("WHITEBOX_COMMAND_TOKEN", "")
    if not base or len(token) < 32:
        raise RuntimeError("Whitebox control plane is not configured")
    if urllib.parse.urlparse(base).scheme != "https":
        raise RuntimeError("Whitebox control plane requires HTTPS")
    request = urllib.request.Request(
        f"{base}{path}",
        data=json.dumps(body).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read()).get("error", "request failed")
            except Exception:
                detail = "request failed"
            if error.code in {408, 425, 429, 500, 502, 503, 504} and attempt < 2:
                time.sleep(0.5 * (2 ** attempt))
                continue
            raise RuntimeError(f"{detail} (HTTP {error.code})") from error
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt < 2:
                time.sleep(0.5 * (2 ** attempt))
                continue
            raise RuntimeError("Whitebox control plane is temporarily unavailable") from error
    raise RuntimeError("Whitebox control plane is temporarily unavailable")


async def _control(path: str, body: dict[str, Any]) -> dict[str, Any]:
    return await asyncio.to_thread(_control_sync, path, body)


def _repository(raw: str) -> tuple[str, str]:
    value = raw.strip().rstrip("/")
    short = re.fullmatch(r"([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?", value)
    if short:
        owner, name = short.groups()
        return f"https://github.com/{owner}/{name}", f"{owner}/{name}"
    parsed = urllib.parse.urlparse(value)
    parts = [part for part in parsed.path.split("/") if part]
    if parsed.scheme != "https" or parsed.netloc.lower() != "github.com" or len(parts) < 2:
        raise ValueError("Usage: /whitebox OWNER/REPO or https://github.com/OWNER/REPO")
    owner, name = parts[0], re.sub(r"\.git$", "", parts[1])
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", owner) or not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
        raise ValueError("Usage: /whitebox OWNER/REPO or https://github.com/OWNER/REPO")
    return f"https://github.com/{owner}/{name}", f"{owner}/{name}"


def _parse_start(raw: str) -> tuple[str, str]:
    try:
        tokens = shlex.split(raw)
    except ValueError as error:
        raise ValueError(f"Invalid command quoting: {error}") from error
    if not tokens:
        raise ValueError('Usage: /whitebox OWNER/REPO --goal "stabilize checkout"')
    repository, _ = _repository(tokens[0])
    if len(tokens) == 1:
        return repository, "stabilize critical flows"
    if tokens[1] != "--goal":
        raise ValueError(f"Unknown option: {tokens[1]}. Only --goal is supported.")
    goal = " ".join(tokens[2:]).strip()
    if not goal:
        raise ValueError("--goal requires a short description")
    if len(goal) > 240:
        raise ValueError("Goal must be 240 characters or fewer")
    return repository, goal


def _run_id(raw: str) -> str:
    value = raw.strip().upper()
    if not re.fullmatch(r"WB-[A-Z0-9]+", value):
        raise ValueError("Provide a run ID, for example: WB-123")
    return value


def _identity(event: Any = None) -> dict[str, str]:
    source = getattr(event, "source", None)
    result: dict[str, str] = {}
    for source_name, target_name in (("user_id", "telegramUserId"), ("chat_id", "telegramChatId"), ("thread_id", "telegramThreadId")):
        value = getattr(source, source_name, None)
        if value is not None:
            result[target_name] = str(value)
    return result


async def _start(raw: str, event: Any = None) -> str:
    try:
        repo, goal = _parse_start(raw)
        result = await _control("/api/runs/start", {"repoUrl": repo, "goal": goal, **_identity(event)})
        mode = "Audit only"
        return (
            f"🧭 {result['publicId']} · Accepted\n\n"
            f"Repo: {result['repository']}\nMode: {mode}\nGoal: {goal}\n\n"
            "I’ll send the final audit and PDF here automatically.\n\n"
            "Next commands:\n"
            f"• /whitebox-status {result['publicId']}\n"
            f"• /findings {result['publicId']}\n"
            f"• /whitebox-next {result['publicId']}\n\n"
            f"Dashboard: {result['dashboardUrl']}"
        )
    except Exception as error:
        return f"⚠️ Whitebox could not accept this run\n\n{error}"


async def _load(raw: str, event: Any = None) -> dict[str, Any]:
    return await _control("/api/runs/status", {"publicId": _run_id(raw), **_identity(event)})


async def _status(raw: str, event: Any = None) -> str:
    try:
        data = await _load(raw, event); run = data["run"]
        counts = f"Files: {run['mappedFiles']} · Flows: {run['flowCount']} · Confirmed: {run['confirmedFindingCount']} · Rejected: {run['rejectedFindingCount']}"
        return f"🧭 {run['publicId']} · {run['currentStage']}\n\nRepo: {run['repository']}\n{counts}\nDelivery: {run.get('deliveryStatus', 'pending')}\nMode: audit only\n\nDashboard:\n{os.environ.get('PUBLIC_APP_URL','')}/runs/{run['publicId']}"
    except Exception as error:
        return f"⚠️ Status unavailable: {error}"


async def _findings(raw: str, event: Any = None) -> str:
    try:
        data = await _load(raw, event); rows = [row for row in data.get("findings", []) if row.get("status") in {"confirmed", "probable"}][:4]
        body = "\n".join(f"• {row['severity'].upper()} · {row['title']}" for row in rows) or "No active verified findings yet."
        return f"🔎 {data['run']['publicId']} · Findings\n\n{body}\n\nRemediation guidance: /whitebox-next {data['run']['publicId']}\nDashboard: {os.environ.get('PUBLIC_APP_URL','')}/runs/{data['run']['publicId']}"
    except Exception as error:
        return f"⚠️ Findings unavailable: {error}"



async def _dependencies(raw: str, event: Any = None) -> str:
    try:
        data = await _load(raw, event); rows = data.get("dependencies", [])[:4]
        body = "\n".join(f"• {row['packageName']} · {row['data']['classification']}" for row in rows) or "No dependency risks persisted yet."
        return f"📦 {data['run']['publicId']} · Dependencies\n\n{body}\n\nDashboard: {os.environ.get('PUBLIC_APP_URL','')}/runs/{data['run']['publicId']}"
    except Exception as error:
        return f"⚠️ Dependencies unavailable: {error}"


def _open(raw: str) -> str:
    try:
        run_id = _run_id(raw)
        return f"Open Whitebox:\n{os.environ.get('PUBLIC_APP_URL','')}/runs/{run_id}"
    except Exception as error:
        return f"⚠️ {error}"


async def _memory(raw: str, event: Any = None) -> str:
    try:
        _, repository = _repository(raw)
        data = await _control("/api/repositories/memory", {"repository": repository, **_identity(event)})
        snapshot = data.get("outputSchemaSnapshotId") or "pending"
        return f"🧠 {data['repository']} · Repository memory\n\nLatest run: {data['publicId']}\nStatus: {data['status']}\nSchema: {snapshot}\n\nDashboard: {os.environ.get('PUBLIC_APP_URL','')}/runs/{data['publicId']}"
    except Exception as error:
        return f"⚠️ Repository memory unavailable: {error}"


async def _action(raw: str, action: str, event: Any = None) -> str:
    try:
        public_id = _run_id(raw)
        identity = _identity(event)
        if not identity.get("telegramUserId"):
            raise ValueError("This control command must be sent from Telegram")
        await _control("/api/runs/action", {"publicId": public_id, "action": action, **identity})
        label = {"pause": "paused", "resume": "resumed", "cancel": "cancelled"}[action]
        return f"✅ {public_id} · {label}\n\nDashboard: {os.environ.get('PUBLIC_APP_URL','')}/runs/{public_id}"
    except Exception as error:
        return f"⚠️ Run control unavailable: {error}"


async def _pause(raw: str, event: Any = None) -> str:
    return await _action(raw, "pause", event)


async def _resume(raw: str, event: Any = None) -> str:
    return await _action(raw, "resume", event)


async def _cancel(raw: str, event: Any = None) -> str:
    return await _action(raw, "cancel", event)


def _guide(_: str) -> str:
    return (
        "🧭 Whitebox quick start\n\n"
        "1. Start a read-only audit\n"
        "/whitebox OWNER/REPO --goal \"review critical flows\"\n\n"
        "2. Track and inspect it\n"
        "/whitebox-status RUN-ID\n"
        "/findings RUN-ID\n"
        "/dependencies RUN-ID\n"
        "/whitebox-open RUN-ID\n\n"
        "3. Remediate verified issues\n"
        "/whitebox-next RUN-ID\n\n"
        "Whitebox does not edit repositories, execute submitted code, or open PRs. "
        "Use its exact evidence and recommendations in your own coding workspace, test the change, then Run Whitebox again to audit the new commit.\n\n"
        "Other commands\n"
        "/memory OWNER/REPO\n"
        "/whitebox-pause RUN-ID\n"
        "/whitebox-resume RUN-ID\n"
        "/whitebox-cancel RUN-ID"
    )


def _help(raw: str) -> str:
    return _guide(raw)


async def _next_steps(raw: str, event: Any = None) -> str:
    try:
        data = await _load(raw, event)
        run = data["run"]
        rows = [row for row in data.get("findings", []) if row.get("status") in {"confirmed", "needs_human_review"}][:4]
        recommendations = "\n".join(
            f"• {row['severity'].upper()} · {row['title']}\n  Next action: {row['recommendation']}"
            for row in rows
        ) or "No active verified finding needs remediation."
        rerun = f'/whitebox {run["repository"]} --goal "verify the remediation from {run["publicId"]}"'
        return (
            f"🛠 {run['publicId']} · Remediation handoff\n\n"
            "Whitebox does not edit repositories or publish pull requests. Apply these advisory actions with a developer or coding agent in your own trusted workspace:\n\n"
            f"{recommendations}\n\n"
            "After changing and testing the repository, push the new commit and Run Whitebox again:\n"
            f"{rerun}\n\n"
            f"Evidence: {os.environ.get('PUBLIC_APP_URL','')}/runs/{run['publicId']}"
        )
    except Exception as error:
        return f"⚠️ Remediation guidance unavailable: {error}"


def register(ctx: Any) -> None:
    commands = [
        ("whitebox", _start, "Start a Whitebox repository run", '<repo-url> --goal "..."'),
        ("whitebox-guide", _guide, "Show the Whitebox audit and remediation workflow", ""),
        ("whitebox-status", _status, "Show live Whitebox run status", "<run-id>"),
        ("findings", _findings, "Show verified findings", "<run-id>"),
        ("whitebox-next", _next_steps, "Show advisory remediation steps and re-audit command", "<run-id>"),
        ("dependencies", _dependencies, "Show dependency risks", "<run-id>"),
        ("memory", _memory, "Show the latest repository memory", "<owner/repo>"),
        ("whitebox-open", _open, "Open a live Whitebox run", "<run-id>"),
        ("whitebox-pause", _pause, "Pause a running Whitebox audit", "<run-id>"),
        ("whitebox-resume", _resume, "Resume a paused Whitebox audit", "<run-id>"),
        ("whitebox-cancel", _cancel, "Cancel a Whitebox audit safely", "<run-id>"),
    ]
    for name, handler, description, hint in commands:
        ctx.register_command(name, handler=handler, description=description, args_hint=hint)
    # /help is a Hermes built-in, so Whitebox's commands appear there automatically.
