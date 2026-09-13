import { Search } from "lucide-react";

export default function SearchLoading() {
  return (
    <div className="search-loading" aria-busy="true" aria-live="polite">
      <div className="container">
        <div className="search-loading-bar">
          <Search aria-hidden="true" size={23} />
          <span>Finding LocalHub matches…</span>
        </div>
        <div className="search-loading-layout">
          <div className="search-loading-filter" />
          <div className="search-loading-results">
            <div />
            <div />
            <div />
          </div>
        </div>
      </div>
    </div>
  );
}
