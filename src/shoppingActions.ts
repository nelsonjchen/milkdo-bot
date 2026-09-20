import type { TodoistApi, UpdateTaskArgs } from "@doist/todoist-api-typescript";
import { resolveDueDate } from "./dueDates";
import { getAllShoppingListTasks, normalizeItemName, updateShoppingListTask, describeShoppingListChoices } from "./shoppingList";

type Api = Pick<TodoistApi, "getTasks" | "updateTask" | "deleteTask">;
export interface ItemChanges {
  name?: string;
  description?: string;
  dueDate?: string;
  dueTime?: string;
}

export function buildItemChanges(args: ItemChanges, now: Date): UpdateTaskArgs {
  const changes: UpdateTaskArgs = {};
  if (args.name !== undefined) {
    if (typeof args.name !== "string" || !args.name.trim()) throw new Error("The item name cannot be empty.");
    changes.content = args.name.trim();
  }
  if (args.description !== undefined) {
    if (typeof args.description !== "string") throw new Error("Description must be text.");
    changes.description = args.description;
  }
  if (args.dueTime !== undefined && !args.dueDate) throw new Error("Specify a due date with the new time.");
  if (args.dueDate !== undefined) {
    if (typeof args.dueDate !== "string" || !args.dueDate.trim()) throw new Error("Specify a valid due date.");
    const due = resolveDueDate(args.dueDate, args.dueTime, now);
    if (!due.ok) throw new Error(due.error);
    Object.assign(changes, due.todoistArgs);
  }
  if (!Object.keys(changes).length) throw new Error("Specify a new name, description, or due date.");
  return changes;
}

export async function listShoppingListItems(api: Pick<Api, "getTasks">, query?: string) {
  if (query !== undefined && typeof query !== "string") throw new Error("Search query must be text.");
  const tasks = await getAllShoppingListTasks(api);
  const term = normalizeItemName(query ?? "");
  return tasks.filter(task => !term || normalizeItemName(`${task.content} ${task.description ?? ""}`).includes(term))
    .map(task => ({ id: task.id, name: task.content, description: task.description ?? "", due: task.due ?? null }));
}

export async function editShoppingListItem(
  api: Api, args: ItemChanges & { itemName: string; taskId?: string }, now: Date,
): Promise<string> {
  if (typeof args.itemName !== "string" || !args.itemName.trim()) throw new Error("An existing item name is required.");
  const changes = buildItemChanges(args, now);
  const result = await updateShoppingListTask(api, args.itemName, changes, args.taskId);
  if (result.kind === "not_found") return `I couldn't find an active shopping-list item matching "${args.itemName}".`;
  if (result.kind === "ambiguous") return `Which item should I change?\n${describeShoppingListChoices(result.tasks)}`;
  const due = args.dueDate ? resolveDueDate(args.dueDate, args.dueTime, now) : undefined;
  return `Updated ${result.task.content}${due?.ok ? ` to be due ${due.display}` : ""}.${args.description !== undefined ? `\nDescription: ${args.description || "(cleared)"}` : ""}`;
}

export interface MergeItemsArguments extends ItemChanges {
  taskIds: string[];
  keepTaskId: string;
  name: string;
}

export async function mergeShoppingListItems(api: Api, args: MergeItemsArguments, now: Date): Promise<string> {
  if (!Array.isArray(args.taskIds) || args.taskIds.length < 2 || args.taskIds.some(id => typeof id !== "string" || !id)
    || new Set(args.taskIds).size !== args.taskIds.length || !args.taskIds.includes(args.keepTaskId)) {
    throw new Error("Select at least two distinct items and choose one of them to keep.");
  }
  if (typeof args.name !== "string" || !args.name.trim()) throw new Error("Specify the consolidated item name, including the intended quantity.");
  const changes = buildItemChanges(args, now);
  const tasks = await getAllShoppingListTasks(api);
  const selected = args.taskIds.map(id => tasks.find(task => task.id === id));
  if (selected.some(task => !task)) return "Some selected items are no longer on the shopping list. Read the list again before consolidating.";
  const items = selected.filter(task => task !== undefined);
  // Preserve differing schedules unless the user has chosen a replacement date.
  const schedules = new Set(items.map(task => JSON.stringify(task.due ?? null)));
  if (schedules.size > 1 && !args.dueDate) return "These items have different due dates or recurrence schedules. Which due date should the consolidated item use? No items were changed.";
  if (items.some(task => task.due?.isRecurring)) return "Consolidation of recurring items is not supported; no items were changed.";
  if (args.description === undefined) {
    changes.description = [...new Set(items.map(task => task.description).filter(Boolean))].join("\n\n");
  }
  // Never remove a source item until the survivor contains the merged details.
  const kept = await api.updateTask(args.keepTaskId, changes);
  const deleted: string[] = [];
  for (const task of items) {
    if (task.id === args.keepTaskId) continue;
    try {
      if (!await api.deleteTask(task.id)) throw new Error("Deletion not confirmed");
      deleted.push(task.id);
    } catch {
      const remaining = items.filter(item => item.id !== args.keepTaskId && !deleted.includes(item.id));
      return `Updated ${kept.content}, but consolidation is incomplete. Removed ${deleted.length} duplicate(s). These items still need checking:\n${describeShoppingListChoices(remaining)}\nDo not merge their quantities again; the kept item already contains the consolidated details.`;
    }
  }
  return `Consolidated ${items.length} items into ${kept.content}. Removed ${deleted.length} duplicate(s).`;
}
