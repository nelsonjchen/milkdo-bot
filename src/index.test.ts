import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_dev } from "wrangler";
import type { UnstableDevWorker } from "wrangler";



describe("Worker", () => {
	let worker: UnstableDevWorker;

	beforeAll(async () => {
		worker = await unstable_dev("src/index.ts", {
			experimental: { disableExperimentalWarning: true },
		});
	});

	afterAll(async () => {
		await worker.stop();
	});

	it("should return Hello World", async () => {
		const resp = await worker.fetch();
		if (resp) {
			const text = await resp.text();
			expect(text).toMatchInlineSnapshot(`"Hello World!"`);
		}
	});

	// Add cherries
	it(" should be able to add something to the todo-list", async () => {
		const todoistAPI = new TodoistApi(env.TODOIST_API_TOKEN);

		await todoistAPI.addTask({
			content: "Add cherries",
			dueString: "today at 12:00",
			sectionId: "150049165",
			projectId: "2328224336",
		}).catch((e) => {
			console.error("Error adding task: ", e);
			throw new Error("Error adding task");
		});
	});
});
