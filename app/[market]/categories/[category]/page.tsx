import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CatalogStateNotice, ListingRows } from "@/components/catalog-ui";
import { SearchForm } from "@/components/search-form";
import { categories, getCategoryRouteKey } from "@/lib/catalog/data";
import { getCatalogForMarket } from "@/lib/catalog/source";
import { getPublicUrl, isDemoMode } from "@/lib/market/public-url";
export function generateStaticParams() {
  return isDemoMode()
    ? categories.map(({ slug: category }) => ({ category }))
    : [];
}
export async function generateMetadata({
  params,
}: PageProps<"/[market]/categories/[category]">): Promise<Metadata> {
  const { market, category: slug } = await params;
  const catalog = await getCatalogForMarket(market);
  if (catalog.state !== "ready") {
    return { robots: { index: false, follow: false } };
  }
  const category = catalog.categories.find(
    (item) => getCategoryRouteKey(item) === slug,
  );
  return category
    ? {
        title: `${category.name} in ${market}`,
        description:
          category.description ||
          `Browse published ${category.name.toLowerCase()} listings in ${market}.`,
        alternates: {
          canonical: getPublicUrl(`/${market}/categories/${slug}`),
        },
      }
    : {};
}
export default async function CategoryPage({
  params,
}: PageProps<"/[market]/categories/[category]">) {
  const { market, category: slug } = await params;
  const catalog = await getCatalogForMarket(market);
  const demoMode = catalog.source === "fictional-demo";
  const category = catalog.categories.find(
    (item) => getCategoryRouteKey(item) === slug,
  );
  if (catalog.state === "ready" && !category) notFound();
  if (catalog.state !== "ready") {
    return (
      <section className="container section">
        <p className="breadcrumbs">
          <Link href={`/${market}`}>Directory</Link> / Category
        </p>
        <CatalogStateNotice state={catalog.state} subject="category" />
      </section>
    );
  }
  if (!category) notFound();
  const results = catalog.listings.filter((listing) =>
    category.id
      ? listing.categoryId === category.id
      : listing.category === category.slug,
  );
  return (
    <>
      <header className="directory-header">
        <div className="container">
          <p className="breadcrumbs">
            <Link href={`/${market}`}>Directory</Link> / {category.name}
          </p>
          <h1>
            {category.name} in {market === "lafia" ? "Lafia" : market}
          </h1>
          <p className="lede" style={{ marginLeft: 0 }}>
            {category.description || `Browse ${category.name.toLowerCase()}.`}{" "}
            {demoMode
              ? "All entries are fictional demo data."
              : "Only publishable records are shown."}
          </p>
          <SearchForm market={market} />
        </div>
      </header>
      <section className="container section">
        {results.length ? (
          <>
            <h2 className="results-heading">{category.name} listings</h2>
            <ListingRows market={market} listings={results} />
          </>
        ) : (
          <div className="empty-state">
            <h2>
              No {demoMode ? "fictional demo" : "published"} listings in this
              category yet.
            </h2>
            <p>
              {demoMode
                ? "The current demo directory does not make any live availability claims."
                : "This category is ready for future published records. No additional business is shown in the live directory."}
            </p>
          </div>
        )}
      </section>
    </>
  );
}
