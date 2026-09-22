import { close, ready } from "./db.js";

/** Poll until the database answers, so `npm run db:up` finishes when it is usable. */
const deadline = Date.now() + 60_000;
process.stdout.write("waiting for the database");

while (Date.now() < deadline) {
  const state = await ready();
  if (state.ok) {
    console.log(`\n${state.detail} is ready on port 55432`);
    await close();
    process.exit(0);
  }
  process.stdout.write(".");
  await new Promise((r) => setTimeout(r, 1500));
}

console.error("\nThe database did not become ready within 60 seconds.");
console.error("Check `docker compose ps` and `docker compose logs db`.");
await close();
process.exit(1);
