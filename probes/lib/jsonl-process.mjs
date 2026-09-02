import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export class JsonlProcess extends EventEmitter {
  #child;
  #buffer = "";
  #decoder = new StringDecoder("utf8");
  #nextId = 1;
  #pending = new Map();
  #closed = false;

  constructor(command, args = [], options = {}) {
    super();
    this.command = command;
    this.args = args;
    this.options = options;
  }

  start() {
    if (this.#child) {
      throw new Error("JSONL process has already been started");
    }

    this.#child = spawn(this.command, this.args, {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.#child.stdout.on("data", (chunk) => this.#onStdout(chunk));
    this.#child.stdout.on("end", () => this.#onStdoutEnd());
    this.#child.stderr.on("data", (chunk) => {
      this.emit("stderr", chunk.toString("utf8"));
    });
    this.#child.on("error", (error) => {
      this.#rejectPending(error);
      this.emit("processError", error);
    });
    this.#child.on("exit", (code, signal) => {
      this.#closed = true;
      const error = new Error(
        `Process exited before all requests completed: ${this.command} (code=${code}, signal=${signal})`,
      );
      this.#rejectPending(error);
      this.emit("exit", { code, signal });
    });

    return this;
  }

  get pid() {
    return this.#child?.pid;
  }

  send(message) {
    if (!this.#child || this.#closed || !this.#child.stdin.writable) {
      throw new Error(`Cannot write to inactive process: ${this.command}`);
    }
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  notify(method, params = {}) {
    this.send({ method, params });
  }

  rpcRequest(method, params = {}, options = {}) {
    return this.requestMessage({ method, params }, options);
  }

  requestMessage(message, options = {}) {
    const id = message.id ?? `aibo-probe-${this.#nextId++}`;
    const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Timed out after ${timeoutMs} ms waiting for response ${id}`));
      }, timeoutMs);

      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.send({ ...message, id });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  waitFor(predicate, options = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const onMessage = (message) => {
        try {
          if (!predicate(message)) return;
          cleanup();
          resolve(message);
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out after ${timeoutMs} ms waiting for JSONL event`));
      }, timeoutMs);
      timer.unref?.();
      const cleanup = () => {
        clearTimeout(timer);
        this.off("message", onMessage);
      };
      this.on("message", onMessage);
    });
  }

  async close(options = {}) {
    if (!this.#child || this.#closed) return;

    const graceMs = options.graceMs ?? 1_000;
    this.#child.stdin.end();

    const exited = new Promise((resolve) => this.#child.once("exit", resolve));
    let graceTimer;
    const timeout = new Promise((resolve) => {
      graceTimer = setTimeout(() => resolve(false), graceMs);
      graceTimer.unref?.();
    });

    if (await Promise.race([exited.then(() => true), timeout])) {
      clearTimeout(graceTimer);
      return;
    }

    if (!this.#closed) this.#child.kill();
    let killTimer;
    await Promise.race([
      exited,
      new Promise((resolve) => {
        killTimer = setTimeout(resolve, graceMs);
        killTimer.unref?.();
      }),
    ]);
    clearTimeout(graceTimer);
    clearTimeout(killTimer);
  }

  #onStdout(chunk) {
    this.#buffer += this.#decoder.write(chunk);
    this.#drainLines(false);
  }

  #onStdoutEnd() {
    this.#buffer += this.#decoder.end();
    this.#drainLines(true);
  }

  #drainLines(flushRemainder) {
    while (true) {
      const newlineIndex = this.#buffer.indexOf("\n");
      if (newlineIndex === -1) break;
      let line = this.#buffer.slice(0, newlineIndex);
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.#parseLine(line);
    }

    if (flushRemainder && this.#buffer.length > 0) {
      const line = this.#buffer.endsWith("\r")
        ? this.#buffer.slice(0, -1)
        : this.#buffer;
      this.#buffer = "";
      this.#parseLine(line);
    }
  }

  #parseLine(line) {
    if (line.length === 0) return;

    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      const parseError = new Error(`Invalid JSONL from ${this.command}: ${line}`, {
        cause: error,
      });
      this.emit("protocolError", parseError);
      return;
    }

    this.emit("message", message);

    const isResponse =
      message.type === "response" ||
      message.result !== undefined ||
      message.error !== undefined;
    if (message.method !== undefined || message.id === undefined || !isResponse) return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.#pending.delete(message.id);
    if (message.error !== undefined || message.success === false) {
      pending.reject(
        new Error(`Request ${message.id} failed: ${JSON.stringify(message.error ?? message)}`),
      );
    } else {
      pending.resolve(message);
    }
  }

  #rejectPending(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
