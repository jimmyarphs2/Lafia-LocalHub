// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AleListingStarter } from "@/components/vendor/ale-listing-starter";
import { getAdaptiveListingSchema } from "@/lib/ale/registry";

afterEach(cleanup);

describe("ALE listing starter validation status", () => {
  it("clears a successful validation claim when a field changes", async () => {
    render(<AleListingStarter schema={getAdaptiveListingSchema("product")} />);

    fireEvent.change(screen.getByLabelText(/Product name/), {
      target: { value: "Celebration cake" },
    });
    fireEvent.change(screen.getByLabelText(/What should customers know/), {
      target: { value: "A made-to-order celebration cake for local pickup." },
    });
    fireEvent.click(screen.getByLabelText("Pickup"));
    fireEvent.click(
      screen.getByRole("button", { name: "Check listing details" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "These details match",
    );

    fireEvent.change(screen.getByLabelText(/Product name/), {
      target: { value: "x" },
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
