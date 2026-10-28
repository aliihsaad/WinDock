/** Bind once, then let the OS choose a port if the automatic default is blocked. */
export const DEFAULT_PORT = 8620;

export function serverPortChoice(port, environmentPort = process.env.PORT) {
  const configured = port ?? (environmentPort?.trim() || undefined);
  if (configured === undefined) return { port: DEFAULT_PORT, automatic: true };
  // Only numeric TCP ports are accepted; never pass a string to listen() as a pipe path.
  if (!/^[0-9]+$/.test(String(configured)) || !Number.isSafeInteger(Number(configured)) ||
      Number(configured) > 65535 || Number(configured) < (port === 0 ? 0 : 1)) {
    throw new Error("Invalid server port. Set PORT to a whole number from 1 to 65535, or remove it to use automatic selection.");
  }
  return { port: Number(configured), automatic: false };
}

function listenOnce(server, port) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off("error", failed);
      server.off("listening", ready);
    };
    const failed = (error) => { cleanup(); reject(error); };
    const ready = () => { cleanup(); resolve(server.address().port); };
    server.once("error", failed);
    server.once("listening", ready);
    try { server.listen(port); } catch (error) { failed(error); }
  });
}

function portError(error, port) {
  if (!["EACCES", "EADDRINUSE"].includes(error.code)) return error;
  const target = port === 0 ? "an automatically selected TCP port" : `TCP port ${port}`;
  const reason = error.code === "EACCES"
    ? "The operating system denied access; on Windows this can mean the port is reserved."
    : "Another application is already using this port.";
  return Object.assign(new Error(`Cannot open ${target}. ${reason} Choose another port in WinDock's Server port settings or change/remove PORT. (${error.code})`, { cause: error }), { code: error.code });
}

export async function listenWithPortFallback(server, choice) {
  try {
    return { port: await listenOnce(server, choice.port), portNotice: "" };
  } catch (error) {
    if (!choice.automatic || !["EACCES", "EADDRINUSE"].includes(error.code)) {
      throw portError(error, choice.port);
    }
    // Keep the chosen socket open: probing then reopening would introduce a race.
    try {
      const port = await listenOnce(server, 0);
      return { port, portNotice: `Default port ${choice.port} is unavailable (${error.code}). Using port ${port}; reconnect using the address below or find this PC again.` };
    } catch (fallbackError) {
      throw portError(fallbackError, 0);
    }
  }
}
