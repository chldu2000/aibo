"""Probe (task 17): does Claude Code's stream-json input take an image
content block, and does the model see it? One haiku turn; tools are
denied, every line is recorded (the base64 data is cut in the record, the
account's email redacted).

usage: python3 -I claude_image.py OUT.jsonl WORKDIR IMAGE.png
"""
import base64, json, re, select, subprocess, sys, time

out, cwd, img = sys.argv[1], sys.argv[2], sys.argv[3]
data = base64.b64encode(open(img, "rb").read()).decode()
log = open(out, "w")
p = subprocess.Popen(["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
                      "--permission-prompt-tool", "stdio", "--model", "haiku"],
                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, cwd=cwd)
def send(o):
    log.write(">> " + json.dumps(o).replace(data, data[:16] + "…") + "\n"); log.flush()
    p.stdin.write(json.dumps(o) + "\n"); p.stdin.flush()
send({"type": "control_request", "request_id": "init", "request": {"subtype": "initialize"}})
send({"type": "user", "message": {"role": "user", "content": [
    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}},
    {"type": "text", "text": "Do not use any tools. Name the shapes in the image and their colors, left to right, as 'color shape, color shape'. If you see no image, reply UNKNOWN."}]}})
tools, answer = [], None
end = time.time() + 120
while time.time() < end:
    r, _, _ = select.select([p.stdout], [], [], 1)
    if not r: continue
    line = p.stdout.readline()
    if not line: break
    log.write(re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "<redacted>", line.replace(data, data[:16] + "…"))); log.flush()
    d = json.loads(line)
    if d.get("type") == "control_request":
        tools.append(d["request"].get("tool_name"))
        send({"type": "control_response", "response": {"subtype": "success", "request_id": d["request_id"], "response": {"behavior": "deny", "message": "no tools"}}})
    if d.get("type") == "user" and data[:64] in line:
        print("  the image is echoed back in a user line")
    if d.get("type") == "result":
        answer = d.get("result"); break
print("tools:", tools, "answer:", answer)
p.stdin.close(); p.kill()
