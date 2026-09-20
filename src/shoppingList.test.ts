import type { Task } from "@doist/todoist-api-typescript";
import { describe, expect, it, vi } from "vitest";
import {
  SHOPPING_LIST_PROJECT_ID,
  SHOPPING_LIST_SECTION_ID,
  findMatchingShoppingListTasks,
  updateShoppingListTask,
} from "./shoppingList";

function task(id: string, content: string): Task {
  return { id, content } as Task;
}

describe("shopping list task matching", () => {
  it("matches item names without generated trailing emoji", () => {
    expect(findMatchingShoppingListTasks(
      [task("1", "Milk 🥛"), task("2", "Bananas 🍌")],
      "milk",
    ).map((value) => value.id)).toEqual(["1"]);
  });

  it("updates exactly one matching task", async () => {
    const updateTask = vi.fn(async (id: string) => task(id, "Milk 🥛"));
    const api = {
      getTasks: vi.fn(async () => ({ results: [task("1", "Milk 🥛")], nextCursor: null })),
      updateTask,
    };

    const result = await updateShoppingListTask(api, "milk", { dueDate: "2026-09-18" });

    expect(result.kind).toBe("updated");
    expect(updateTask).toHaveBeenCalledWith("1", { dueDate: "2026-09-18" });
    expect(api.getTasks).toHaveBeenCalledWith({
      projectId: SHOPPING_LIST_PROJECT_ID,
      sectionId: SHOPPING_LIST_SECTION_ID,
      limit: 200,
    });
  });

  it("does not update when no task matches", async () => {
    const updateTask = vi.fn();
    const api = {
      getTasks: vi.fn(async () => ({ results: [task("1", "Milk 🥛")], nextCursor: null })),
      updateTask,
    };

    const result = await updateShoppingListTask(api, "cheese", { dueDate: "2026-09-18" });

    expect(result).toEqual({ kind: "not_found", itemName: "cheese" });
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("does not update when multiple tasks match", async () => {
    const updateTask = vi.fn();
    const api = {
      getTasks: vi.fn(async () => ({
        results: [task("1", "Milk 🥛"), task("2", "Milk 🥛")],
        nextCursor: null,
      })),
      updateTask,
    };

    const result = await updateShoppingListTask(api, "milk", { dueDate: "2026-09-18" });

    expect(result.kind).toBe("ambiguous");
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("follows Todoist task pagination", async () => {
    const getTasks = vi.fn()
      .mockResolvedValueOnce({ results: [task("1", "Milk 🥛")], nextCursor: "next" })
      .mockResolvedValueOnce({ results: [task("2", "Bananas 🍌")], nextCursor: null });
    const api = {
      getTasks,
      updateTask: vi.fn(),
    };

    await updateShoppingListTask(api, "bananas", { dueDate: "2026-09-18" });

    expect(getTasks).toHaveBeenNthCalledWith(2, {
      projectId: SHOPPING_LIST_PROJECT_ID,
      sectionId: SHOPPING_LIST_SECTION_ID,
      limit: 200,
      cursor: "next",
    });
  });
});
