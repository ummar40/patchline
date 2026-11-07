import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./diff";

const patch = `diff --git a/src/cart.js b/src/cart.js
index 1111111..2222222 100644
--- a/src/cart.js
+++ b/src/cart.js
@@ -10,7 +10,7 @@ function total(items) {
   let sum = 0;
   for (const item of items) {
-    sum += item.price;
+    sum += item.price * item.quantity;
   }
   return sum;
 }
diff --git a/test/cart.test.js b/test/cart.test.js
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/test/cart.test.js
@@ -0,0 +1,2 @@
+const assert = require("node:assert");
+assert.equal(1, 1);
\\ No newline at end of file
diff --git a/old.txt b/old.txt
deleted file mode 100644
index 4444444..0000000
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-gone
diff --git a/logo.png b/logo.png
index 5555555..6666666 100644
GIT binary patch
literal 10
abcdefghij
`;

describe("parseUnifiedDiff", () => {
  const files = parseUnifiedDiff(patch);

  it("splits the patch into files with their status", () => {
    expect(files.map((file) => [file.path, file.status, file.binary])).toEqual([
      ["src/cart.js", "MODIFIED", false],
      ["test/cart.test.js", "ADDED", false],
      ["old.txt", "DELETED", false],
      ["logo.png", "MODIFIED", true],
    ]);
  });

  it("counts additions and deletions per file", () => {
    expect(files.map((file) => [file.additions, file.deletions])).toEqual([
      [1, 1],
      [2, 0],
      [0, 1],
      [0, 0],
    ]);
  });

  it("numbers lines from the hunk header", () => {
    const [cart] = files;
    const removed = cart?.lines.find((line) => line.kind === "remove");
    const added = cart?.lines.find((line) => line.kind === "add");
    expect(removed).toMatchObject({ text: "    sum += item.price;", oldNumber: 12 });
    expect(added).toMatchObject({ text: "    sum += item.price * item.quantity;", newNumber: 12 });
  });

  it("keeps the no-newline marker as a note and skips binary payloads", () => {
    expect(files[1]?.lines.at(-1)).toEqual({ kind: "note", text: "No newline at end of file" });
    expect(files[3]?.lines).toEqual([]);
  });

  it("returns nothing for an empty patch", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});
