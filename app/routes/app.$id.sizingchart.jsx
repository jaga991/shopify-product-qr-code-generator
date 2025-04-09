// app/routes/app/$id/sizingchart.jsx

import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, Form } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  TextField,
  Button,
  FormLayout,
  InlineError,
} from "@shopify/polaris";
import { useState } from "react";
import db from "../db.server";
import { authenticate } from "../shopify.server";

// --- LOADER ---
export const loader = async ({ params }) => {
  if (params.id === "new") {
    return json({ mode: "add", table: null });
  }

  const table = await db.sizingTable.findUnique({ where: { id: params.id } });

  if (!table) throw new Response("Not Found", { status: 404 });

  return json({ mode: "edit", table });
};

// --- ACTION ---
export const action = async ({ request, params }) => {
  const form = await request.formData();
  const apparelType = form.get("apparelType");
  const dataRaw = form.get("data");
  const { admin } = await authenticate.admin(request);

  try {
    const data = JSON.parse(dataRaw);

    
    if (params.id === "new") {
      await db.sizingTable.create({
        data: { apparelType, data },
      });
    } else {
      const updated = await db.sizingTable.update({
        where: { id: params.id },
        data: { data },
      });

      const linkedProducts = await db.product.findMany({
        where: { sizingTableId: updated.id },
      });

      for (const product of linkedProducts) {
        await admin.graphql(
          `
          mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              userErrors { message }
            }
          }
        `,
          {
            variables: {
              metafields: [
                {
                  namespace: "custom",
                  key: "sizing_data",
                  ownerId: product.shopifyProductId,
                  type: "json",
                  value: JSON.stringify(data),
                },
              ],
            },
          }
        );
      }
    }

    return redirect("/app");
  } catch (err) {
    return json({ error: err.message || "Something went wrong" }, { status: 400 });
  }
};

// --- COMPONENT ---
export default function SizingChartForm() {
  const { mode, table } = useLoaderData();
  const actionData = useActionData();
  const [apparelType, setApparelType] = useState(table?.apparelType || "");
  const [data, setData] = useState(
    table ? JSON.stringify(table.data, null, 2) : ""
  );

  return (
    <Page title={mode === "edit" ? "Edit Sizing Table" : "Add Sizing Table"}>
      <Layout>
        <Layout.Section>
          <Card sectioned>
            <Form method="post">
              <FormLayout>
                <TextField
                  label="Apparel Type"
                  name="apparelType"
                  value={apparelType}
                  onChange={setApparelType}
                  autoComplete="off"
                  requiredIndicator
                  disabled={mode === "edit"} // Don't allow editing apparelType
                />
                <TextField
                  label="Sizing Table JSON"
                  name="data"
                  value={data}
                  onChange={setData}
                  multiline={6}
                  autoComplete="off"
                  requiredIndicator
                  helpText="Must be valid JSON."
                  error={actionData?.error?.includes("JSON") ? "Invalid JSON" : undefined}
                />
                {actionData?.error && !actionData?.error.includes("JSON") && (
                  <InlineError message={actionData.error} fieldID="data" />
                )}
                <Button submit primary>{mode === "edit" ? "Update" : "Add"} Table</Button>
              </FormLayout>
            </Form>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
