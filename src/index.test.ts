import { TodoistApi } from "@doist/todoist-api-typescript";
import { afterAll, beforeAll, describe, it } from "vitest";
import { unstable_dev } from "wrangler";
import type { Unstable_DevWorker } from "wrangler";
import {
	SHOPPING_LIST_PROJECT_ID,
	SHOPPING_LIST_SECTION_ID,
} from "./shoppingList";


describe("Worker", () => {
	let worker: Unstable_DevWorker;

	beforeAll(async () => {
		worker = await unstable_dev("src/index.ts", {
			experimental: { disableExperimentalWarning: true },
		});
	});

	afterAll(async () => {
		await worker.stop();
	});

	// Add cherries
	it(" should be able to add something to the todo-list", async () => {
		const todoistAPI = new TodoistApi(process.env.TODOIST_API_TOKEN ?? "");

		await todoistAPI.addTask({
			content: "Add cherries",
			dueString: "today at 12:00",
			sectionId: SHOPPING_LIST_SECTION_ID,
			projectId: SHOPPING_LIST_PROJECT_ID,
		}).catch((e) => {
			console.error("Error adding task: ", e);
			throw new Error("Error adding task");
		});
	});
});
