import sys
import json
import socket
import struct
import os
import uuid
import time

CLIENT_ID = "1462186088184549661"
LAST_STATUS = ""


def get_discord_path():
    runtime_dir = os.environ.get("XDG_RUNTIME_DIR", "/tmp")
    for i in range(10):
        path = os.path.join(runtime_dir, f"discord-ipc-{i}")
        if os.path.exists(path):
            return path
    return None


def send_packet(sock, op, data):
    payload = json.dumps(data, separators=(",", ":")).encode("utf-8")
    header = struct.pack("<II", op, len(payload))
    sock.sendall(header + payload)


def recv_packet(sock):
    try:
        header = sock.recv(8)
        if len(header) < 8:
            return None
        _, length = struct.unpack("<II", header)
        payload = b""
        while len(payload) < length:
            chunk = sock.recv(length - len(payload))
            if not chunk:
                return None
            payload += chunk
        return json.loads(payload.decode("utf-8"))
    except Exception:
        return None


def set_activity(
    sock,
    pid,
    details,
    state,
    img=None,
    start=None,
    end=None,
    large_text=None,
    small_img=None,
    small_txt=None,
):
    global LAST_STATUS
    current = (
        f"{details}-{state}-{img}-{start}-{end}-{large_text}-{small_img}-{small_txt}"
    )
    if current == LAST_STATUS:
        return
    LAST_STATUS = current

    activity = {
        "details": str(details or "Idling"),
        "state": str(state or "Monochrome"),
        "type": 2,
        "assets": {
            "large_image": img if img and str(img).startswith("http") else "monochrome",
            "large_text": str(large_text or "Monochrome"),
        },
    }

    if small_img:
        activity["assets"]["small_image"] = str(small_img)
        activity["assets"]["small_text"] = str(small_txt or "")

    if start or end:
        activity["timestamps"] = {}
        if start:
            activity["timestamps"]["start"] = int(start)
        if end:
            activity["timestamps"]["end"] = int(end)

    send_packet(
        sock,
        1,
        {
            "cmd": "SET_ACTIVITY",
            "args": {"pid": int(pid), "activity": activity},
            "nonce": str(uuid.uuid4()),
        },
    )


def clear_activity(sock, pid):
    send_packet(
        sock,
        1,
        {
            "cmd": "SET_ACTIVITY",
            "args": {"pid": int(pid), "activity": None},
            "nonce": str(uuid.uuid4()),
        },
    )


def main():
    ipc_path = get_discord_path()
    if not ipc_path:
        return

    try:
        ds = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        ds.connect(ipc_path)
    except Exception:
        return

    send_packet(ds, 0, {"v": 1, "client_id": CLIENT_ID})
    recv_packet(ds)
    time.sleep(0.2)

    pid = os.getppid()
    set_activity(ds, pid, "Idling", "Monochrome+")

    while True:
        line = sys.stdin.readline()
        if not line:
            break

        try:
            msg = json.loads(line)
        except Exception:
            continue

        cmd = msg.get("cmd")
        if cmd == "update":
            set_activity(
                ds,
                msg.get("pid") or pid,
                msg.get("details"),
                msg.get("state"),
                msg.get("largeImageKey"),
                msg.get("startTimestamp"),
                msg.get("endTimestamp"),
                msg.get("largeImageText"),
                msg.get("smallImageKey"),
                msg.get("smallImageText"),
            )
        elif cmd == "clear":
            clear_activity(ds, msg.get("pid") or pid)
            set_activity(ds, msg.get("pid") or pid, "Idling", "Monochrome")
        elif cmd == "stop":
            break

    try:
        clear_activity(ds, pid)
        time.sleep(0.1)
        ds.close()
    except Exception:
        pass


if __name__ == "__main__":
    main()
