import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Thumbnail,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server"; // Adjust the path as needed

// -----------------------------
// Loader: Fetch Shopify products and linked sizing tables from your DB
// -----------------------------
export const loader = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);
    console.log("Admin authenticated");

    const response = await admin.graphql(`
      query getProducts {
        products(first: 20) {
          edges {
            node {
              id
              title
              featuredImage {
                url
                altText
              }
            }
          }
        }
      }
    `);
    const responseJson = await response.json();
    console.log("GraphQL response:", responseJson);

    const edges = Array.isArray(responseJson.data?.products?.edges)
      ? responseJson.data.products.edges
      : [];
    console.log("GraphQL edges:", edges);

    const products = edges
      .filter((edge) => edge && edge.node && edge.node.id)
      .map((edge) => edge.node);
    console.log("Parsed products:", products);

    const productIds = products.map((p) => p.id);
    console.log("Product IDs:", productIds);

    const productLinks = await db.product.findMany({
      where: {
        shopifyProductId: { in: productIds },
      },
      include: { sizingTable: true },
    });
    console.log("Product links from DB:", productLinks);

    const sizingTableMap = Object.fromEntries(
      productLinks.map((p) => [
        p.shopifyProductId,
        p.sizingTable?.apparelType || "Unlinked",
      ])
    );
    console.log("Sizing table map:", sizingTableMap);

    return json({ products, sizingTableMap });
  } catch (error) {
    console.error("Loader error:", error);
    throw error;
  }
};

// -----------------------------
// Component: Display products with image, title, and linked sizing table
// -----------------------------
export default function Index() {
  const { products, sizingTableMap } = useLoaderData();

  return (
    <Page title="Product List">
      <Layout>
        <Layout.Section>
          <Card>
            <IndexTable
              resourceName={{ singular: "product", plural: "products" }}
              itemCount={products.length}
              headings={[
                { title: "Image", hidden: true },
                { title: "Product Title" },
                { title: "Linked Sizing Table" },
              ]}
              selectable={false}
            >
              {products.map((product, index) => (
                <IndexTable.Row
                  id={product.id}
                  key={product.id}
                  position={index}
                >
                  <IndexTable.Cell>
                    <Thumbnail
                      source={
                        product.featuredImage?.url ||
                        "https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg"
                      }
                      alt={product.featuredImage?.altText || product.title}
                      size="small"
                    />
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" fontWeight="medium" as="span">
                      {product.title}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" as="span">
                      {sizingTableMap[product.id] || "Unlinked"}
                    </Text>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
