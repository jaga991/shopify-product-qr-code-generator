// app/routes/app/sizingchart.jsx

import { json, redirect } from "@remix-run/node";
import { useActionData, Form } from "@remix-run/react";
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

// --- ACTION ---
export const action = async ({ request }) => {
  const form = await request.formData();
  const apparelType = form.get("apparelType");
  const dataRaw = form.get("data");

  try {
    const data = JSON.parse(dataRaw); // will throw if not valid JSON

    await db.sizingTable.create({
      data: {
        apparelType,
        data,
      },
    });

    return redirect("/app"); // go back to product listing or sizing list
  } catch (err) {
    return json({
      error: err.message || "Something went wrong",
    }, { status: 400 });
  }
};

// --- COMPONENT ---
export default function AddSizingTable() {
  const actionData = useActionData();
  const [apparelType, setApparelType] = useState("");
  const [data, setData] = useState("");

  return (
    <Page title="Add Sizing Table">
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
                <Button submit primary>Add Table</Button>
              </FormLayout>
            </Form>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
