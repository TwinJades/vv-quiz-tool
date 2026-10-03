export class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("CDP connection timed out")), 10000);
      this.socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("CDP connection failed")); }, { once: true });
    });
    this.socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(new Error("CDP closed")); }
      this.pending.clear();
    });
  }
  async send(method, params = {}, timeoutMs = 30000, sessionId) {
    await this.ready;
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error("CDP is not connected");
    const id = ++this.nextId;
    const result = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
    });
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return result;
  }
  async evaluate(expression, timeoutMs = 30000) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async attach(targetId) {
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    return {
      sessionId,
      send: (method, params) => this.send(method, params, 30000, sessionId),
      evaluate: async expression => {
        const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, 30000, sessionId);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      },
    };
  }
  close() { this.socket.close(); }
}

export async function cdpJson(port, path, method = "GET") {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`CDP HTTP ${response.status}: ${path}`);
  return response.json();
}
