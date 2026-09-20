import { describe, expect, it, vi } from "vitest";
import { buildItemChanges, listShoppingListItems, editShoppingListItem, mergeShoppingListItems } from "./shoppingActions";

const now = new Date("2026-09-20T20:00:00Z");
function fixture() {
  const tasks = [
    { id: "1", content: "Milk 🥛", description: "Whole milk", due: null },
    { id: "2", content: "Milk", description: "Two cartons", due: null },
  ];
  const api = {
    getTasks: vi.fn().mockResolvedValue({ results: tasks, nextCursor: null }),
    updateTask: vi.fn().mockResolvedValue({ ...tasks[0], content: "2 cartons of milk 🥛" }),
    deleteTask: vi.fn().mockResolvedValue(true),
  };
  return { api, tasks };
}
const merge = { taskIds: ["1", "2"], keepTaskId: "1", name: "2 cartons of milk 🥛" };

describe("shopping CRUD and consolidation", () => {
  it("searches notes and names and returns IDs and details", async () => {
    const { api } = fixture();
    expect(await listShoppingListItems(api, "WHOLE")).toEqual([
      { id: "1", name: "Milk 🥛", description: "Whole milk", due: null },
    ]);
    expect(await listShoppingListItems(api)).toHaveLength(2);
    expect(await listShoppingListItems(api, "bread")).toEqual([]);
  });

  it("changes only supplied fields and supports clearing notes", async () => {
    expect(buildItemChanges({ name: "Oat milk" }, now)).toEqual({ content: "Oat milk" });
    expect(buildItemChanges({ description: "" }, now)).toEqual({ description: "" });
    expect(() => buildItemChanges({}, now)).toThrow();
    expect(() => buildItemChanges({ name: " " }, now)).toThrow();
    expect(() => buildItemChanges({ dueTime: "17:00" }, now)).toThrow();
    expect(() => buildItemChanges({ dueDate: "" }, now)).toThrow();
  });

  it("edits selected duplicate without touching its due date", async () => {
    const { api } = fixture();
    await editShoppingListItem(api, { itemName: "milk", taskId: "2", name: "Oat milk", description: "Unsweetened" }, now);
    expect(api.updateTask).toHaveBeenCalledWith("2", { content: "Oat milk", description: "Unsweetened" });
  });

  it("updates the survivor with combined notes before deleting", async () => {
    const { api } = fixture();
    expect(await mergeShoppingListItems(api, merge, now)).toContain("Consolidated 2 items");
    expect(api.updateTask).toHaveBeenCalledWith("1", { content: merge.name, description: "Whole milk\n\nTwo cartons" });
    expect(api.deleteTask).toHaveBeenCalledWith("2");
    expect(api.updateTask.mock.invocationCallOrder[0]).toBeLessThan(api.deleteTask.mock.invocationCallOrder[0]);
  });

  it("never deletes if the survivor update fails", async () => {
    const { api } = fixture();
    api.updateTask.mockRejectedValue(new Error("offline"));
    await expect(mergeShoppingListItems(api, merge, now)).rejects.toThrow("offline");
    expect(api.deleteTask).not.toHaveBeenCalled();
  });

  it("rejects missing and invalid selections before making changes", async () => {
    const { api } = fixture();
    expect(await mergeShoppingListItems(api, { ...merge, taskIds: ["1", "outside"] }, now)).toContain("no longer");
    await expect(mergeShoppingListItems(api, { ...merge, taskIds: ["1", "1"] }, now)).rejects.toThrow();
    await expect(mergeShoppingListItems(api, { ...merge, keepTaskId: "outside" }, now)).rejects.toThrow();
    expect(api.updateTask).not.toHaveBeenCalled();
    expect(api.deleteTask).not.toHaveBeenCalled();
  });

  it("requires a date decision for conflicting schedules", async () => {
    const { api, tasks } = fixture();
    api.getTasks.mockResolvedValue({ results: [tasks[0], { ...tasks[1], due: { date: "2026-09-22", isRecurring: false } }], nextCursor: null });
    expect(await mergeShoppingListItems(api, merge, now)).toContain("different due dates");
    expect(api.updateTask).not.toHaveBeenCalled();
    await mergeShoppingListItems(api, { ...merge, dueDate: "2026-09-23" }, now);
    expect(api.updateTask).toHaveBeenCalledWith("1", expect.objectContaining({ dueDate: "2026-09-23" }));
  });

  it("reports partial cleanup and stops deleting on failure", async () => {
    const { api, tasks } = fixture();
    api.getTasks.mockResolvedValue({ results: [...tasks, { ...tasks[1], id: "3" }, { ...tasks[1], id: "4" }], nextCursor: null });
    api.deleteTask.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const result = await mergeShoppingListItems(api, { ...merge, taskIds: ["1", "2", "3", "4"] }, now);
    expect(result).toContain("consolidation is incomplete");
    expect(result).toContain("Removed 1 duplicate");
    expect(result).toContain("ID: 3");
    expect(result).toContain("ID: 4");
    expect(api.deleteTask).toHaveBeenCalledTimes(2);
  });
});
