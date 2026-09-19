// Next loads .env.local automatically; standalone scripts run by tsx do not.
// Importing this FIRST keeps scripts in the same credential (and therefore
// the same embedding) space as the running app. Getting this wrong is
// invisible: seeding silently falls back to the offline embedder while the
// app uses real vectors, and retrieval then matches nothing.
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });
