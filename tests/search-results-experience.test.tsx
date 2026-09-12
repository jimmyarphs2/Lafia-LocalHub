/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SearchResultsExperience } from "@/components/search-results-experience";
import { categories } from "@/lib/catalog/data";
import { describeIntent, searchListings } from "@/lib/catalog/search";

const query = "Birthday cake around Shendam Road";
const search = searchListings(query, "lafia");

afterEach(cleanup);

function renderExperience() {
  return render(
    <SearchResultsExperience
      categories={categories}
      demandPath={null}
      demoMode
      interpretedQuery={`Interpreted as ${describeIntent(search.intent)}`}
      market="lafia"
      marketName="Lafia"
      matches={search.matches}
      query={query}
    />,
  );
}

describe("SearchResultsExperience", () => {
  it("renders truthful, photographic demo results without unsupported trust claims", () => {
    const { container } = renderExperience();

    expect(screen.getByText("3 matches")).toBeInTheDocument();
    expect(screen.getAllByText("Fictional demo")).toHaveLength(3);
    expect(container.querySelectorAll("img")).toHaveLength(3);
    expect(container.textContent).not.toMatch(/verified|reviews|open now/i);
  });

  it("filters, resets, sorts, and toggles the area overview", () => {
    const { container } = renderExperience();

    fireEvent.change(screen.getByLabelText("Filter by price"), {
      target: { value: "over-25000" },
    });
    expect(
      screen.getByText("No results match these filters."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("3 matches")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Sort results"), {
      target: { value: "name" },
    });
    const firstResultHeading = container.querySelector("article h2");
    expect(firstResultHeading).toHaveTextContent(
      "Birthday cakes with delivery enquiry",
    );

    fireEvent.click(screen.getByRole("button", { name: /Area/ }));
    expect(screen.getByText("Results by published area")).toBeInTheDocument();
    expect(screen.getByText(/not live navigation/i)).toBeInTheDocument();
  });

  it("supports local save feedback and a transparent ranking disclosure", () => {
    renderExperience();

    const save = screen.getAllByRole("button", {
      name: "Save listing for this view",
    })[0]!;
    fireEvent.click(save);
    expect(save).toHaveAttribute("aria-pressed", "true");
    expect(save).toHaveAccessibleName("Remove saved listing");

    fireEvent.click(
      screen.getByRole("button", { name: /How matches are ranked/ }),
    );
    expect(
      screen.getByText(/not probabilities, endorsements/i),
    ).toBeInTheDocument();
  });
});
