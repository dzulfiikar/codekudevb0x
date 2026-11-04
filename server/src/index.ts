import { config } from "./infrastructure/config.js";
import { createTables } from "./infrastructure/database/create-tables.js";
import { createHttpApp } from "./infrastructure/http-app.js";
import { hostService } from "./features/hosts/host-service.js";
import { projectService } from "./features/projects/project-service.js";
import { workspaceService } from "./features/workspaces/workspace-service.js";

await createTables();
await hostService.failInterruptedPreparation();
await workspaceService.failInterruptedSetups();
await projectService.failInterruptedSetups();

createHttpApp().listen(config.port, config.host, () => {
  console.log(`Server listening on http://${config.host}:${config.port}`);
});
