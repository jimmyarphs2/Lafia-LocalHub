import { Search } from "lucide-react";
export function SearchForm({
  market,
  defaultValue = "",
}: {
  market: string;
  defaultValue?: string;
}) {
  return (
    <form className="search-form" action={`/${market}/search`} role="search">
      <Search aria-hidden="true" size={24} color="#536079" />
      <label className="sr-only" htmlFor="market-search">
        Search the {market} directory
      </label>
      <input
        id="market-search"
        name="q"
        defaultValue={defaultValue}
        placeholder={`Ask for anything in ${market === "lafia" ? "Lafia" : market}…`}
        autoComplete="off"
      />
      <button aria-label="Search directory" type="submit">
        <Search aria-hidden="true" size={22} />
      </button>
    </form>
  );
}
