import { defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "oge",
		compatibilityDate: "2026-10-01",
		compatibilityFlags: ["nodejs_compat"],
		entrypoint,
		assets: {
			runWorkerFirst: ["/api", "/api/*"],
		},
		domains: ["oge.fatihkalifa.com"],
	},
});
