import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useFetcher } from "@remix-run/react";
import { useState } from "react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Thumbnail,
  Text,
  Tabs,
  Button,
  Select,
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
    
    //array of products id
    const productIds = products.map((p) => p.id);
    console.log("Product IDs:", productIds);
    
    //use the products id to find all the sizing-table
    const productLinks = await db.product.findMany({
      where: {
        shopifyProductId: { in: productIds },
      },
      include: { sizingTable: true },
    });
    console.log("Product links from DB:", productLinks);

    //sizing tables
    const sizingTables = await db.sizingTable.findMany({
      orderBy: { createdAt: "desc" }
    });

    const sizingTableMap = Object.fromEntries(
      productLinks.map((p) => [
        p.shopifyProductId,
        p.sizingTable?.apparelType || "Unlinked",
      ])
    );
    console.log("Sizing table map:", sizingTableMap);

    return json({ products, sizingTableMap, sizingTables });
  } catch (error) {
    console.error("Loader error:", error);
    throw error;
  }
};
// -----------------------------
// Action: Link sizing table to product & update metafield
// -----------------------------
export const action = async ({ request }) => {
  const form = await request.formData();
  const shopifyProductId = form.get("shopifyProductId");
  const sizingTableId = form.get("sizingTableId");

  const { admin } = await authenticate.admin(request);

  const sizingTable = await db.sizingTable.findUnique({ where: { id: sizingTableId } });
  if (!sizingTable) return json({ error: "Invalid sizing table" }, { status: 400 });

  // Update local DB
  await db.product.upsert({
    where: { shopifyProductId },
    update: { sizingTableId },
    create: {
      shopifyProductId,
      sizingTableId,
    }
  });

  // Push metafield to Shopify
  const response = await admin.graphql(`
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          type
          value
        }
        userErrors {
          field
          message
        }
      }
    }
  `, {
    variables: {
      metafields: [
        {
          namespace: "custom",
          key: "sizing_data",
          ownerId: shopifyProductId,
          type: "json",
          value: JSON.stringify(sizingTable.data),
        },
      ],
    }
  });
  
  const result = await response.json();
  console.log("📦 metafieldsSet result:", JSON.stringify(result, null, 2));
  
  

  return json({ success: true });
};


// -----------------------------
// Component: Display products with image + title in one column and tag in another column
// -----------------------------
export default function Index() {
  // Inside Index component
  const fetcher = useFetcher();
  const { products, sizingTableMap, sizingTables } = useLoaderData();
  const navigate = useNavigate();
  const [selectedTab, setSelectedTab] = useState(0);
  const handleLinkSizeTable = (productId) => {
    // Extract the numeric ID from the full Shopify ID
    const cleanId = productId.split('/').pop();
    debugLog("Navigating to Link Sizing Chart", { 
      originalId: productId,
      cleanId
    });
    navigate(`/app/products/${cleanId}/link-sizing-chart`);
  };

  const handleTabChange = (selectedTabIndex) => setSelectedTab(selectedTabIndex);

  const tabs = [
    { id: "products-tab", content: "Products", panelID: "products-content" },
    { id: "size-tables-tab", content: "Size Tables", panelID: "size-tables-content" },
  ];


  return (
    <Page fullWidth>
      <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange} fitted>
        <Layout.Section fullWidth>
          {selectedTab === 0 && (
            <Card>
              {products.length === 0 ? (
                <Text variant="bodyMd" tone="subdued" padding="4">
                  No products detected.
                </Text>
              ) : (
                <IndexTable
                  resourceName={{ singular: "product", plural: "products" }}
                  itemCount={products.length}
                  headings={[
                    { title: "Product" },
                    { title: "Tag" },
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
                        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                          <Thumbnail
                            source={product.featuredImage?.url ||
                              "https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg"}
                            alt={product.featuredImage?.altText || product.title}
                            size="small"
                          />
                          <Text variant="bodyMd" fontWeight="medium" as="span">
                            {product.title}
                          </Text>
                        </div>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <fetcher.Form method="post">
                          <input type="hidden" name="shopifyProductId" value={product.id} />
                          <Select
                            name="sizingTableId"
                            label=""
                            labelHidden
                            value={sizingTableMap[product.id] === "Unlinked" ? "" : sizingTables.find(t => t.apparelType === sizingTableMap[product.id])?.id || ""}
                            onChange={(value) => {
                              fetcher.submit({ shopifyProductId: product.id, sizingTableId: value }, { method: "post" });
                            }}
                            options={[
                              { label: "Unlinked", value: "" },
                              ...sizingTables.map((table) => ({
                                label: table.apparelType,
                                value: table.id,
                              })),
                            ]}
                          />
                        </fetcher.Form>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
            </Card>
          )}
          {/* Sizing Tables */}
          {selectedTab === 1 && (
            <Layout.Section>
              <Button primary onClick={() => navigate("/app/sizingchart")}>
                Add Sizing Table
              </Button>

              {sizingTables.length === 0 ? (
                <Text tone="subdued" variant="bodyMd" padding="4">
                  No sizing tables added yet.
                </Text>
              ) : (
                <Card title="Sizing Tables">
                  <IndexTable
                    resourceName={{ singular: "table", plural: "tables" }}
                    itemCount={sizingTables.length}
                    headings={[
                      { title: "Apparel Type" },
                      { title: "Preview (JSON)" },
                    ]}
                    selectable={false}
                  >
                    {sizingTables.map((table, index) => (
                      <IndexTable.Row
                        id={table.id}
                        key={table.id}
                        position={index}
                      >
                        <IndexTable.Cell>
                          <Text variant="bodyMd" fontWeight="medium" as="span">
                            {table.apparelType}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text variant="bodyMd" as="span">
                            <code style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block", maxWidth: 400 }}>
                              {JSON.stringify(table.data).slice(0, 100)}...
                            </code>
                          </Text>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                </Card>
              )}
            </Layout.Section>

          )}
        </Layout.Section>
      </Tabs>
    </Page>
  );
}
