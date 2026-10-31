import { config } from "./infrastructure/config.js";
import { createTables } from "./infrastructure/database/create-tables.js";
import { createHttpApp } from "./infrastructure/http-app.js";
import { hostService } from "./services/host-service.js";
import { projectService } from "./services/project-service.js";
import { workspaceService } from "./services/workspace-service.js";

await createTables();
await hostService.failInterruptedPreparation();
await workspaceService.failInterruptedSetups();
await projectService.failInterruptedSetups();

createHttpApp().listen(config.port, config.host, () => {
  console.log(`Server listening on http://${config.host}:${config.port}`);
});
