// Runs once when the server process starts. Loading the services validates the whole
// environment, so a misconfigured deployment stops here with the list of bad variables
// instead of failing on the first request that happens to need one of them.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { services } = await import("@/web/services");
  const { logger, config } = services();
  logger.info(
    { appUrl: config.appUrl, queue: config.queue.name },
    "Web process configuration validated",
  );
}
