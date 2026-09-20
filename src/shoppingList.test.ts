import type { Task } from "@doist/todoist-api-typescript";
import { describe, expect, it, vi } from "vitest";
import {
  SHOPPING_LIST_PROJECT_ID,
  SHOPPING_LIST_SECTION_ID,
  findMatchingShoppingListTasks,
  updateShoppingListTask,
  deleteShoppingListTask,
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

describe("shopping list deletion", () => {
  function fixture(tasks: Task[]) {
    return {
      getTasks: vi.fn().mockResolvedValue({ results: tasks, nextCursor: null }),
      deleteTask: vi.fn().mockResolvedValue(true),
      updateTask: vi.fn().mockResolvedValue(tasks[0]),
    };
  }

  it("deletes a matching item without requiring its emoji", async () => {
    const api = fixture([task("1", "Milk 🥛")]);
    expect(await deleteShoppingListTask(api, "milk")).toEqual({ kind: "deleted", task: task("1", "Milk 🥛") });
    expect(api.deleteTask).toHaveBeenCalledWith("1");
  });

  it("does not delete missing or ambiguous items", async () => {
    const api = fixture([task("1", "Milk 🥛"), task("2", "Milk")]);
    expect((await deleteShoppingListTask(api, "milk")).kind).toBe("ambiguous");
    expect((await deleteShoppingListTask(api, "cheese")).kind).toBe("not_found");
    expect(api.deleteTask).not.toHaveBeenCalled();
  });

  it("uses the selected duplicate for deletion and rescheduling", async () => {
    const api = fixture([task("1", "Milk 🥛"), task("2", "Milk")]);
    await deleteShoppingListTask(api, "milk", "2");
    await updateShoppingListTask(api, "milk", { dueDate: "2026-09-22" }, "2");
    expect(api.deleteTask).toHaveBeenCalledWith("2");
    expect(api.updateTask).toHaveBeenCalledWith("2", { dueDate: "2026-09-22" });
  });

  it("does not act on IDs outside the matching shopping-list items", async () => {
    const api = fixture([task("1", "Milk 🥛"), task("2", "Bread")]);
    for (const id of ["2", "outside-list"]) {
      expect((await deleteShoppingListTask(api, "milk", id)).kind).toBe("not_found");
      expect((await updateShoppingListTask(api, "milk", { dueDate: "2026-09-22" }, id)).kind).toBe("not_found");
    }
    expect(api.deleteTask).not.toHaveBeenCalled();
    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it("checks all pages before deleting so later duplicates are not missed", async () => {
    const api = fixture([]);
    api.getTasks.mockResolvedValueOnce({ results: [task("1", "Milk")], nextCursor: "next" })
      .mockResolvedValueOnce({ results: [task("2", "Milk 🥛")], nextCursor: null });
    expect((await deleteShoppingListTask(api, "milk")).kind).toBe("ambiguous");
    expect(api.deleteTask).not.toHaveBeenCalled();
  });

  it("does not report success when Todoist rejects deletion", async () => {
    const api = fixture([task("1", "Milk")]);
    api.deleteTask.mockResolvedValueOnce(false);
    await expect(deleteShoppingListTask(api, "milk")).rejects.toThrow("did not confirm");
    api.deleteTask.mockRejectedValueOnce(new Error("unavailable"));
    await expect(deleteShoppingListTask(api, "milk")).rejects.toThrow("unavailable");
  });
});
