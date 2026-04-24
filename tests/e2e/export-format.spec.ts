import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const MAIN_JS = path.join(ROOT, "dist-electron/main.js");
const TEST_VIDEO = path.join(__dirname, "../fixtures/sample.webm");

async function runExport(formatButtonTestId: string, successText: string, ext: string) {
	const outputPath = path.join(os.tmpdir(), `test-export-${Date.now()}.${ext}`);
	let testVideoInRecordings = "";

	const app = await electron.launch({
		args: [MAIN_JS, "--no-sandbox", "--disable-gpu", "--enable-unsafe-swiftshader"],
		env: {
			...process.env,
			HEADLESS: process.env["HEADLESS"] ?? "true",
		},
	});

	app.process().stdout?.on("data", (d) => process.stdout.write(`[electron] ${d}`));
	app.process().stderr?.on("data", (d) => process.stderr.write(`[electron] ${d}`));

	try {
		// ── 1. Wait for the HUD overlay window. The window is created after
		//       registerIpcHandlers() completes, so all IPC handlers are live
		//       by the time firstWindow() resolves.
		const hudWindow = await app.firstWindow({ timeout: 60_000 });
		await hudWindow.waitForLoadState("domcontentloaded");

		// ── 2. Intercept the native save dialog in the main process.
		//       Must happen after firstWindow() so registerIpcHandlers() has
		//       already registered its version — otherwise our early handle()
		//       call causes registerIpcHandlers() to throw and abort, leaving
		//       other handlers (like set-current-video-path) never registered.
		// Store the exported buffer as a base64 global in the main process.
		// We can't use require() or import() inside app.evaluate() because the
		// main process is ESM and Playwright runs the callback via eval(), which
		// has no dynamic-import hook.  We retrieve and write the file below after
		// the export finishes.
		await app.evaluate(({ ipcMain }) => {
			ipcMain.removeHandler("save-exported-video");
			ipcMain.handle(
				"save-exported-video",
				(_event: Electron.IpcMainInvokeEvent, buffer: ArrayBuffer) => {
					(globalThis as Record<string, unknown>)["__testExportData"] =
						Buffer.from(buffer).toString("base64");
					return { success: true, path: "pending" };
				},
			);
		});

		// Copy the test fixture into the app's recordings directory so it passes
		// the path security check in set-current-video-path.
		const userDataDir = await app.evaluate(({ app: electronApp }) => {
			return electronApp.getPath("userData");
		});
		const recordingsDir = path.join(userDataDir, "recordings");
		testVideoInRecordings = path.join(recordingsDir, "test-sample.webm");
		fs.mkdirSync(recordingsDir, { recursive: true });
		fs.copyFileSync(TEST_VIDEO, testVideoInRecordings);

		try {
			await hudWindow.evaluate((videoPath: string) => {
				window.electronAPI.setCurrentVideoPath(videoPath);
				window.electronAPI.switchToEditor();
			}, testVideoInRecordings);
		} catch {
			// Expected: switchToEditor() closes the HUD window, terminating
			// the Playwright page context before evaluate() can resolve.
		}

		// ── 3. Switch to the editor window. This closes the HUD and opens
		//       a new BrowserWindow with ?windowType=editor.
		const editorWindow = await app.waitForEvent("window", {
			predicate: (w) => w.url().includes("windowType=editor"),
			timeout: 15_000,
		});

		// WebCodecs (VideoEncoder) may not be registered in the renderer on first
		// load of a second BrowserWindow. A single reload ensures the feature is
		// fully initialized before we start encoding.
		await editorWindow.reload();
		await editorWindow.waitForLoadState("domcontentloaded");
		await expect(editorWindow.getByText("Loading video...")).not.toBeVisible({
			timeout: 15_000,
		});

		// ── 4. Select the export format and trigger export.
		await editorWindow.getByTestId(formatButtonTestId).click();
		await editorWindow.getByTestId("testId-export-button").click();

		// ── 5. Wait for the success toast.
		await expect(editorWindow.getByText(successText)).toBeVisible({
			timeout: 90_000,
		});

		// ── 6. Retrieve the captured buffer from the main-process global.
		const base64 = await app.evaluate(
			() => (globalThis as Record<string, unknown>)["__testExportData"] as string,
		);
		fs.writeFileSync(outputPath, Buffer.from(base64, "base64"));

		return outputPath;
	} finally {
		await Promise.race([
			app.close(),
			new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
		]).finally(() => app.process().kill());
		if (testVideoInRecordings && fs.existsSync(testVideoInRecordings)) {
			fs.unlinkSync(testVideoInRecordings);
		}
	}
}

test("exports a GIF from a loaded video", async () => {
	const outputPath = await runExport(
		"testId-gif-format-button",
		"GIF exported successfully",
		"gif",
	);

	try {
		expect(fs.existsSync(outputPath), `GIF not found at ${outputPath}`).toBe(true);

		const header = Buffer.alloc(6);
		const fd = fs.openSync(outputPath, "r");
		fs.readSync(fd, header, 0, 6, 0);
		fs.closeSync(fd);

		// GIF magic bytes are either "GIF87a" or "GIF89a"
		expect(header.toString("ascii")).toMatch(/^GIF8[79]a/);

		expect(fs.statSync(outputPath).size).toBeGreaterThan(1024);
	} finally {
		if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
	}
});

test("exports an MP4 from a loaded video", async () => {
	const outputPath = await runExport(
		"testId-mp4-format-button",
		"Video exported successfully",
		"mp4",
	);

	try {
		expect(fs.existsSync(outputPath), `MP4 not found at ${outputPath}`).toBe(true);

		const header = Buffer.alloc(8);
		const fd = fs.openSync(outputPath, "r");
		fs.readSync(fd, header, 0, 8, 0);
		fs.closeSync(fd);

		// MP4: "ftyp" box at bytes 4–7
		expect(header.subarray(4, 8).toString("ascii")).toBe("ftyp");

		expect(fs.statSync(outputPath).size).toBeGreaterThan(1024);
	} finally {
		if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
	}
});
