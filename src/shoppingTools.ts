import type { FunctionTool } from "openai/resources/responses/responses";

export const shoppingTools: FunctionTool[] = [
  {
    "type": "function",
    "name": "addShoppingListItems",
    "description": "Adds multiple items to the shopping list.",
    "parameters": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "description": "The name of the item to add to the shopping list, postfixed with an emoji to represent the item, e.g. 'Milk 🥛'."
              },
              "dueDate": {
                "type": "string",
                "description": "The due date in Pacific time as YYYY-MM-DD. Resolve relative dates using the current Pacific date from the system prompt. Omit when no date is specified so the application defaults to today."
              },
              "dueTime": {
                "type": "string",
                "description": "Optional due time in Pacific local time as HH:mm, using 24-hour format."
              }
            },
            "required": [
              "name"
            ]
          }
        }
      },
      "required": [
        "items"
      ]
    },
    "strict": false
  },
  {
    "type": "function",
    "name": "updateShoppingListItem",
    "description": "Edits the name, description, and/or due date of an existing active item. Omitted fields remain unchanged.",
    "parameters": {
      "type": "object",
      "properties": {
        "taskId": {
          "type": "string",
          "description": "Optional ID from a previous tool result, used only after the user selects a specific duplicate. Never invent an ID."
        },
        "itemName": {
          "type": "string",
          "description": "The existing shopping-list item to update, without requiring its trailing emoji."
        },
        "name": {
          "type": "string",
          "description": "New item name, including the intended quantity and emoji. Omit to preserve."
        },
        "description": {
          "type": "string",
          "description": "New item notes. Omit to preserve; an empty string clears notes."
        },
        "dueDate": {
          "type": "string",
          "description": "The new due date in Pacific time as YYYY-MM-DD. Resolve relative dates using the current Pacific date from the system prompt."
        },
        "dueTime": {
          "type": "string",
          "description": "Optional new due time in Pacific local time as HH:mm, using 24-hour format."
        }
      },
      "required": [
        "itemName"
      ]
    },
    "strict": false
  },
  {
    type: "function",
    name: "deleteShoppingListItem",
    description: "Deletes an existing active shopping-list item when the user asks to delete or remove it. Act immediately when the item is unambiguous.",
    parameters: {
      type: "object",
      properties: {
        itemName: { type: "string", description: "Existing item name, without requiring its trailing emoji." },
        taskId: { type: "string", description: "Optional ID from a previous tool result after the user selects a specific duplicate. Never invent an ID." },
      },
      required: ["itemName"],
    },
    strict: false,
  },
  {
    type: "function", name: "listShoppingListItems",
    description: "Reads the current active shopping list, including IDs, names, descriptions, and due dates. Optional query searches names and notes. Use before consolidation or when finding an item by partial name.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Optional substring to search; omit for the entire list." } } },
    strict: false,
  },
  {
    type: "function", name: "mergeShoppingListItems",
    description: "Consolidates selected items from a fresh list result into one. Updates the survivor before deleting other selected items. Resolve unclear quantities or dates with the user first. Preserve all relevant notes. Never repeat a partially completed merge; inspect the list first.",
    parameters: {
      type: "object",
      properties: {
        taskIds: { type: "array", items: { type: "string" }, minItems: 2, description: "Distinct IDs of all selected items, from listShoppingListItems." },
        keepTaskId: { type: "string", description: "One of taskIds: the item to keep." },
        name: { type: "string", description: "Consolidated item name with the user-intended total quantity. Do not guess whether quantities should be added or deduplicated." },
        description: { type: "string", description: "Consolidated notes. Omit to preserve and combine existing notes." },
        dueDate: { type: "string", description: "YYYY-MM-DD in Pacific time. Required if source dates differ; ask the user if unspecified." },
        dueTime: { type: "string", description: "Optional Pacific HH:mm with dueDate." },
      },
      required: ["taskIds", "keepTaskId", "name"],
    },
    strict: false,
  }
];
