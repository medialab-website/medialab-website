import { createOperationsConsoleApp, type OperationsConsoleApplicationOptions } from "./app.js";

export const OPERATIONS_CONSOLE_HOST = "127.0.0.1" as const;
export const OPERATIONS_CONSOLE_PORT = 4317 as const;

export async function startOperationsConsole(options: OperationsConsoleApplicationOptions, port = OPERATIONS_CONSOLE_PORT) {
  if (port !== OPERATIONS_CONSOLE_PORT) throw new Error("Operations Console must use the bounded nonproduction port.");
  const app = createOperationsConsoleApp(options);
  try {
    await app.listen({ host: OPERATIONS_CONSOLE_HOST, port: OPERATIONS_CONSOLE_PORT });
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
