import type { Task, TodoistApi, UpdateTaskArgs } from "@doist/todoist-api-typescript";

export const SHOPPING_LIST_PROJECT_ID = "6RXQC5qFxG5P3rX7";
export const SHOPPING_LIST_SECTION_ID = "6Rq2Gfgm4RJHXvff";

type ShoppingListApi = Pick<TodoistApi, "getTasks" | "updateTask">;

export type ShoppingListUpdateResult =
  | { kind: "updated"; task: Task }
  | { kind: "not_found"; itemName: string }
  | { kind: "ambiguous"; tasks: Task[] };

export function normalizeItemName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

export function findMatchingShoppingListTasks(tasks: Task[], itemName: string): Task[] {
  const normalizedItemName = normalizeItemName(itemName);
  return tasks.filter((task) => normalizeItemName(task.content) === normalizedItemName);
}

async function getAllShoppingListTasks(api: ShoppingListApi): Promise<Task[]> {
  const tasks: Task[] = [];
  let cursor: string | undefined;

  do {
    const response = await api.getTasks({
      projectId: SHOPPING_LIST_PROJECT_ID,
      sectionId: SHOPPING_LIST_SECTION_ID,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    tasks.push(...response.results);
    cursor = response.nextCursor ?? undefined;
  } while (cursor);

  return tasks;
}

export async function updateShoppingListTask(
  api: ShoppingListApi,
  itemName: string,
  dueArgs: UpdateTaskArgs,
): Promise<ShoppingListUpdateResult> {
  const tasks = await getAllShoppingListTasks(api);
  const matches = findMatchingShoppingListTasks(tasks, itemName);

  if (matches.length === 0) {
    return { kind: "not_found", itemName };
  }
  if (matches.length > 1) {
    return { kind: "ambiguous", tasks: matches };
  }

  const updatedTask = await api.updateTask(matches[0].id, dueArgs);
  return { kind: "updated", task: updatedTask };
}
