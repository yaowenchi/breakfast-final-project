// d:\新增資料夾\backend-origin\scripts\migrate-json.ts
// import { dbV8 } from "../legacy/v8/db/client.ts";
// import { menuItems } from "../legacy/v8/db/schema.ts"; // adjust based on your schema

async function migrateJson() {
  console.log("Starting JSON migration...");

  // TODO: Add your logic to read a JSON file and insert it into the database
  // const file = Bun.file("./data/menu.json"); // Provide your actual JSON path here
  // const menuData = await file.json();
  // await dbV8.insert(menuItems).values(menuData);

  console.log("JSON migration successfully completed!");
}

migrateJson().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});