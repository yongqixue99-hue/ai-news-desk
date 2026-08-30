export type BootstrapState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

export const resolveBootstrap = async (load: () => Promise<unknown>): Promise<BootstrapState> => {
  try {
    await load();
    return { status: "ready" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
};
