#!/usr/bin/env python3
"""Versioned stdio companion for the notebooklm-py CLI."""

from __future__ import annotations

import hashlib
import json
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

PROTOCOL_VERSION = 1
VERSION = "0.1.0"
KINDS = ("audio", "video", "slide-deck", "infographic", "quiz", "flashcards", "report", "data-table", "mind-map")
GENERATE_TIMEOUTS = {"audio": 1200, "video": 1800, "slide-deck": 1200, "infographic": 900}
DEFAULT_GENERATE_TIMEOUT = 300
GENERATE_ATTEMPTS = 3  # one initial attempt plus --retry 2
DEFAULT_CLI_TIMEOUT = 1900
HEARTBEAT_SECONDS = 30
ACTIVE_PROCESS: subprocess.Popen[str] | None = None
EMIT_LOCK = threading.Lock()


def emit(request_id: str, event_type: str, **payload: Any) -> None:
    with EMIT_LOCK:
        print(json.dumps({"protocolVersion": PROTOCOL_VERSION, "requestId": request_id, "type": event_type, **payload}), flush=True)


def generate_timeout(kind: str) -> int:
    return GENERATE_TIMEOUTS.get(kind, DEFAULT_GENERATE_TIMEOUT)


def heartbeat_loop(request_id: str, message: str, stop: threading.Event) -> None:
    started = time.monotonic()
    while not stop.wait(HEARTBEAT_SECONDS):
        if stop.is_set():
            return
        elapsed = int(time.monotonic() - started)
        emit(request_id, "progress", stage="waiting", message=f"{message} - {elapsed // 60}m {elapsed % 60:02d}s elapsed, still waiting on NotebookLM")


def validate_request(request: dict[str, Any]) -> None:
    if request.get("protocolVersion") != PROTOCOL_VERSION:
        raise ValueError("Unsupported protocol version.")
    if request.get("operation") not in {"preflight", "generate", "delete_notebook"} or not isinstance(request.get("requestId"), str):
        raise ValueError("Invalid bridge request.")
    for artifact in request.get("artifacts", []):
        if artifact.get("kind") not in KINDS:
            raise ValueError("Unsupported artifact type.")


def build_generate_args(kind: str, notebook_id: str, prompt_path: str, language: str) -> list[str]:
    common = ["-n", notebook_id, "--json"]
    if kind == "mind-map":
        instructions = Path(prompt_path).read_text(encoding="utf-8")
        return ["generate", kind, "--kind", "interactive", "--instructions", instructions, "--language", language, *common]
    args = ["generate", kind, "--prompt-file", prompt_path, "--wait", "--timeout", str(generate_timeout(kind)), "--retry", "2", *common]
    if kind not in {"quiz", "flashcards"}:
        args.extend(["--language", language])
    if kind == "slide-deck":
        args.extend(["--format", "detailed"])
    elif kind == "report":
        args.extend(["--format", "briefing-doc"])
    return args


def parse_json(stdout: str) -> dict[str, Any]:
    try:
        value = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("notebooklm-py returned an unreadable response.") from exc
    if not isinstance(value, dict):
        raise RuntimeError("notebooklm-py returned an unexpected response.")
    return value


def extract_id(value: dict[str, Any], *keys: str) -> str:
    for key in keys:
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate:
            return candidate
    for nested_key in ("notebook", "source", "artifact", "result"):
        nested = value.get(nested_key)
        if isinstance(nested, dict) and isinstance(nested.get("id"), str):
            return nested["id"]
    raise RuntimeError("notebooklm-py did not return the expected identifier.")


def terminate_active_process() -> None:
    global ACTIVE_PROCESS
    process = ACTIVE_PROCESS
    if process is None or process.poll() is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
        process.wait(timeout=5)
    except Exception:
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
        except Exception:
            pass


def handle_termination(_signum: int, _frame: Any) -> None:
    terminate_active_process()
    raise InterruptedError("Generation was cancelled.")


def run_cli(profile: str, args: list[str], request_id: str = "", heartbeat: str = "", timeout_seconds: int = DEFAULT_CLI_TIMEOUT) -> dict[str, Any]:
    global ACTIVE_PROCESS
    prefix = ["notebooklm"]
    if profile and profile != "default":
        prefix.extend(["--profile", profile])
    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    ACTIVE_PROCESS = subprocess.Popen(
        prefix + args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        shell=False,
        start_new_session=os.name == "posix",
        creationflags=creationflags,
    )
    stop_heartbeat = threading.Event()
    if request_id and heartbeat:
        threading.Thread(target=heartbeat_loop, args=(request_id, heartbeat, stop_heartbeat), daemon=True).start()
    try:
        stdout, _stderr = ACTIVE_PROCESS.communicate(timeout=timeout_seconds)
        if ACTIVE_PROCESS.returncode != 0:
            raise RuntimeError("notebooklm-py could not complete the operation. Run 'notebooklm auth check --test --json' in a terminal for safe diagnostics.")
        return parse_json(stdout)
    except subprocess.TimeoutExpired as exc:
        terminate_active_process()
        raise RuntimeError("notebooklm-py timed out before the operation completed.") from exc
    finally:
        stop_heartbeat.set()
        ACTIVE_PROCESS = None


