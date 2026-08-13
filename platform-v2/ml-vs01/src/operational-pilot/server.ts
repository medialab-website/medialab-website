import { createOperationalPilotApp, type PilotService } from "./app.js";

export async function startOperationalPilot(service: PilotService, stagingRoot: string, port = 4316) {
  const app = createOperationalPilotApp(service, stagingRoot);
  await app.listen({ host: "127.0.0.1", port });
  return app;
}
