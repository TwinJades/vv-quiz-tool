const version = await fetch("http://127.0.0.1:9341/json/version").then((response) => response.json());
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
await new Promise((resolve) => setTimeout(resolve, 500));
