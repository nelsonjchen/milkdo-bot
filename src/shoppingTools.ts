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
    "description": "Changes the due date of one existing active item on the shopping list immediately. Do not ask for confirmation before making the change.",
    "parameters": {
      "type": "object",
      "properties": {
        "itemName": {
          "type": "string",
          "description": "The existing shopping-list item to update, without requiring its trailing emoji."
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
        "itemName",
        "dueDate"
      ]
    },
    "strict": false
  }
];
