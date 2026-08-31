import type { Metadata } from "next";
import { MapPin } from "lucide-react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CatalogStateNotice, ListingRows } from "@/components/catalog-ui";
import { normalizeSearchContext } from "@/components/commitment-link";
import { vendors } from "@/lib/catalog/data";
import { getCatalogForMarket } from "@/lib/catalog/source";
import { serializeJsonLd } from "@/lib/catalog/structured-data";
import { getPublicUrl, isDemoMode } from "@/lib/market/public-url";
export function generateStaticParams() {
  return isDemoMode() ? vendors.map(({ slug: vendor }) => ({ vendor })) : [];
}
export async function generateMetadata({
  params,
}: PageProps<"/[market]/vendors/[vendor]">): Promise<Metadata> {
  const { market, vendor: slug } = await params;
  const catalog = await getCatalogForMarket(market);
  if (catalog.state !== "ready") {
    return { robots: { index: false, follow: false } };
  }
  const vendor = catalog.vendors.find((item) => item.slug === slug);
  return vendor
    ? {
        title: `${vendor.name} in ${market}`,
        description: vendor.summary,
        alternates: { canonical: getPublicUrl(`/${market}/vendors/${slug}`) },
      }
    : {};
}
export default async function VendorPage({
  params,
  searchParams,
}: PageProps<"/[market]/vendors/[vendor]">) {
  const [{ market, vendor: slug }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const searchQuery = normalizeSearchContext(
    typeof query.q === "string" ? query.q : undefined,
  );
  const catalog = await getCatalogForMarket(market);
  if (catalog.state !== "ready") {
    return (
      <section className="container section">
        <p className="breadcrumbs">
          <Link href={`/${market}`}>Directory</Link> / Vendor
        </p>
        <CatalogStateNotice state={catalog.state} subject="vendor profile" />
      </section>
    );
  }
  const vendor = catalog.vendors.find((item) => item.slug === slug);
  if (!vendor) notFound();
  const isFictionalDemo = vendor.provenance?.kind === "fictional-demo";
  const items = catalog.listings.filter((item) => item.vendor === vendor.slug);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: vendor.name,
    description: vendor.summary,
    address: vendor.location
      ? {
          "@type": "PostalAddress",
          addressLocality: vendor.location,
          addressCountry: catalog.market?.countryCode ?? "NG",
        }
      : undefined,
    isPartOf: {
      "@type": "WebSite",
      name: isFictionalDemo
        ? "LocalHub fictional demo directory"
        : "LocalHub directory",
    },
  };
  return (
    <section className="container section">
      {!isFictionalDemo && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      )}
      <p className="breadcrumbs">
        <Link href={`/${market}`}>Directory</Link> / {vendor.name}
      </p>
      <div
        className="detail-visual"
        style={{ "--listing-color": vendor.color } as React.CSSProperties}
      />
      <div className="detail-copy">
        <p className="eyebrow">
          {isFictionalDemo ? "Fictional demo vendor" : "Directory vendor"}
        </p>
        <h1>{vendor.name}</h1>
        {vendor.location ? (
          <p className="listing-meta">
            <MapPin aria-hidden="true" size={16} /> {vendor.location}
          </p>
        ) : (
          <p className="listing-meta">Location not published.</p>
        )}
        <p>
          {vendor.summary ||
            "This business has not added a public summary yet."}
        </p>
      </div>
      <h2>{isFictionalDemo ? "Demo listings" : "Listings"}</h2>
      {items.length ? (
        <ListingRows market={market} listings={items} query={searchQuery} />
      ) : (
        <div className="empty-state">
          <h3>No verified listings are published for this vendor yet.</h3>
          <p>
            This profile remains visible, but LocalHub will not invent or
            substitute listing details that the vendor has not published.
          </p>
        </div>
      )}
    </section>
  );
}
