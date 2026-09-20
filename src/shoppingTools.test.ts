import { expect, it } from "vitest";
import { shoppingTools } from "./shoppingTools";

it("exposes all CRUD and consolidation capabilities to the model", () => {
  expect(shoppingTools.map(tool => tool.name)).toEqual(expect.arrayContaining([
    "addShoppingListItems", "listShoppingListItems", "updateShoppingListItem", "deleteShoppingListItem", "mergeShoppingListItems",
  ]));
  const edit = shoppingTools.find(tool => tool.name === "updateShoppingListItem")!;
  expect(edit.parameters?.required).toEqual(["itemName"]);
  expect(edit.parameters?.properties).toEqual(expect.objectContaining({
    name: expect.objectContaining({ type: "string" }),
    description: expect.objectContaining({ type: "string" }),
    dueDate: expect.objectContaining({ type: "string" }),
  }));
});
