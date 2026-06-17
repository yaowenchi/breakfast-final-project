import postgres from "postgres";

async function checkConnection(label: string, url?: string) {
  if (!url) {
    console.log(`${label}: URL is not set`);
    return false;
  }
  try {
    // 設定 ssl: "require" 且只需要 1 條連線來進行測試
    const sql = postgres(url, { ssl: "require", max: 1 });
    await sql`SELECT now()`;
    console.log(`${label}: OK`);
    await sql.end();
    return true;
  } catch (err: any) {
    console.log(`${label}: Failed - ${err.message}`);
    return false;
  }
}

async function main() {
  console.log("Neon connection check:");
  console.log(`STORE_DRIVER: ${process.env.STORE_DRIVER || "not set"}`);
  console.log(`DATABASE_URL: ${process.env.DATABASE_URL ? "set" : "not set"}`);
  console.log(`DATABASE_URL_MIGRATION: ${process.env.DATABASE_URL_MIGRATION ? "set" : "not set"}`);

  const runtimeOk = await checkConnection("Runtime connection (DATABASE_URL)", process.env.DATABASE_URL);
  const migrationOk = await checkConnection("Migration connection (DATABASE_URL_MIGRATION)", process.env.DATABASE_URL_MIGRATION);

  if (!runtimeOk || !migrationOk) {
    process.exit(1);
  }
}

main();