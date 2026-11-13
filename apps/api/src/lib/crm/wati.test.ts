import test from "node:test";
import assert from "node:assert/strict";
import { fillTemplate } from "../../services/wati.service";

test("WATI preview: named and numbered blanks are filled, an empty one stays visible", () => {
  assert.equal(fillTemplate("Hi {{name}}, pay {{ 2 }} by {{date}}", { name: "Asha", "2": "₹299", date: "" }), "Hi Asha, pay ₹299 by {{date}}");
});
