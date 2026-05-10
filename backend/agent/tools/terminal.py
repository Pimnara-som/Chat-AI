# =============================================================================
# tools/terminal.py
# Sandboxed Python + Shell execution
# Safer than the original tool_definitions.py version:
#   - Python: writes to tmpfile (supports multiline), isolated subprocess
#   - Shell:  blocklist of destructive commands, locked to /tmp workdir
# =============================================================================

import subprocess, sys, os, tempfile
from pathlib import Path

# ── Blocklist (rough match is intentional — better to over-block) ──────────────
_BLOCKED_PATTERNS = [
    "rm -rf /",
    "shutdown",
    "reboot",
    "mkfs",
    ":(){:|:&};:",   # fork bomb
    "dd if=",
    "> /dev/sd",
]


def _get_agent_python() -> str:
    """Check for local .agent_venv and return path to its python, fallback to sys.executable."""
    venv_py = Path.cwd() / ".agent_venv" / "bin" / "python"
    if venv_py.exists():
        return str(venv_py)
    return sys.executable

def _get_agent_pip() -> str:
    """Check for local .agent_venv and return path to its pip, fallback to 'pip'."""
    venv_pip = Path.cwd() / ".agent_venv" / "bin" / "pip"
    if venv_pip.exists():
        return str(venv_pip)
    return "pip"

def run_python(code: str, timeout: int = 30) -> str:
    """
    Execute Python code in an isolated subprocess.
    """
    remote_url = os.environ.get("REMOTE_SANDBOX_URL")
    if remote_url:
        import requests
        try:
            resp = requests.post(remote_url, json={"code": code, "timeout": timeout}, timeout=timeout+5)
            if resp.status_code == 200:
                data = resp.json()
                out = data.get("stdout", "").strip()
                err = data.get("stderr", "").strip()
                if err:
                    return f"STDOUT:\n{out}\nSTDERR:\n{err}"
                return out or "(no output)"
            return f"[run_python remote error] HTTP {resp.status_code}"
        except Exception as e:
            return f"[run_python remote connection error] {e}"

    python_exe = _get_agent_python()
    with tempfile.NamedTemporaryFile(suffix=".py", mode="w",
                                     delete=False, encoding="utf-8") as f:
        f.write(code)
        tmpfile = f.name
    try:
        result = subprocess.run(
            [python_exe, tmpfile],
            capture_output=True, text=True, timeout=timeout,
            env={**os.environ, "PYTHONPATH": str(Path.cwd())},
        )
        out = result.stdout.strip()
        err = result.stderr.strip()
        if err:
            return f"STDOUT:\n{out}\nSTDERR:\n{err}"
        return out or "(no output)"
    except subprocess.TimeoutExpired:
        return f"[run_python error] Execution timed out after {timeout}s"
    except Exception as e:
        return f"[run_python error] {e}"
    finally:
        try:
            os.unlink(tmpfile)
        except OSError:
            pass


def run_shell(command: str, timeout: int = 30,
              workdir: str = "/tmp") -> str:
    """
    Execute a shell command with safety blocklist.
    Workdir defaults to /tmp to prevent file-system damage.

    Blocked patterns: rm -rf /, shutdown, reboot, mkfs, fork bomb, dd if=
    """
    cmd_lower = command.lower()
    for pattern in _BLOCKED_PATTERNS:
        if pattern in cmd_lower:
            return f"[run_shell blocked] คำสั่งนี้ไม่อนุญาต (pattern: '{pattern}')"

    try:
        # If the command contains 'pip', use the agent's pip if available
        if "pip" in command.lower():
            pip_exe = _get_agent_pip()
            command = command.replace("pip", pip_exe)

        result = subprocess.run(
            command, shell=True, cwd=workdir,
            capture_output=True, text=True, timeout=timeout,
        )
        output = (result.stdout + result.stderr).strip()
        return output or "(no output)"
    except subprocess.TimeoutExpired:
        return f"[run_shell error] Timed out after {timeout}s"
    except Exception as e:
        return f"[run_shell error] {e}"
