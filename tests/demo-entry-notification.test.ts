import { describe, expect, it } from "vitest";
import { createDemoEntryNotification, formatDemoEntryLocation } from "@/lib/demo-entry-notification";

describe("demo entry notifications", () => {
  it("formats decoded Vercel location headers without duplicates", () => {
    expect(formatDemoEntryLocation({ city: "San%20Diego", region: "CA", country: "US" }))
      .toBe("San Diego, CA, US");
    expect(formatDemoEntryLocation({ city: "Singapore", region: "Singapore", country: "SG" }))
      .toBe("Singapore, SG");
  });

  it("escapes visitor-controlled fields in the email", () => {
    const message = createDemoEntryNotification({
      name: "<Aaron & Team>", email: "person@example.com", enteredAt: Date.UTC(2026, 6, 12),
      city: "San%20Diego", region: "CA", country: "US", source: "campaign<script>",
    });
    expect(message.subject).toContain("<Aaron & Team>");
    expect(message.html).toContain("&lt;Aaron &amp; Team&gt;");
    expect(message.html).not.toContain("campaign<script>");
    expect(message.html).toContain('name="color-scheme" content="light only"');
    expect(message.html).toContain("gmail-blend-difference");
    expect(message.html).toContain("-webkit-text-fill-color:#fff");
    expect(message.text).toContain("Location: San Diego, CA, US");
  });
});
