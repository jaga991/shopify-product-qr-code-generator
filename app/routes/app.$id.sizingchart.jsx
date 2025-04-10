// app/routes/app/$id/sizingchart.jsx

import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  TextField,
  Button,
  FormLayout,
  InlineError,
  Select,
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
  console.log("Received dataRaw:", dataRaw);

  const { admin } = await authenticate.admin(request);
  
  try {
    const data = JSON.parse(dataRaw);

    if (params.id === "new") {
      // For new table, create a sizingTable record.
      await db.sizingTable.create({
        data: { apparelType: apparelType, data },
      });
    } else {
      // For editing an existing table, update the sizingTable record.
      const updated = await db.sizingTable.update({
        where: { id: params.id },
        data: { data },
      });

      // Then, find all products linked to this sizing table.
      const linkedProducts = await db.product.findMany({
        where: { sizingTableId: updated.id },
      });

      // For each linked product, mutate its metafields using the admin GraphQL API.
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
    return json(
      { error: err.message || "Something went wrong" },
      { status: 400 }
    );
  }
};

// --- COMPONENT ---
export default function SizingChartForm() {
  const { mode, table } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  console.log(table);
  // Convert the incoming JSON sizes (object) into an array format for our dynamic table.
  const initialSizes = table
    ? Object.entries(table.data.sizes).map(([sizeLabel, measurements]) => ({
        label: sizeLabel,
        measurements: Object.fromEntries(
          Object.entries(measurements).map(([mLabel, range]) => [
            mLabel,
            { min: String(range.min), max: String(range.max) },
          ])
        ),
      }))
    : [
        {
          label: "",
          measurements: {
            torso: { min: "", max: "" },
            shoulder: { min: "", max: "" },
            chest: { min: "", max: "" },
          },
        },
      ];

  // Get initial measurement columns from the first row, or default.
  const initialMeasurementLabels =
    table && Object.keys(initialSizes[0].measurements).length > 0
      ? Object.keys(initialSizes[0].measurements)
      : ["torso", "shoulder", "chest"];

  // Component state
  const [apparelType, setApparelType] = useState(table?.apparelType  || "");
  const [unit, setUnit] = useState(table?.data?.unit || "cm"); // If you want to include a unit.
  const [measurementLabels, setMeasurementLabels] = useState(
    initialMeasurementLabels
  );
  const [sizes, setSizes] = useState(initialSizes);
  const [error, setError] = useState(null);

  // Options for unit selection
  const unitOptions = [
    { label: "cm", value: "cm" },
    { label: "inches", value: "in" },
  ];

  // --- Handlers ---
  // Add a new size row.
  const addSizeRow = () => {
    const newMeasurements = {};
    measurementLabels.forEach((label) => {
      newMeasurements[label] = { min: "", max: "" };
    });
    setSizes([...sizes, { label: "", measurements: newMeasurements }]);
  };

  // Add a new measurement column.
  const addMeasurementColumn = () => {
    setMeasurementLabels([...measurementLabels, ""]);
    setSizes(
      sizes.map((size) => ({
        ...size,
        measurements: {
          ...size.measurements,
          [newMeasurement]: { min: "", max: "" },
        },
      }))
    );
  };

  // Delete a size row.
  const deleteSizeRow = (sizeIndex) => {
    setSizes(sizes.filter((_, index) => index !== sizeIndex));
  };

  // Delete a measurement column.
  const deleteMeasurementColumn = (measurementKey) => {
    setMeasurementLabels(
      measurementLabels.filter((label) => label !== measurementKey)
    );
    setSizes(
      sizes.map((size) => {
        const updatedMeasurements = { ...size.measurements };
        delete updatedMeasurements[measurementKey];
        return { ...size, measurements: updatedMeasurements };
      })
    );
  };

  // Update the size label.
  const handleLabelChange = (sizeIndex, value) => {
    const newSizes = [...sizes];
    newSizes[sizeIndex].label = value;
    setSizes(newSizes);
  };

  // Update the min or max value for a measurement.
  const handleMeasurementValueChange = (sizeIndex, measurementKey, field, value) => {
    const newSizes = [...sizes];
    if (!newSizes[sizeIndex].measurements[measurementKey]) {
      newSizes[sizeIndex].measurements[measurementKey] = { min: "", max: "" };
    }
    newSizes[sizeIndex].measurements[measurementKey][field] = value;
    setSizes(newSizes);
  };

  // Handle renaming a measurement column.
  const handleMeasurementLabelChange = (index, newLabel) => {
    const oldLabel = measurementLabels[index];
    const newLabels = [...measurementLabels];
    newLabels[index] = newLabel;
    setMeasurementLabels(newLabels);

    const updatedSizes = sizes.map((size) => {
      const newMeasurements = { ...size.measurements };
      newMeasurements[newLabel] = newMeasurements[oldLabel] || { min: "", max: "" };
      if (oldLabel !== newLabel) delete newMeasurements[oldLabel];
      return { ...size, measurements: newMeasurements };
    });
    setSizes(updatedSizes);
  };

  // Transform the internal state to match your JSON structure.
  const prepareSubmissionData = () => {

    const sizesObj = sizes.reduce((acc, size) => {
      if (size.label) {
        acc[size.label] = Object.keys(size.measurements).reduce((mAcc, key) => {
          mAcc[key] = {
            min: parseInt(size.measurements[key].min, 10),
            max: parseInt(size.measurements[key].max, 10),
          };
          return mAcc;
        }, {});
      }
      return acc;
    }, {});
    console.log({
      apparel_type: apparelType,
      unit,
      sizes: sizesObj,
    })
    return {
      apparel_type: apparelType,
      unit,
      sizes: sizesObj,
    };
  };

  // Validate before submitting.
  const handleSubmit = (event) => {
    event.preventDefault(); // Prevent default form submission.
    for (const size of sizes) {
      if (!size.label) {
        setError("Please fill out all size labels.");
        return;
      }
      for (const key of measurementLabels) {
        const measurement = size.measurements[key];
        if (!measurement || measurement.min === "" || measurement.max === "") {
          setError(
            `Please fill out min and max values for "${key}" in size "${size.label}".`
          );
          return;
        }
      }
    }
    setError("");
    // Programmatically submit the form after validation.
    console.log(event.currentTarget);
    submit(event.currentTarget, { method: "post" });
  };
  
  return (
    <Page title={mode === "edit" ? "Edit Sizing Table" : "Add Sizing Table"}>
      <Layout>
        <Layout.Section>
          <Card sectioned>
            <Form method="post" onSubmit={handleSubmit}>
              <FormLayout>
                <TextField
                  label="Apparel Type"
                  name="apparelType"
                  value={apparelType}
                  onChange={(setApparelType)}
                  autoComplete="off"
                  requiredIndicator
                  disabled={mode === "edit"} // Disable editing if in edit mode.
                />
                <Select
                  label="Unit"
                  options={unitOptions}
                  value={unit}
                  onChange={(value) => setUnit(value)}
                />
                {error && <InlineError message={error} fieldID="error" />}
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      marginTop: "1em",
                    }}
                  >
                    <thead>
                      <tr>
                        <th style={{ border: "1px solid #ccc", padding: "8px" }}>
                          Size Label
                        </th>
                        {measurementLabels.map((measurement, index) => (
                          <th
                            key={measurement}
                            style={{ border: "1px solid #ccc", padding: "8px" }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Select
                                options={[
                                  { label: "", value: "" },
                                  { label: "shoulder", value: "shoulder" },
                                  { label: "hip", value: "hip" },
                                  { label: "arm", value: "arm" },
                                  { label: "leg", value: "leg" },
                                  { label: "chest", value: "chest" },
                                  { label: "waist", value: "waist" },
                                  { label: "torso", value: "torso" },
                                  { label: "thigh", value: "thigh" },
                                ]}
                                value={measurement}
                                onChange={(value) =>
                                  handleMeasurementLabelChange(index, value)
                                }
                                style={{ flex: 1, marginRight: "8px" }}
                              />
                              <Button
                                plain
                                destructive
                                variant="tertiary"
                                onClick={() =>
                                  deleteMeasurementColumn(measurement)
                                }
                              >
                                X
                              </Button>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sizes.map((size, sizeIndex) => (
                        <tr key={sizeIndex}>
                          <td
                            style={{
                              border: "1px solid #ccc",
                              padding: "8px",
                              position: "relative",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                              }}
                            >
                              <TextField
                                label=""
                                value={size.label}
                                onChange={(value) =>
                                  handleLabelChange(sizeIndex, value)
                                }
                                autoComplete="off"
                                style={{ width: "100%" }}
                              />
                              <Button
                                plain
                                destructive
                                variant="tertiary"
                                onClick={() => deleteSizeRow(sizeIndex)}
                              >
                                X
                              </Button>
                            </div>
                          </td>
                          {measurementLabels.map((measurement) => (
                            <td
                              key={measurement}
                              style={{
                                border: "1px solid #ccc",
                                padding: "8px",
                              }}
                            >
                              <TextField
                                label="Min"
                                type="number"
                                value={size.measurements[measurement]?.min || ""}
                                onChange={(value) =>
                                  handleMeasurementValueChange(
                                    sizeIndex,
                                    measurement,
                                    "min",
                                    value
                                  )
                                }
                                autoComplete="off"
                                placeholder="min"
                                style={{ marginBottom: "0.5rem" }}
                              />
                              <TextField
                                label="Max"
                                type="number"
                                value={size.measurements[measurement]?.max || ""}
                                onChange={(value) =>
                                  handleMeasurementValueChange(
                                    sizeIndex,
                                    measurement,
                                    "max",
                                    value
                                  )
                                }
                                autoComplete="off"
                                placeholder="max"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: "1em" }}>
                  <Button onClick={addSizeRow}>Add Size Row</Button>
                  <Button onClick={addMeasurementColumn}>
                    Add Measurement Column
                  </Button>
                </div>
                {/* Hidden input to submit our transformed JSON */}
                <input
                  type="hidden"
                  name="data"
                  value={JSON.stringify(prepareSubmissionData())}
                />
                <Button primary submit>
                  {mode === "edit" ? "Update" : "Add"} Table
                </Button>
              </FormLayout>
            </Form>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