def safe_output(output_dir: str, filename: str) -> Path:
    if not filename or Path(filename).name != filename or filename in {".", ".."}:
        raise ValueError("Unsafe output filename.")
    root = Path(output_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    candidate = (root / filename).resolve()
    if candidate.parent != root:
        raise ValueError("Output path escaped staging directory.")
    return candidate


def download_args(kind: str, notebook_id: str, artifact_id: str, path: Path) -> list[str]:
    args = ["download", kind, str(path), "-n", notebook_id, "-a", artifact_id, "--no-clobber", "--json"]
    if kind == "slide-deck":
        args.extend(["--format", "pptx"])
    elif kind in {"quiz", "flashcards"}:
        args.extend(["--format", "markdown"])
    return args


def main() -> int:
    request_id = "unknown"
    request: dict[str, Any] = {}
    notebook_id = ""
    signal.signal(signal.SIGTERM, handle_termination)
    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, handle_termination)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, handle_termination)
    try:
        request = json.loads(sys.stdin.readline())
        validate_request(request)
        request_id = request["requestId"]
        emit(request_id, "hello", companionVersion=VERSION, capabilities=list(KINDS))
        profile = request.get("profile", "default")
        if not isinstance(profile, str) or not profile or len(profile) > 64 or not profile[0].isalnum() or any(char not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for char in profile):
            raise ValueError("Invalid NotebookLM profile name.")
        if request["operation"] == "preflight":
            run_cli(profile, ["doctor", "--json"])
            emit(request_id, "complete", notebookId="", keptRemoteNotebook=True)
            return 0
        if request["operation"] == "delete_notebook":
            cleanup_id = request.get("notebookId")
            if not isinstance(cleanup_id, str) or not cleanup_id:
                raise ValueError("A notebook ID is required for cleanup.")
            run_cli(profile, ["delete", "-n", cleanup_id, "-y", "--json"])
            emit(request_id, "complete", notebookId=cleanup_id, keptRemoteNotebook=False)
            return 0

        bundle_inputs = [Path(item) for item in request.get("bundlePaths", [])]
        if not bundle_inputs or any(bundle.is_symlink() for bundle in bundle_inputs):
            raise ValueError("Curated source bundle is missing or unsafe.")
        bundles = [bundle.resolve() for bundle in bundle_inputs]
        if any(not bundle.is_file() for bundle in bundles):
            raise ValueError("Curated source bundle is missing or unsafe.")
        prompt_input = Path(request["promptPath"])
        if prompt_input.is_symlink():
            raise ValueError("Artifact instruction file is missing or unsafe.")
        prompt_path = prompt_input.resolve()
        if not prompt_path.is_file():
            raise ValueError("Artifact instruction file is missing or unsafe.")
        emit(request_id, "progress", stage="creating", message="Creating a private NotebookLM notebook")
        created = run_cli(profile, ["create", "--json", "--", request["notebookTitle"]])
        notebook_id = extract_id(created, "notebook_id", "id")
        emit(request_id, "notebook_created", notebookId=notebook_id)
        for bundle_index, bundle in enumerate(bundles, start=1):
            emit(request_id, "progress", stage="uploading", message=f"Uploading approved simplified source {bundle_index} of {len(bundles)} to Google NotebookLM")
            source = run_cli(profile, ["source", "add", str(bundle), "--type", "file", "-n", notebook_id, "--json"])
            source_id = extract_id(source, "source_id", "id")
            emit(request_id, "progress", stage="indexing", message=f"Waiting for simplified source {bundle_index} of {len(bundles)} to finish indexing")
            run_cli(
                profile,
                ["source", "wait", source_id, "-n", notebook_id, "--timeout", "600", "--json"],
                request_id,
                f"Still indexing simplified source {bundle_index} of {len(bundles)}",
                720,
            )

        artifacts = request.get("artifacts", [])
        for index, artifact in enumerate(artifacts, start=1):
            kind = artifact["kind"]
            emit(request_id, "progress", stage="generating", message=f"Generating {artifact['label']}", current=index, total=len(artifacts))
            generated = run_cli(
                profile,
                build_generate_args(kind, notebook_id, str(prompt_path), request.get("language", "en")),
                request_id,
                f"Still generating {artifact['label']}",
                GENERATE_ATTEMPTS * generate_timeout(kind) + 120,
            )
            artifact_id = extract_id(generated, "artifact_id", "task_id", "id", "note_id")
            target = safe_output(request["outputDir"], artifact["filename"])
            emit(request_id, "progress", stage="downloading", message=f"Downloading {artifact['label']}", current=index, total=len(artifacts))
            run_cli(profile, download_args(kind, notebook_id, artifact_id, target), request_id, f"Still downloading {artifact['label']}")
            digest = hashlib.sha256(target.read_bytes()).hexdigest()
            emit(request_id, "artifact_ready", artifact={"kind": kind, "relativePath": target.name, "size": target.stat().st_size, "sha256": digest})

        keep = bool(request.get("keepRemoteNotebook", True))
        if not keep:
            emit(request_id, "progress", stage="cleanup", message="Removing the temporary remote notebook")
            run_cli(profile, ["delete", "-n", notebook_id, "-y", "--json"])
        emit(request_id, "complete", notebookId=notebook_id, keptRemoteNotebook=keep)
        return 0
    except Exception as exc:  # boundary: convert all errors into one safe protocol event
        terminate_active_process()
        if notebook_id and request.get("keepRemoteNotebook") is False:
            try:
                run_cli(request.get("profile", "default"), ["delete", "-n", notebook_id, "-y", "--json"])
            except Exception:
                pass
        if isinstance(exc, FileNotFoundError):
            message = "The notebooklm command was not found. Install the pinned notebooklm-py prerequisite and restart Obsidian."
        elif isinstance(exc, InterruptedError):
            message = "Generation was cancelled."
        elif isinstance(exc, (ValueError, RuntimeError)):
            message = str(exc)[:800]
        else:
            message = "The NotebookLM companion failed unexpectedly. Run the documented preflight commands in a terminal."
        emit(request_id, "error", code=type(exc).__name__.upper(), message=message)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
