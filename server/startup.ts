interface ListeningServer {
  listening?: boolean;
  once(event: "listening", listener: () => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  off(event: "listening", listener: () => void): this;
  off(event: "error", listener: (error: Error) => void): this;
}

interface StartOwnedServerOptions {
  listen: () => ListeningServer;
  recoverInterruptedRuns: () => Promise<unknown>;
  startScheduler: () => unknown;
}

const waitForListening = (server: ListeningServer) => new Promise<void>((resolve, reject) => {
  if (server.listening) {
    resolve();
    return;
  }
  const cleanup = () => {
    server.off("listening", onListening);
    server.off("error", onError);
  };
  const onListening = () => {
    cleanup();
    resolve();
  };
  const onError = (error: Error) => {
    cleanup();
    reject(error);
  };
  server.once("listening", onListening);
  server.once("error", onError);
});

/**
 * Claims the HTTP port before touching persisted workflow state. A second
 * process that loses EADDRINUSE must never "recover" the first process's run.
 */
export const startOwnedServer = async ({
  listen,
  recoverInterruptedRuns,
  startScheduler,
}: StartOwnedServerOptions) => {
  const server = listen();
  await waitForListening(server);
  await recoverInterruptedRuns();
  startScheduler();
  return server;
};
