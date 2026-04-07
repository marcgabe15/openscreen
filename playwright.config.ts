import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 240_000, // MP4/GIF encoding is CPU-bound under GPU stall conditions
	retries: 0,
	reporter: "list",
});
