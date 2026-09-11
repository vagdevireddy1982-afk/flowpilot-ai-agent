import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "FlowPilot!2024";

async function signIn(page: Page, email = "admin@flowpilot.demo") {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard");
}

async function ask(page: Page, message: string) {
  await page.fill("textarea", message);
  await page.getByRole("button", { name: "Send" }).click();
}

test.describe("authentication", () => {
  test("rejects a wrong password without revealing anything", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", "admin@flowpilot.demo");
    await page.fill("#password", "definitely-not-the-password");
    await page.click('button[type="submit"]');

    // Scoped to the form: Next renders its own aria-live route announcer with role="alert".
    await expect(page.locator("form").getByRole("alert")).toContainText("not recognised");
    await expect(page).toHaveURL(/\/login/);
  });

  test("signs in and lands on a dashboard built from real data", async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
    await expect(page.getByText("Customers", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Pending approvals")).toBeVisible();
  });

  test("keeps signed-out visitors out of the app", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("AI agent", () => {
  test("answers an order lookup with data from the database", async ({ page }) => {
    await signIn(page);
    await page.goto("/agent");
    await page.getByRole("button", { name: "New conversation" }).click();

    await ask(page, "Show me order ORD-1004.");

    await expect(page.getByText("ORD-1004").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Priya Sharma").first()).toBeVisible();
    await expect(page.getByText("₹12,499.00").first()).toBeVisible();
    // The tool trace proves the answer came from a real tool call.
    await expect(page.getByText("getOrder").first()).toBeVisible();
  });

  test("answers a policy question with a citation that opens the source passage", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/agent");
    await page.getByRole("button", { name: "New conversation" }).click();

    await ask(page, "According to our refund policy, can a delivered order be refunded?");

    // `exact` avoids matching the answer body, which also mentions its sources in prose.
    await expect(page.getByText("Sources", { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /Refund Policy/ }).first().click();
    await expect(page.getByRole("dialog")).toContainText("refund", { ignoreCase: true });
  });

  test("says it cannot answer when the knowledge base has nothing relevant", async ({ page }) => {
    await signIn(page);
    await page.goto("/agent");
    await page.getByRole("button", { name: "New conversation" }).click();

    await ask(page, "According to our policy, who won the cricket world cup?");

    await expect(page.getByText(/does not contain enough information/i)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("stops a refund for approval and executes it only after approval", async ({ page }) => {
    await signIn(page);
    await page.goto("/agent");
    await page.getByRole("button", { name: "New conversation" }).click();

    await ask(page, "Refund order ORD-1001.");

    await expect(page.getByText("Approval required")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("createRefund").first()).toBeVisible();

    // Nothing has run yet: the order is still fully paid.
    const beforePage = await page.context().newPage();
    await beforePage.goto("/orders?delayed=false");
    await beforePage.fill('input[placeholder*="Search by reference"]', "ORD-1001");
    await expect(beforePage.getByText("Paid").first()).toBeVisible({ timeout: 15_000 });
    await beforePage.close();

    await page.getByRole("button", { name: "Approve and run" }).click();

    await expect(page.getByText(/Approved/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Refunded ₹/).first()).toBeVisible();
  });

  test("blocks a viewer from using the agent", async ({ page }) => {
    await signIn(page, "viewer@flowpilot.demo");
    await page.goto("/agent");
    await expect(page.getByText("Agent access is restricted")).toBeVisible();
  });

  test("sends into the conversation it just opened", async ({ page }) => {
    await signIn(page);
    await page.goto("/agent");
    await expect(page.getByRole("button", { name: "New conversation" })).toBeVisible();

    // No waiting between the two: opening a conversation and sending used to
    // race, so a second conversation was created and the message landed in the
    // one the user was not looking at.
    await page.getByRole("button", { name: "New conversation" }).click();
    await ask(page, "Show me order ORD-1002.");

    await expect(page.getByText("ORD-1002").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("getOrder").first()).toBeVisible();
  });
});

test.describe("knowledge base", () => {
  test("asks before deleting a document and keeps it when cancelled", async ({ page }) => {
    await signIn(page);
    await page.goto("/knowledge");

    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    const before = await rows.count();

    await page.locator('button[title="Delete"]').first().click();
    await expect(page.getByRole("alertdialog")).toContainText("cannot be undone");

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(rows).toHaveCount(before);
  });

  test("runs the same semantic search the agent uses", async ({ page }) => {
    await signIn(page);
    await page.goto("/knowledge");

    await page.fill('input[placeholder*="how long"]', "how long do customers have to request a refund");
    await page.getByRole("button", { name: "Search", exact: true }).click();

    await expect(page.getByText(/score \d/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Refund Policy").first()).toBeVisible();
  });
});

test.describe("oversight", () => {
  test("shows the audit trail with agent actions and their arguments", async ({ page }) => {
    await signIn(page);
    await page.goto("/activity");

    await expect(page.getByText(/agent\.tool\./).first()).toBeVisible({ timeout: 15_000 });
    await page.getByText(/agent\.tool\./).first().click();
    await expect(page.getByText("Input").first()).toBeVisible();
  });

  test("lists pending approvals with the arguments that will run", async ({ page }) => {
    await signIn(page);
    await page.goto("/approvals");

    await expect(page.getByText("High risk").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Approve" }).first()).toBeVisible();
  });
});
