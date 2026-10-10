"""Dispatch publication at most once a minute until Prague midnight on election day."""
from datetime import datetime, timedelta, timezone
import json
import os
import time
from urllib.request import Request, urlopen

START = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)
END = datetime(2026, 10, 10, 22, tzinfo=timezone.utc)


def active(now: datetime) -> bool:
    return START <= now < END


def api(path: str, data: dict | None = None) -> dict:
    request = Request(
        f"https://api.github.com/repos/{os.environ['GITHUB_REPOSITORY']}/{path}",
        data=json.dumps(data).encode() if data is not None else None,
        headers={
            "Authorization": f"Bearer {os.environ['GH_TOKEN']}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urlopen(request, timeout=30) as response:
        body = response.read()
        return json.loads(body) if body else {}


def tick() -> None:
    runs = api("actions/workflows/publish.yml/runs?branch=main&per_page=10")["workflow_runs"]
    if any(run["status"] != "completed" for run in runs):
        print("Publication still active; skipping this minute.", flush=True)
        return
    api("actions/workflows/publish.yml/dispatches", {"ref": "main"})
    print("Dispatched official CSU update and publication.", flush=True)


def main() -> None:
    now = datetime.now(timezone.utc)
    if not active(now):
        print("Outside temporary election-day window; nothing to do.", flush=True)
        return
    # Hourly workflow starts overlap slightly; concurrency cancels the old coordinator.
    deadline = min(END, now + timedelta(minutes=65))
    while datetime.now(timezone.utc) < deadline:
        started = time.monotonic()
        tick()
        remaining = (deadline - datetime.now(timezone.utc)).total_seconds()
        if remaining <= 0:
            break
        time.sleep(min(remaining, max(0, 60 - (time.monotonic() - started))))
    print("Minute coordinator finished.", flush=True)


if __name__ == "__main__":
    main()
